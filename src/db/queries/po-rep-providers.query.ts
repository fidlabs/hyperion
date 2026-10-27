import { F0Id } from 'src/utils/utils';
import { QueryBuilder } from '../query-builder';
import { createGenericStringFilter } from './helpers/create-generic-string-filter.helper';
import { createPoRepDealsQuery } from './po-rep-deals.query';

type F0IdLike = Parameters<typeof F0Id.from>[0];

export interface CreatePoRepProvidersQueryParameters {
  providersIds?: F0IdLike | F0IdLike[] | null;
}

export interface CreatePoRepProvidersRevenueQueryParameters extends CreatePoRepProvidersQueryParameters {
  currentPeriodStartEpoch: number;
  previousPeriodStartEpoch: number;
}

function mapF0IdLike(input: F0IdLike): string {
  return F0Id.from(input).toBigInt().toString();
}

export function createPoRepProvidersStatisticsQuery(
  qb: QueryBuilder,
  { providersIds }: CreatePoRepProvidersQueryParameters = {},
) {
  return createPoRepDealsQuery(qb, { providersIds: providersIds })
    .select((eb) => [
      'provider_id',
      eb.fn.count('deal_id').as('deals_count'),
      eb.fn
        .count('deal_id')
        .filterWhere('active', '=', true)
        .as('active_contracts_count'),
      eb.fn
        .coalesce(
          eb.fn.sum('deal_size_bytes').filterWhere('active', '=', true),
          eb.val(0),
        )
        .as('data_under_contract_bytes'),
      eb.fn.min('deal_created_at_epoch').as('first_deal_epoch'),
      eb.fn.max('deal_created_at_epoch').as('last_deal_epoch'),
    ])
    .groupBy('provider_id');
}

export function createPoRepProvidersDealsStatesQuery(
  qb: QueryBuilder,
  { providersIds }: CreatePoRepProvidersQueryParameters = {},
) {
  return createPoRepDealsQuery(qb, { providersIds: providersIds })
    .select((eb) => [
      'provider_id',
      'deal_state',
      eb.fn.count('deal_id').as('deals_count'),
    ])
    .groupBy(['provider_id', 'deal_state']);
}

export function createPoRepProvidersDataByDealTypeQuery(
  qb: QueryBuilder,
  { providersIds }: CreatePoRepProvidersQueryParameters = {},
) {
  return createPoRepDealsQuery(qb, {
    providersIds: providersIds,
    activeOnly: true,
  })
    .select((eb) => [
      'provider_id',
      'deal_type',
      eb.fn.coalesce(eb.fn.sum('deal_size_bytes'), eb.val(0)).as('bytes'),
    ])
    .groupBy(['provider_id', 'deal_type']);
}

export function createPoRepProvidersRevenueQuery(
  qb: QueryBuilder,
  {
    providersIds,
    currentPeriodStartEpoch,
    previousPeriodStartEpoch,
  }: CreatePoRepProvidersRevenueQueryParameters,
) {
  return qb
    .selectFrom('filecoin_pay_payment as p')
    .innerJoin('filecoin_pay_rail as r', 'r.railId', 'p.railId')
    .innerJoin('po_rep_deal as d', 'd.railId', 'p.railId')
    .select((eb) => [
      'd.providerId as provider_id',
      'r.token as token_address',
      eb.fn
        .coalesce(eb.fn.sum('p.netPayeeAmount'), eb.val(0))
        .as('total_revenue'),
      eb.fn
        .coalesce(
          eb.fn
            .sum('p.netPayeeAmount')
            .filterWhere(
              'p.createdAtBlock',
              '>=',
              currentPeriodStartEpoch.toString(),
            ),
          eb.val(0),
        )
        .as('current_period_revenue'),
      eb.fn
        .coalesce(
          eb.fn
            .sum('p.netPayeeAmount')
            .filterWhere(
              'p.createdAtBlock',
              '>=',
              previousPeriodStartEpoch.toString(),
            )
            .filterWhere(
              'p.createdAtBlock',
              '<',
              currentPeriodStartEpoch.toString(),
            ),
          eb.val(0),
        )
        .as('previous_period_revenue'),
    ])
    .where('p.oneTime', '=', false)
    .where((eb) =>
      createGenericStringFilter(
        eb.ref('d.providerId'),
        providersIds,
        mapF0IdLike,
      ),
    )
    .groupBy(['d.providerId', 'r.token']);
}
