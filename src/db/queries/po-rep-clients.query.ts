import { QueryBuilder } from '../query-builder';
import { createPoRepDealsQuery } from './po-rep-deals.query';

export interface CreatePoRepClientQueryParameters {
  clientAddress: string;
}

export interface CreatePoRepClientSpendQueryParameters extends CreatePoRepClientQueryParameters {
  fromEpoch: number;
}

export function createPoRepClientStatisticsQuery(
  qb: QueryBuilder,
  { clientAddress }: CreatePoRepClientQueryParameters,
) {
  return createPoRepDealsQuery(qb, { clientsAddresses: clientAddress })
    .select((eb) => [
      'client_address',
      eb.fn.count('deal_id').as('deals_count'),
      eb.fn.min('deal_created_at_epoch').as('first_deal_epoch'),
    ])
    .groupBy('client_address');
}

export function createPoRepClientSpendQuery(
  qb: QueryBuilder,
  { clientAddress, fromEpoch }: CreatePoRepClientSpendQueryParameters,
) {
  return qb
    .selectFrom('filecoin_pay_payment as p')
    .innerJoin('filecoin_pay_rail as r', 'r.railId', 'p.railId')
    .innerJoin('po_rep_deal as d', 'd.railId', 'p.railId')
    .select((eb) => [
      'r.token as token_address',
      eb.fn
        .coalesce(eb.fn.sum('p.totalAmount'), eb.val(0))
        .as('total_amount_settled'),
    ])
    .where('d.client', '=', clientAddress)
    .where('p.oneTime', '=', false)
    .where('p.createdAtBlock', '>', fromEpoch.toString())
    .groupBy('r.token');
}
