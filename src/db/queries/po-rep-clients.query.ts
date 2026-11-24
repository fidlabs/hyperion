import { sql } from 'kysely';
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

export function createPoRepClientsHistoryQuery(
  qb: QueryBuilder,
  {
    genesisTimestamp,
    windowSize,
    periodStart,
  }: Omit<CreatePoRepClientDealsHistoryQueryParameters, 'clientAddress'>,
) {
  const boundsCTE = qb.selectFrom('po_rep_deal').select((eb) => [
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
  ]);

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

  const clientsFirstDealCTE = qb
    .selectFrom('po_rep_deal')
    .select((eb) => [
      'client',
      eb.fn.min('proposedAtBlock').as('first_deal_epoch'),
    ])
    .groupBy('client');

  const newClientsCTE = qb
    .with('cfd', clientsFirstDealCTE)
    .selectFrom('cfd')
    .select((eb) => [
      truncateToWindowSize(
        filecoinBlockNumberToTimestamp({
          blockNumber: eb.ref('cfd.first_deal_epoch'),
          genesisTimestamp: genesisTimestamp,
        }),
        windowSize,
      ).as('window_start'),
      eb.fn.count('cfd.client').as('new_clients_count'),
    ])
    .groupBy('window_start');

  const datasetsFirstDealCTE = qb
    .selectFrom('po_rep_deal')
    .select((eb) => [eb.fn.min('proposedAtBlock').as('first_deal_epoch')])
    .groupBy(['client', 'manifestHash']);

  const newDatasetsCTE = qb
    .with('dfd', datasetsFirstDealCTE)
    .selectFrom('dfd')
    .select((eb) => [
      truncateToWindowSize(
        filecoinBlockNumberToTimestamp({
          blockNumber: eb.ref('dfd.first_deal_epoch'),
          genesisTimestamp: genesisTimestamp,
        }),
        windowSize,
      ).as('window_start'),
      eb.fn.countAll().as('new_datasets_count'),
    ])
    .groupBy('window_start');

  return qb
    .with('wd', windowDatesCTE)
    .with('nc', newClientsCTE)
    .with('nds', newDatasetsCTE)
    .selectFrom('wd')
    .leftJoin('nc', 'nc.window_start', 'wd.window_start')
    .leftJoin('nds', 'nds.window_start', 'wd.window_start')
    .select((eb) => [
      'wd.window_start',
      eb.fn.coalesce('nc.new_clients_count', eb.val(0)).as('new_clients_count'),
      eb.fn
        .sum(eb.fn.coalesce('nc.new_clients_count', eb.val(0)))
        .over((eb) => eb.orderBy('wd.window_start'))
        .as('total_clients_count'),
      eb.fn
        .sum(eb.fn.coalesce('nds.new_datasets_count', eb.val(0)))
        .over((eb) => eb.orderBy('wd.window_start'))
        .as('total_datasets_count'),
    ])
    .orderBy('wd.window_start');
}

export function createPoRepReturningClientsHistoryQuery(
  qb: QueryBuilder,
  {
    genesisTimestamp,
    windowSize,
    periodStart,
  }: Omit<CreatePoRepClientDealsHistoryQueryParameters, 'clientAddress'>,
) {
  const boundsCTE = qb.selectFrom('po_rep_deal').select((eb) => [
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
  ]);

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

  const dealsCTE = qb.selectFrom('po_rep_deal').select((eb) => [
    'client',
    'proposedAtBlock',
    eb.fn
      .min('proposedAtBlock')
      .over((ob) => ob.partitionBy('client'))
      .as('client_first_deal_epoch'),
    eb.fn
      .min('proposedAtBlock')
      .over((ob) => ob.partitionBy(['client', 'manifestHash']))
      .as('dataset_first_deal_epoch'),
  ]);

  const returningClientsCTE = qb
    .with('d', dealsCTE)
    .selectFrom('d')
    .select((eb) => [
      truncateToWindowSize(
        filecoinBlockNumberToTimestamp({
          blockNumber: eb.ref('d.proposedAtBlock'),
          genesisTimestamp: genesisTimestamp,
        }),
        windowSize,
      ).as('window_start'),
      'd.client',
      eb.fn
        .agg<boolean>('bool_or', [
          eb('d.proposedAtBlock', '=', eb.ref('d.dataset_first_deal_epoch')),
        ])
        .as('onboarded_new_dataset'),
    ])
    .where((eb) =>
      eb(
        truncateToWindowSize(
          filecoinBlockNumberToTimestamp({
            blockNumber: eb.ref('d.client_first_deal_epoch'),
            genesisTimestamp: genesisTimestamp,
          }),
          windowSize,
        ),
        '<',
        truncateToWindowSize(
          filecoinBlockNumberToTimestamp({
            blockNumber: eb.ref('d.proposedAtBlock'),
            genesisTimestamp: genesisTimestamp,
          }),
          windowSize,
        ),
      ),
    )
    .groupBy(['window_start', 'd.client']);

  const windowTotalsCTE = qb
    .with('rc', returningClientsCTE)
    .selectFrom('rc')
    .select((eb) => [
      'rc.window_start',
      eb.fn.countAll().as('returning_clients_count'),
      eb.fn
        .countAll()
        .filterWhere('rc.onboarded_new_dataset', '=', true)
        .as('onboarded_new_datasets_clients_count'),
      eb.fn
        .countAll()
        .filterWhere('rc.onboarded_new_dataset', '=', false)
        .as('extended_deals_clients_count'),
    ])
    .groupBy('rc.window_start');

  return qb
    .with('wd', windowDatesCTE)
    .with('wt', windowTotalsCTE)
    .selectFrom('wd')
    .leftJoin('wt', 'wt.window_start', 'wd.window_start')
    .select((eb) => [
      'wd.window_start',
      eb.fn
        .coalesce('wt.returning_clients_count', eb.val(0))
        .as('returning_clients_count'),
      eb.fn
        .coalesce('wt.onboarded_new_datasets_clients_count', eb.val(0))
        .as('onboarded_new_datasets_clients_count'),
      eb.fn
        .coalesce('wt.extended_deals_clients_count', eb.val(0))
        .as('extended_deals_clients_count'),
    ])
    .orderBy('wd.window_start');
}

