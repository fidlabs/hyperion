import { QueryBuilder } from '../query-builder';

export interface CreateFilecoinPayAccountsLockupsQueryParameters {
  railsIds: string[];
  epoch: string;
}

export function createFilecoinPayAccountsLockupsQuery(
  qb: QueryBuilder,
  { railsIds, epoch }: CreateFilecoinPayAccountsLockupsQueryParameters,
) {
  return qb
    .selectFrom('filecoin_pay_rail as r')
    .select((eb) => [
      'r.from as owner',
      'r.token',
      eb.fn
        .coalesce(
          eb.fn
            .sum<string>(
              eb(
                'r.lockupFixed',
                '+',
                eb(
                  'r.paymentRate',
                  '*',
                  eb.parens(
                    eb(
                      eb
                        .case()
                        .when('r.endEpoch', '=', '0')
                        .then(eb('r.lockupPeriod', '+', epoch))
                        .else(eb.ref('r.endEpoch'))
                        .end(),
                      '-',
                      eb.ref('r.settledUpTo'),
                    ),
                  ),
                ),
              ),
            )
            .filterWhere('r.finalized', '=', false),
          eb.cast<string>(eb.lit(0), 'numeric'),
        )
        .as('lockup_current'),
      eb.fn
        .coalesce(
          eb.fn
            .sum<string>('r.paymentRate')
            .filterWhere('r.finalized', '=', false)
            .filterWhere('r.endEpoch', '=', '0'),
          eb.cast<string>(eb.lit(0), 'numeric'),
        )
        .as('lockup_rate'),
      eb.cast<string>(eb.val(epoch), 'bigint').as('lockup_last_settled_at'),
    ])
    .where((eb) =>
      eb(
        eb.refTuple('r.from', 'r.token'),
        'in',
        qb
          .selectFrom('filecoin_pay_rail')
          .select(['from', 'token'])
          .where('railId', 'in', railsIds)
          .$asTuple('from', 'token'),
      ),
    )
    .groupBy(['r.from', 'r.token']);
}
