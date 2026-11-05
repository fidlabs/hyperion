import { sql } from 'kysely';
import { PoRepDealState } from '../auto-generated/enums';
import { QueryBuilder } from '../query-builder';
import { castToInterval } from './helpers/cast-to-inteval.helper';
import { filecoinBlockNumberToTimestamp } from './helpers/filecoin-block-number-to-timestamp.helper';
import { truncateToWindowSize } from './po-rep-onboarded-data-history.query';

export interface PoRepProvidersStatisticsQueryParameters {
  periodStartEpoch: number | null;
  periodEndEpoch: number;
}

export interface PoRepProvidersHistoryQueryParameters {
  genesisTimestamp: number | bigint;
  windowSize: 'day' | 'week' | 'month';
  periodStart: Date | null;
}

const endedDealStates = [
  PoRepDealState.FINALIZED,
  PoRepDealState.EXPIRED,
  PoRepDealState.EARLY_TERMINATED,
];

function createPoRepDealActivityQuery(qb: QueryBuilder) {
  return qb
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
    .groupBy('d.dealId');
}

export function createPoRepActiveProvidersCountQuery(
  qb: QueryBuilder,
  {
    periodEndEpoch,
  }: Pick<PoRepProvidersStatisticsQueryParameters, 'periodEndEpoch'>,
) {
  const periodEnd = periodEndEpoch.toString();

  return qb
    .with('deal_activity', createPoRepDealActivityQuery(qb))
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

export function createPoRepProvidersHistoryQuery(
  qb: QueryBuilder,
  {
    genesisTimestamp,
    windowSize,
    periodStart,
  }: PoRepProvidersHistoryQueryParameters,
) {
  const windowInterval = castToInterval(`1 ${windowSize}`);

  const boundsCTE = qb.selectFrom('po_rep_storage_provider').select((eb) => [
    truncateToWindowSize(
      eb.fn<Date>('least', [
        filecoinBlockNumberToTimestamp({
          blockNumber: eb.fn.min('registeredAtBlock'),
          genesisTimestamp: genesisTimestamp,
        }),
        eb.val(periodStart),
      ]),
      windowSize,
    ).as('start_window'),
    truncateToWindowSize(eb.fn<Date>('now'), windowSize).as('end_window'),
  ]);

  const windowDatesCTE = qb
    .with('bounds', boundsCTE)
    .selectFrom('bounds')
    .select((eb) => [
      eb
        .fn<Date>('generate_series', [
          'bounds.start_window',
          'bounds.end_window',
          windowInterval,
        ])
        .as('window_start'),
    ]);

  const registrationsCTE = qb
    .selectFrom('po_rep_storage_provider')
    .select((eb) => [
      truncateToWindowSize(
        filecoinBlockNumberToTimestamp({
          blockNumber: eb.ref('registeredAtBlock'),
          genesisTimestamp: genesisTimestamp,
        }),
        windowSize,
      ).as('window_start'),
      eb.fn.count('providerId').as('new_providers_count'),
    ])
    .groupBy('window_start');

  const activeProvidersCTE = qb
    .with('wd', windowDatesCTE)
    .with('deal_activity', createPoRepDealActivityQuery(qb))
    .selectFrom('wd')
    .innerJoin('deal_activity as da', (join) =>
      join.on((eb) =>
        eb.and([
          eb(
            filecoinBlockNumberToTimestamp({
              blockNumber: eb.ref('da.activated_at_epoch'),
              genesisTimestamp: genesisTimestamp,
            }),
            '<',
            sql<Date>`${eb.ref('wd.window_start')} + ${windowInterval}`,
          ),
          eb.or([
            eb('da.ended_at_epoch', 'is', null),
            eb(
              filecoinBlockNumberToTimestamp({
                blockNumber: eb.ref('da.ended_at_epoch'),
                genesisTimestamp: genesisTimestamp,
              }),
              '>=',
              eb.ref('wd.window_start'),
            ),
          ]),
        ]),
      ),
    )
    .select((eb) => [
      'wd.window_start',
      eb.fn.count('da.provider_id').distinct().as('active_providers_count'),
    ])
    .groupBy('wd.window_start');

  return qb
    .with('wd', windowDatesCTE)
    .with('reg', registrationsCTE)
    .with('ap', activeProvidersCTE)
    .selectFrom('wd')
    .leftJoin('reg', 'reg.window_start', 'wd.window_start')
    .leftJoin('ap', 'ap.window_start', 'wd.window_start')
    .select((eb) => [
      'wd.window_start',
      eb.fn
        .coalesce('reg.new_providers_count', eb.val(0))
        .as('new_providers_count'),
      eb.fn
        .sum(eb.fn.coalesce('reg.new_providers_count', eb.val(0)))
        .over((eb) => eb.orderBy('wd.window_start'))
        .as('total_providers_count'),
      eb.fn
        .coalesce('ap.active_providers_count', eb.val(0))
        .as('active_providers_count'),
    ])
    .orderBy('wd.window_start');
}
