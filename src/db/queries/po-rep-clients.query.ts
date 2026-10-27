import { PoRepDealState } from '../auto-generated/enums';
import { QueryBuilder } from '../query-builder';
import { createPoRepDealsQuery } from './po-rep-deals.query';

export interface CreatePoRepClientsQueryParameters {
  clientsAddresses?: string | string[] | null;
}

export function createPoRepClientsStatisticsQuery(
  qb: QueryBuilder,
  { clientsAddresses }: CreatePoRepClientsQueryParameters = {},
) {
  return createPoRepDealsQuery(qb, { clientsAddresses: clientsAddresses })
    .select((eb) => [
      'client_address',
      eb.fn.count('deal_id').as('deals_count'),
      eb.fn
        .count('deal_id')
        .filterWhere('active', '=', true)
        .as('active_contracts_count'),
      eb.fn
        .count('deal_id')
        .filterWhere('deal_state', '<>', PoRepDealState.REJECTED)
        .filterWhere(({ exists, selectFrom }) =>
          exists(
            selectFrom('po_rep_deal as pd')
              .innerJoin(
                'po_rep_deal_state_change as psc',
                'psc.deal_id',
                'pd.dealId',
              )
              .select('pd.dealId')
              .whereRef('pd.client', '=', 'deal_data.client_address')
              .whereRef('pd.manifestHash', '=', 'deal_data.manifest_hash')
              .whereRef('pd.dealId', '<>', 'deal_data.deal_id')
              .where('psc.state', '=', PoRepDealState.ACTIVE)
              .whereRef(
                'psc.changed_at_block',
                '<',
                'deal_data.deal_created_at_epoch',
              ),
          ),
        )
        .as('renewals_count'),
      eb.fn
        .coalesce(
          eb.fn
            .sum('deal_size_bytes')
            .filterWhere('rail_activated_at_epoch', 'is not', null),
          eb.val(0),
        )
        .as('storage_purchased_bytes'),
      eb.fn.min('deal_created_at_epoch').as('first_deal_epoch'),
      eb.fn.max('deal_created_at_epoch').as('last_deal_epoch'),
    ])
    .groupBy('client_address');
}

export function createPoRepClientsDealsStatesQuery(
  qb: QueryBuilder,
  { clientsAddresses }: CreatePoRepClientsQueryParameters = {},
) {
  return createPoRepDealsQuery(qb, { clientsAddresses: clientsAddresses })
    .select((eb) => [
      'client_address',
      'deal_state',
      eb.fn.count('deal_id').as('deals_count'),
    ])
    .groupBy(['client_address', 'deal_state']);
}

export function createPoRepClientsSpendQuery(
  qb: QueryBuilder,
  { clientsAddresses }: CreatePoRepClientsQueryParameters = {},
) {
  return createPoRepDealsQuery(qb, { clientsAddresses: clientsAddresses })
    .select((eb) => [
      'client_address',
      'token_address',
      eb.fn
        .coalesce(eb.fn.sum('total_amount_settled'), eb.val(0))
        .as('total_amount_settled'),
      eb.fn
        .coalesce(eb.fn.sum('locked_amount'), eb.val(0))
        .as('total_amount_locked'),
    ])
    .where('token_address', 'is not', null)
    .groupBy(['client_address', 'token_address']);
}
