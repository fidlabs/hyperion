import { PoRepDealState } from '../auto-generated/enums';
import { QueryBuilder } from '../query-builder';

export interface CreatePoRepOverviewQueryParameters {
  periodStartEpoch: number | null;
  periodEndEpoch: number;
}

const endedDealStates = [
  PoRepDealState.FINALIZED,
  PoRepDealState.EXPIRED,
  PoRepDealState.EARLY_TERMINATED,
];

export function createPoRepOverviewStatisticsQuery(
  qb: QueryBuilder,
  {
    periodEndEpoch,
  }: Pick<CreatePoRepOverviewQueryParameters, 'periodEndEpoch'>,
) {
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
        .groupBy('d.dealId'),
    )
    .with('deal_period_data', (db) =>
      db
        .selectFrom('deal_activity')
        .select((eb) => [
          'client_address',
          'provider_id',
          eb
            .and([
              eb('activated_at_epoch', '<=', periodEnd),
              eb.or([
                eb('ended_at_epoch', 'is', null),
                eb('ended_at_epoch', '>', periodEnd),
              ]),
            ])
            .as('active'),
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
    ]);
}

export function createPoRepOverviewSettledQuery(
  qb: QueryBuilder,
  { periodStartEpoch, periodEndEpoch }: CreatePoRepOverviewQueryParameters,
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
    .groupBy('r.token');
}
