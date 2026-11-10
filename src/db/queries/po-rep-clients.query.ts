import { QueryBuilder } from '../query-builder';
import { castToInterval } from './helpers/cast-to-inteval.helper';
import { filecoinBlockNumberToTimestamp } from './helpers/filecoin-block-number-to-timestamp.helper';
import { createPoRepDealsQuery } from './po-rep-deals.query';
import { truncateToWindowSize } from './po-rep-onboarded-data-history.query';

export interface CreatePoRepClientQueryParameters {
  clientAddress: string;
}

export interface CreatePoRepClientSpendQueryParameters extends CreatePoRepClientQueryParameters {
  fromEpoch: number;
}

export interface CreatePoRepClientDealsHistoryQueryParameters extends CreatePoRepClientQueryParameters {
  genesisTimestamp: number | bigint;
  windowSize: 'day' | 'week' | 'month';
  periodStart: Date | null;
}

export function createPoRepClientStatisticsQuery(
  qb: QueryBuilder,
  { clientAddress }: CreatePoRepClientQueryParameters,
) {
  return createPoRepDealsQuery(qb, { clientsAddresses: clientAddress })
    .select((eb) => [
      'client_address',
      eb.fn.count('deal_id').as('deals_count'),
      eb.fn.min('rail_activated_at_epoch').as('first_onboarded_epoch'),
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

export function createPoRepClientDealsHistoryQuery(
  qb: QueryBuilder,
  {
    clientAddress,
    genesisTimestamp,
    windowSize,
    periodStart,
  }: CreatePoRepClientDealsHistoryQueryParameters,
) {
  const boundsCTE = qb
    .selectFrom('po_rep_deal')
    .select((eb) => [
      truncateToWindowSize(
        eb.fn<Date>('least', [
          filecoinBlockNumberToTimestamp({
            blockNumber: eb.fn.min('proposedAtBlock'),
            genesisTimestamp: genesisTimestamp,
          }),
          eb.val(periodStart),
        ]),
        windowSize,
      ).as('start_window'),
      truncateToWindowSize(eb.fn<Date>('now'), windowSize).as('end_window'),
    ])
    .where('client', '=', clientAddress);

  const windowDatesCTE = qb
    .with('bounds', boundsCTE)
    .selectFrom('bounds')
    .select((eb) => [
      eb
        .fn<Date>('generate_series', [
          'bounds.start_window',
          'bounds.end_window',
          castToInterval(`1 ${windowSize}`),
        ])
        .as('window_start'),
    ]);

  const windowTotalsCTE = qb
    .selectFrom('po_rep_deal')
    .select((eb) => [
      truncateToWindowSize(
        filecoinBlockNumberToTimestamp({
          blockNumber: eb.ref('proposedAtBlock'),
          genesisTimestamp: genesisTimestamp,
        }),
        windowSize,
      ).as('window_start'),
      eb.fn.count('dealId').as('window_total'),
    ])
    .where('client', '=', clientAddress)
    .groupBy('window_start');

  return qb
    .with('wd', windowDatesCTE)
    .with('wt', windowTotalsCTE)
    .selectFrom('wd')
    .leftJoin('wt', 'wd.window_start', 'wt.window_start')
    .select((eb) => [
      'wd.window_start',
      eb.fn.coalesce('wt.window_total', eb.val(0)).as('window_total'),
      eb.fn
        .sum(eb.fn.coalesce('wt.window_total', eb.val(0)))
        .over((eb) => eb.orderBy('wd.window_start'))
        .as('cumulative_total'),
    ])
    .orderBy('wd.window_start');
}
