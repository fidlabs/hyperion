import { F0Id } from 'src/utils/utils';
import { F0IdInput } from 'src/utils/validators';
import { QueryBuilder } from '../query-builder';

export interface PoRepProviderRevenueQueryParameters {
  providerId: F0Id | F0IdInput;
  currentPeriodStartEpoch: number;
  previousPeriodStartEpoch: number;
}

export function createPoRepProviderRevenueQuery(
  qb: QueryBuilder,
  {
    providerId,
    currentPeriodStartEpoch,
    previousPeriodStartEpoch,
  }: PoRepProviderRevenueQueryParameters,
) {
  const providerIdString = F0Id.from(providerId).toBigInt().toString();

  return qb
    .selectFrom('filecoin_pay_payment as p')
    .innerJoin('filecoin_pay_rail as r', 'r.railId', 'p.railId')
    .innerJoin('po_rep_deal as d', 'd.railId', 'p.railId')
    .select((eb) => [
      'r.token as token_address',
      eb.fn
        .coalesce(eb.fn.sum('p.netPayeeAmount'), eb.val(0))
        .as('total_net_amount_settled'),
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
        .as('current_period_net_amount_settled'),
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
        .as('previous_period_net_amount_settled'),
    ])
    .where('p.oneTime', '=', false)
    .where('d.providerId', '=', providerIdString)
    .groupBy('r.token');
}
