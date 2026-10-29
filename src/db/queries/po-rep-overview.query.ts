import { sql } from 'kysely';
import { PoRepDealState, PoRepDealType } from '../auto-generated/enums';
import { QueryBuilder } from '../query-builder';
import { createGenericStringFilter } from './helpers/create-generic-string-filter.helper';
import { createPoRepDealsQuery } from './po-rep-deals.query';

export interface CreatePoRepOverviewQueryParameters {
  periodStartEpoch: number | null;
  periodEndEpoch: number;
  dealTypes?: PoRepDealType | PoRepDealType[] | null;
}

const endedDealStates = [
  PoRepDealState.FINALIZED,
  PoRepDealState.EXPIRED,
  PoRepDealState.EARLY_TERMINATED,
];

export function createPoRepOverviewStatisticsQuery(
  qb: QueryBuilder,
  {
    periodStartEpoch,
    periodEndEpoch,
    dealTypes,
  }: CreatePoRepOverviewQueryParameters,
) {
  const periodStart = (periodStartEpoch ?? 0).toString();
  const periodEnd = periodEndEpoch.toString();

  return qb
    .with('deal_activity', (db) =>
      db
        .selectFrom('po_rep_deal as d')
        .leftJoin('po_rep_deal_state_change as sc', 'sc.deal_id', 'd.dealId')
        .select((eb) => [
          'd.dealId as deal_id',
          'd.client as client_address',
          'd.providerId as provider_id',
          'd.totalDealSize as deal_size_bytes',
          'd.proposedAtBlock as deal_created_at_epoch',
          eb.fn
            .min('sc.changed_at_block')
            .filterWhere('sc.state', '=', PoRepDealState.ACTIVE)
            .as('activated_at_epoch'),
          eb.fn
            .min('sc.changed_at_block')
            .filterWhere('sc.state', 'in', endedDealStates)
            .as('ended_at_epoch'),
        ])
        .where('d.proposedAtBlock', '<=', periodEnd)
        .where((eb) =>
          createGenericStringFilter(eb.ref('d.dealType'), dealTypes),
        )
        .groupBy('d.dealId'),
    )
    .with('deal_period_data', (db) =>
      db
        .selectFrom('deal_activity')
        .select((eb) => [
          'deal_id',
          'client_address',
          'provider_id',
          'deal_size_bytes',
          'deal_created_at_epoch',
          'activated_at_epoch',
          eb
            .and([
              eb('activated_at_epoch', '<=', periodEnd),
              eb.or([
                eb('ended_at_epoch', 'is', null),
                eb('ended_at_epoch', '>', periodEnd),
              ]),
            ])
            .as('active'),
          eb
            .and([
              eb('activated_at_epoch', '>', periodStart),
              eb('activated_at_epoch', '<=', periodEnd),
            ])
            .as('activated_in_period'),
        ]),
    )
    .selectFrom('deal_period_data')
    .select((eb) => [
      eb.fn.count('client_address').distinct().as('clients_count'),
      eb.fn
        .count('client_address')
        .distinct()
        .filterWhere('active', '=', true)
        .as('active_clients_count'),
      eb.fn
        .count('provider_id')
        .distinct()
        .filterWhere('active', '=', true)
        .as('active_providers_count'),
      eb.fn
        .count('deal_id')
        .filterWhere('active', '=', true)
        .as('active_contracts_count'),
      eb.fn
        .coalesce(
          eb.fn.sum('deal_size_bytes').filterWhere('active', '=', true),
          eb.val(0),
        )
        .as('data_retained_bytes'),
      eb.fn
        .coalesce(
          eb.fn
            .sum('deal_size_bytes')
            .filterWhere('activated_in_period', '=', true),
          eb.val(0),
        )
        .as('storage_purchased_bytes'),
      sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${eb.ref('activated_at_epoch')} - ${eb.ref('deal_created_at_epoch')}) filter (where ${eb.ref('activated_in_period')})`.as(
        'median_onboarding_epochs',
      ),
    ]);
}

export function createPoRepOverviewSettledQuery(
  qb: QueryBuilder,
  {
    periodStartEpoch,
    periodEndEpoch,
    dealTypes,
  }: CreatePoRepOverviewQueryParameters,
) {
  return qb
    .selectFrom('filecoin_pay_payment as p')
    .innerJoin('filecoin_pay_rail as r', 'r.railId', 'p.railId')
    .innerJoin('po_rep_deal as d', 'd.railId', 'p.railId')
    .select((eb) => [
      'r.token as token_address',
      eb.fn.coalesce(eb.fn.sum('p.totalAmount'), eb.val(0)).as('amount'),
    ])
    .where('p.oneTime', '=', false)
    .where('p.createdAtBlock', '>', (periodStartEpoch ?? 0).toString())
    .where('p.createdAtBlock', '<=', periodEndEpoch.toString())
    .where((eb) => createGenericStringFilter(eb.ref('d.dealType'), dealTypes))
    .groupBy('r.token');
}

export function createPoRepOverviewLockedQuery(
  qb: QueryBuilder,
  { dealTypes }: Pick<CreatePoRepOverviewQueryParameters, 'dealTypes'>,
) {
  return createPoRepDealsQuery(qb, { dealTypes: dealTypes })
    .select((eb) => [
      'token_address',
      eb.fn.coalesce(eb.fn.sum('locked_amount'), eb.val(0)).as('amount'),
    ])
    .where('token_address', 'is not', null)
    .groupBy('token_address');
}