export interface CreatePoRepClientsFundsQueryParameters {
  epoch: number;
}

export interface CreatePoRepClientsListQueryParameters {
  currentEpoch: number;
  lowBalanceEpoch: number;
}

export interface CreatePoRepClientsStatisticsQueryParameters {
  periodStartEpoch: number | null;
  periodEndEpoch: number;
}

export function createPoRepClientsFundsQuery(
  qb: QueryBuilder,
  { epoch }: CreatePoRepClientsFundsQueryParameters,
) {
  const clientsQuery = qb.selectFrom('po_rep_deal').select('client');

  const clientsTokensCTE = qb
    .selectFrom('po_rep_deal as d')
    .innerJoin('filecoin_pay_rail as r', 'r.railId', 'd.railId')
    .select(['d.client', 'r.token'])
    .distinct();

  const paymentsQuery = qb
    .selectFrom('filecoin_pay_payment as p')
    .innerJoin('filecoin_pay_rail as r', 'r.railId', 'p.railId')
    .where('p.createdAtBlock', '<=', epoch.toString());

  const fundsChangesCTE = qb
    .selectFrom('filecoin_pay_account_transfer')
    .select(['owner', 'token', 'amount'])
    .where('createdAtBlock', '<=', epoch.toString())
    .where('owner', 'in', clientsQuery)
    .unionAll(
      paymentsQuery
        .select((eb) => [
          'r.from as owner',
          'r.token',
          eb.neg(eb.ref('p.totalAmount')).as('amount'),
        ])
        .where('r.from', 'in', clientsQuery),
    )
    .unionAll(
      paymentsQuery
        .select(['r.to as owner', 'r.token', 'p.netPayeeAmount as amount'])
        .where('r.to', 'in', clientsQuery),
    )
    .unionAll(
      paymentsQuery
        .select([
          'r.serviceFeeRecipient as owner',
          'r.token',
          'p.operatorCommission as amount',
        ])
        .where('r.serviceFeeRecipient', 'in', clientsQuery),
    );

  return qb
    .with('ct', clientsTokensCTE)
    .with('fc', fundsChangesCTE)
    .selectFrom('ct')
    .innerJoin('fc', (join) =>
      join
        .onRef('fc.owner', '=', 'ct.client')
        .onRef('fc.token', '=', 'ct.token'),
    )
    .select((eb) => [
      'ct.client',
      'ct.token',
      eb.fn.sum('fc.amount').as('funds'),
    ])
    .groupBy(['ct.client', 'ct.token']);
}

