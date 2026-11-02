import { PoRepDealState } from '../auto-generated/enums';
import { QueryBuilder } from '../query-builder';

export interface PoRepProvidersStatisticsQueryParameters {
  periodStartEpoch: number | null;
  periodEndEpoch: number;
}

const endedDealStates = [
  PoRepDealState.FINALIZED,
  PoRepDealState.EXPIRED,
  PoRepDealState.EARLY_TERMINATED,
];

export function createPoRepActiveProvidersCountQuery(
  qb: QueryBuilder,
  {
    periodEndEpoch,
  }: Pick<PoRepProvidersStatisticsQueryParameters, 'periodEndEpoch'>,
) {
  const periodEnd = periodEndEpoch.toString();

  return qb
    .with('deal_activity', (db) =>
      db
        .selectFrom('po_rep_deal as d')
        .leftJoin('po_rep_deal_state_change as sc', 'sc.deal_id', 'd.dealId')
        .select((eb) => [
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
    .selectFrom('deal_activity')
    .select((eb) =>
      eb.fn.count('provider_id').distinct().as('active_providers_count'),
    )
    .where('activated_at_epoch', '<=', periodEnd)
    .where((eb) =>
      eb.or([
        eb('ended_at_epoch', 'is', null),
        eb('ended_at_epoch', '>', periodEnd),
      ]),
    );
}

export function createPoRepProvidersEarningsQuery(
  qb: QueryBuilder,
  { periodStartEpoch, periodEndEpoch }: PoRepProvidersStatisticsQueryParameters,
) {
  return qb
    .selectFrom('filecoin_pay_payment as p')
    .innerJoin('filecoin_pay_rail as r', 'r.railId', 'p.railId')
    .innerJoin('po_rep_deal as d', 'd.railId', 'p.railId')
    .select((eb) => [
      'r.token as token_address',
      eb.fn.coalesce(eb.fn.sum('p.netPayeeAmount'), eb.val(0)).as('net_amount'),
    ])
    .where('p.oneTime', '=', false)
    .where('p.createdAtBlock', '>', (periodStartEpoch ?? 0).toString())
    .where('p.createdAtBlock', '<=', periodEndEpoch.toString())
    .groupBy('r.token');
}
