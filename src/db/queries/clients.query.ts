import { sql } from 'kysely';
import { QueryBuilder } from '../query-builder';

export type ClientService = 'fcss' | 'fwss';

export interface CreateClientsDatasetsQueryParameters {
  service: ClientService | 'all';
}

export interface CreateClientsListQueryParameters extends CreateClientsDatasetsQueryParameters {
  currentEpoch: number;
  lowBalanceEpoch: number;
}

function createClientsDatasetsQuery(
  qb: QueryBuilder,
  { service }: CreateClientsDatasetsQueryParameters,
) {
  const datasetsCTE = qb
    .selectFrom('po_rep_deal as d')
    .leftJoin('filecoin_pay_rail as r', 'r.railId', 'd.railId')
    .select([
      sql.lit<ClientService>('fcss').as('service'),
      'd.client',
      'd.manifestHash as dataset',
      'r.token',
    ])
    .distinct();

  return qb
    .with('ds', datasetsCTE)
    .selectFrom('ds')
    .select(['ds.service', 'ds.client', 'ds.dataset', 'ds.token'])
    .$if(service !== 'all', (query) =>
      query.where('ds.service', '=', service as ClientService),
    );
}

export function createClientsCountQuery(
  qb: QueryBuilder,
  parameters: CreateClientsDatasetsQueryParameters,
) {
  return qb
    .with('cd', createClientsDatasetsQuery(qb, parameters))
    .selectFrom('cd')
    .select((eb) => [eb.fn.count('cd.client').distinct().as('count')]);
}

export function createClientsListQuery(
  qb: QueryBuilder,
  { service, currentEpoch, lowBalanceEpoch }: CreateClientsListQueryParameters,
) {
  return qb
    .with('cd', createClientsDatasetsQuery(qb, { service: service }))
    .with('ct', (db) =>
      db
        .selectFrom('cd')
        .select(['cd.client', 'cd.token'])
        .where('cd.token', 'is not', null)
        .distinct(),
    )
    .with('a', (db) =>
      db
        .selectFrom('ct')
        .innerJoin('filecoin_pay_account_state as s', (join) =>
          join
            .onRef('s.owner', '=', 'ct.client')
            .onRef('s.token', '=', 'ct.token'),
        )
        .select((eb) => [
          'ct.client',
          's.funds',
          's.lockupCurrent',
          's.lockupRate',
          's.lockupLastSettledAt',
          sql<
            string | null
          >`${eb.ref('s.lockupLastSettledAt')} + div(${eb.ref('s.funds')} - ${eb.ref('s.lockupCurrent')}, nullif(${eb.ref('s.lockupRate')}, 0))`.as(
            'funded_until_epoch',
          ),
        ]),
    )
    .with('w', (db) =>
      db
        .selectFrom('a')
        .select((eb) => {
          const isSetUp = eb.or([
            eb('a.funds', '>', '0'),
            eb('a.lockupRate', '>', '0'),
          ]);
          const availableFunds = sql<string>`${eb.ref('a.funds')} - ${eb.ref('a.lockupCurrent')} - ${eb.ref('a.lockupRate')} * (least(${eb.ref('a.funded_until_epoch')}, ${currentEpoch}) - ${eb.ref('a.lockupLastSettledAt')})`;

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
        .groupBy('a.client'),
    )
    .selectFrom('cd')
    .leftJoin('w', 'w.client', 'cd.client')
    .select((eb) => [
      'cd.client as client_address',
      sql<string>`count(distinct (${eb.ref('cd.service')}, ${eb.ref('cd.dataset')}))`.as(
        'datasets_count',
      ),
      eb.fn
        .count<string>('cd.dataset')
        .distinct()
        .filterWhere('cd.service', '=', 'fcss')
        .as('fcss_datasets_count'),
      eb.fn
        .coalesce('w.wallet_status', sql.lit('not_set_up' as const))
        .as('wallet_status'),
    ])
    .groupBy(['cd.client', 'w.wallet_status']);
}