export function createPoRepClientsListQuery(
  qb: QueryBuilder,
  { currentEpoch, lowBalanceEpoch }: CreatePoRepClientsListQueryParameters,
) {
  const lockupsCTE = qb
    .selectFrom('filecoin_pay_rail')
    .select((eb) => [
      'from as client',
      'token',
      eb.fn
        .sum(
          eb
            .case()
            .when('endEpoch', '=', '0')
            .then(eb.ref('paymentRate'))
            .else('0')
            .end(),
        )
        .as('lockup_rate'),
      eb.fn
        .sum(
          sql<string>`${eb.ref('lockupFixed')} + ${eb.ref('paymentRate')} * (${eb
            .case()
            .when('endEpoch', '=', '0')
            .then(eb.ref('lockupPeriod'))
            .else(eb.ref('endEpoch'))
            .end()} - ${eb.ref('settledUpTo')})`,
        )
        .as('lockup_base'),
    ])
    .where('finalized', '=', false)
    .groupBy(['from', 'token']);

  const accountsCTE = qb
    .with('f', createPoRepClientsFundsQuery(qb, { epoch: currentEpoch }))
    .with('l', lockupsCTE)
    .selectFrom('f')
    .leftJoin('l', (join) =>
      join.onRef('l.client', '=', 'f.client').onRef('l.token', '=', 'f.token'),
    )
    .select((eb) => [
      'f.client',
      'f.funds',
      eb.fn.coalesce('l.lockup_rate', sql.lit('0')).as('lockup_rate'),
      eb.fn.coalesce('l.lockup_base', sql.lit('0')).as('lockup_base'),
      sql<
        string | null
      >`div(${eb.ref('f.funds')} - ${eb.ref('l.lockup_base')}, nullif(${eb.ref('l.lockup_rate')}, 0))`.as(
        'funded_until_epoch',
      ),
    ]);

  const walletsCTE = qb
    .with('a', accountsCTE)
    .selectFrom('a')
    .select((eb) => {
      const isSetUp = eb.or([
        eb('a.funds', '>', '0'),
        eb('a.lockup_rate', '>', '0'),
      ]);
      const availableFunds = sql<string>`${eb.ref('a.funds')} - ${eb.ref('a.lockup_base')} - ${eb.ref('a.lockup_rate')} * least(${eb.ref('a.funded_until_epoch')}, ${currentEpoch})`;

      return [
        'a.client',
        eb
          .case()
          .when(
            eb.fn.agg<boolean>('bool_or', [
              eb.and([isSetUp, eb(availableFunds, '=', '0')]),
            ]),
          )
          .then(sql.lit('empty' as const))
          .when(
            eb.fn.agg<boolean>('bool_or', [
              eb.and([
                isSetUp,
                eb('a.funded_until_epoch', '<', lowBalanceEpoch.toString()),
              ]),
            ]),
          )
          .then(sql.lit('low_balance' as const))
          .when(eb.fn.agg<boolean>('bool_or', [isSetUp]))
          .then(sql.lit('funded' as const))
          .else(sql.lit('not_set_up' as const))
          .end()
          .as('wallet_status'),
      ];
    })
    .groupBy('a.client');

  return qb
    .with('w', walletsCTE)
    .selectFrom('po_rep_deal as d')
    .leftJoin('w', 'w.client', 'd.client')
    .select((eb) => [
      'd.client as client_address',
      eb.fn.count('d.manifestHash').distinct().as('datasets_count'),
      eb.fn
        .coalesce('w.wallet_status', sql.lit('not_set_up' as const))
        .as('wallet_status'),
    ])
    .groupBy(['d.client', 'w.wallet_status']);
}

export function createPoRepClientsStatisticsQuery(
  qb: QueryBuilder,
  {
    periodStartEpoch,
    periodEndEpoch,
  }: CreatePoRepClientsStatisticsQueryParameters,
) {
  const dealsCTE = qb
    .selectFrom('po_rep_deal')
    .select((eb) => [
      'client',
      'manifestHash',
      'proposedAtBlock',
      eb.fn
        .min('proposedAtBlock')
        .over((ob) => ob.partitionBy('client'))
        .as('client_first_deal_epoch'),
    ])
    .where('proposedAtBlock', '<=', periodEndEpoch.toString());

  const fundedClientsCTE = qb
    .with(
      'cf',
      createPoRepClientsFundsQuery(qb, {
        epoch: periodEndEpoch,
      }),
    )
    .selectFrom('cf')
    .select('cf.client')
    .where('cf.funds', '>', '0')
    .distinct();

  return qb
    .with('d', dealsCTE)
    .with('f', fundedClientsCTE)
    .selectFrom('d')
    .leftJoin('f', 'f.client', 'd.client')
    .select((eb) => [
      eb.fn.count('d.client').distinct().as('clients_count'),
      sql<string>`count(distinct (${eb.ref('d.client')}, ${eb.ref('d.manifestHash')}))`.as(
        'datasets_count',
      ),
      eb.fn
        .count('d.client')
        .distinct()
        .filterWhere((eb) =>
          eb.and([
            eb('d.proposedAtBlock', '>', eb.ref('d.client_first_deal_epoch')),
            periodStartEpoch !== null
              ? eb.and([
                  eb('d.proposedAtBlock', '>=', periodStartEpoch.toString()),
                  eb(
                    'd.client_first_deal_epoch',
                    '<',
                    periodStartEpoch.toString(),
                  ),
                ])
              : eb.val(true),
          ]),
        )
        .as('returning_clients_count'),
      eb.fn.count('f.client').distinct().as('funded_clients_count'),
    ]);
}
