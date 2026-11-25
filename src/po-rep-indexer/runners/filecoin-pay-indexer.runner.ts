import { randomUUID } from 'crypto';
import { type InsertObject, type Updateable } from 'kysely';
import { chunk, groupBy, last, uniq } from 'lodash';
import { type DB, type TransactionContext } from 'src/db';
import { createFilecoinPayAccountsLockupsQuery } from 'src/db/queries/filecoin-pay-accounts-lockups.query';
import {
  type AbiEvent,
  type Address,
  getAbiItem,
  type GetLogsReturnType,
  isAddressEqual,
} from 'viem';
import FilecoinPayV1ABI from '../abis/filecoin-pay-v1-abi';
import { FILECOIN_PAY_ORIGIN_BLOCK } from '../po-rep-indexer.constants';
import { AbstractPoRepIndexerRunner } from './abstract-po-rep-indexer.runner';

type EventType = (typeof events)[number];
type RailInput = InsertObject<DB, 'filecoin_pay_rail'>;
type PaymentInput = InsertObject<DB, 'filecoin_pay_payment'>;
type AccountTransferInput = InsertObject<DB, 'filecoin_pay_account_transfer'>;
type AccountStateInput = InsertObject<DB, 'filecoin_pay_account_state'>;

type Log = GetLogsReturnType<
  undefined,
  typeof events,
  undefined,
  bigint,
  bigint
>[number];
type Logs = Log[];
type RailLog = Extract<Log, { args: { railId: bigint } }>;

interface RailUpdate {
  values: Updateable<DB['filecoin_pay_rail']>;
  lockupFixedDecrement: bigint;
}

interface RailAccounts {
  token: string;
  from: string;
  to: string;
  serviceFeeRecipient: string;
}

interface AccountFundsChange {
  token: string;
  owner: string;
  amount: bigint;
}

const events = [
  getAbiItem({ abi: FilecoinPayV1ABI, name: 'DepositRecorded' }),
  getAbiItem({ abi: FilecoinPayV1ABI, name: 'WithdrawRecorded' }),
  getAbiItem({ abi: FilecoinPayV1ABI, name: 'RailCreated' }),
  getAbiItem({ abi: FilecoinPayV1ABI, name: 'RailLockupModified' }),
  getAbiItem({ abi: FilecoinPayV1ABI, name: 'RailOneTimePaymentProcessed' }),
  getAbiItem({ abi: FilecoinPayV1ABI, name: 'RailRateModified' }),
  getAbiItem({ abi: FilecoinPayV1ABI, name: 'RailSettled' }),
  getAbiItem({ abi: FilecoinPayV1ABI, name: 'RailTerminated' }),
  getAbiItem({ abi: FilecoinPayV1ABI, name: 'RailFinalized' }),
] as const satisfies AbiEvent[];

function isRailLog(log: Log): log is RailLog {
  return 'railId' in log.args;
}

export class FilecoinPayIndexerRunner extends AbstractPoRepIndexerRunner<EventType> {
  public getName(): string {
    return FilecoinPayIndexerRunner.name;
  }

  protected getOriginBlock(): bigint {
    return FILECOIN_PAY_ORIGIN_BLOCK;
  }

  protected getVersion(): number {
    return 2;
  }

  protected getBatchBlockSize(): bigint {
    return 2n * 60n * 12n; // 12h worth of logs
  }

  protected getEventTypes() {
    return events;
  }

  protected getOriginAddresses(): Address | Address[] | undefined {
    return this.configService.get('FILECOIN_PAY_CONTRACT_ADDRESS');
  }

  protected async cleanup(tx: TransactionContext): Promise<void> {
    await tx.deleteFrom('filecoin_pay_account_state').execute();
    await tx.deleteFrom('filecoin_pay_account_transfer').execute();
    await tx.deleteFrom('filecoin_pay_payment').execute();
    await tx.deleteFrom('filecoin_pay_rail').execute();
  }

  protected getChanges(logs: Logs): Logs {
    return logs;
  }

  protected async updateDb(tx: TransactionContext, logs: Logs): Promise<void> {
    await this.createRails(tx, logs);
    await this.updateRails(tx, logs);
    await this.createPayments(tx, logs);
    await this.createAccountsTransfers(tx, logs);
    await this.updateAccountsFunds(tx, logs);
    await this.updateAccountsLockups(tx, logs);
  }

  private async createRails(tx: TransactionContext, logs: Logs): Promise<void> {
    const rails = logs
      .filter((log) => log.eventName === 'RailCreated')
      .map<RailInput>((log) => {
        return {
          railId: log.args.railId.toString(),
          token: log.args.token,
          from: log.args.payer,
          to: log.args.payee,
          operator: log.args.operator,
          validator: log.args.validator,
          paymentRate: '0',
          lockupPeriod: '0',
          lockupFixed: '0',
          settledUpTo: log.blockNumber.toString(),
          endEpoch: '0',
          // eslint-disable-next-line no-restricted-syntax
          commissionRateBps: Number(log.args.commissionRateBps),
          serviceFeeRecipient: log.args.serviceFeeRecipient,
          finalized: false,
          createdAtBlock: log.blockNumber.toString(),
          activatedAtBlock: '0',
        };
      });

    for (const part of chunk(rails, 1000)) {
      await tx.insertInto('filecoin_pay_rail').values(part).execute();
    }
  }

  private async updateRails(tx: TransactionContext, logs: Logs): Promise<void> {
    const filecoinPayLogs = logs.filter(isRailLog).filter((log) => {
      return isAddressEqual(
        log.address,
        this.configService.get('FILECOIN_PAY_CONTRACT_ADDRESS'),
      );
    });

    const logsGroupedByRail = groupBy(filecoinPayLogs, (log) => {
      return log.args.railId.toString();
    });

    for (const [railId, logsForRail] of Object.entries(logsGroupedByRail)) {
      const { values, lockupFixedDecrement } = logsForRail.reduce<RailUpdate>(
        this.logToRailUpdate,
        { values: {}, lockupFixedDecrement: 0n },
      );

      if (Object.keys(values).length === 0 && lockupFixedDecrement === 0n) {
        continue;
      }

      await tx
        .updateTable('filecoin_pay_rail')
        .set((eb) => ({
          ...values,
          ...(lockupFixedDecrement !== 0n
            ? {
                lockupFixed:
                  typeof values.lockupFixed === 'string'
                    ? (
                        BigInt(values.lockupFixed) - lockupFixedDecrement
                      ).toString()
                    : eb('lockupFixed', '-', lockupFixedDecrement.toString()),
              }
            : {}),
        }))
        .where('railId', '=', railId)
        .execute();
    }
  }

  private async createPayments(
    tx: TransactionContext,
    logs: Logs,
  ): Promise<void> {
    const oneTimePayments = logs
      .filter((log) => log.eventName === 'RailOneTimePaymentProcessed')
      .map<PaymentInput>((log) => {
        const { railId, netPayeeAmount, networkFee, operatorCommission } =
          log.args;
        const totalAmount = netPayeeAmount + networkFee + operatorCommission;

        return {
          id: randomUUID(),
          railId: railId.toString(),
          totalAmount: totalAmount.toString(),
          netPayeeAmount: netPayeeAmount.toString(),
          networkFee: networkFee.toString(),
          operatorCommission: operatorCommission.toString(),
          oneTime: true,
          createdAtBlock: log.blockNumber.toString(),
        };
      });

    const settlements = logs
      .filter((log) => log.eventName === 'RailSettled')
      .map<PaymentInput>((log) => {
        const {
          railId,
          totalSettledAmount,
          totalNetPayeeAmount,
          networkFee,
          operatorCommission,
        } = log.args;

        return {
          id: randomUUID(),
          railId: railId.toString(),
          totalAmount: totalSettledAmount.toString(),
          netPayeeAmount: totalNetPayeeAmount.toString(),
          networkFee: networkFee.toString(),
          operatorCommission: operatorCommission.toString(),
          oneTime: false,
          createdAtBlock: log.blockNumber.toString(),
        };
      });

    for (const part of chunk([...oneTimePayments, ...settlements], 1000)) {
      await tx.insertInto('filecoin_pay_payment').values(part).execute();
    }
  }

  private async createAccountsTransfers(
    tx: TransactionContext,
    logs: Logs,
  ): Promise<void> {
    const deposits = logs
      .filter((log) => log.eventName === 'DepositRecorded')
      .map<AccountTransferInput>((log) => {
        return {
          id: randomUUID(),
          token: log.args.token,
          owner: log.args.to,
          amount: log.args.amount.toString(),
          createdAtBlock: log.blockNumber.toString(),
        };
      });

    const withdrawals = logs
      .filter((log) => log.eventName === 'WithdrawRecorded')
      .map<AccountTransferInput>((log) => {
        return {
          id: randomUUID(),
          token: log.args.token,
          owner: log.args.from,
          amount: (-log.args.amount).toString(),
          createdAtBlock: log.blockNumber.toString(),
        };
      });

    for (const part of chunk([...deposits, ...withdrawals], 1000)) {
      await tx
        .insertInto('filecoin_pay_account_transfer')
        .values(part)
        .execute();
    }
  }

  private async updateAccountsFunds(
    tx: TransactionContext,
    logs: Logs,
  ): Promise<void> {
    const railsAccounts = await this.getRailsAccounts(tx, logs);

    const fundsChanges = logs.flatMap<AccountFundsChange>((log) => {
      switch (log.eventName) {
        case 'DepositRecorded':
          return [
            {
              token: log.args.token,
              owner: log.args.to,
              amount: log.args.amount,
            },
          ];
        case 'WithdrawRecorded':
          return [
            {
              token: log.args.token,
              owner: log.args.from,
              amount: -log.args.amount,
            },
          ];
        case 'RailSettled':
          return this.paymentToFundsChanges(
            railsAccounts.get(log.args.railId.toString()),
            log.args.totalSettledAmount,
            log.args.totalNetPayeeAmount,
            log.args.operatorCommission,
          );
        case 'RailOneTimePaymentProcessed':
          return this.paymentToFundsChanges(
            railsAccounts.get(log.args.railId.toString()),
            log.args.netPayeeAmount +
              log.args.networkFee +
              log.args.operatorCommission,
            log.args.netPayeeAmount,
            log.args.operatorCommission,
          );
        default:
          return [];
      }
    });

    const changesGroupedByAccount = groupBy(
      fundsChanges.filter((change) => change.amount !== 0n),
      (change) => `${change.owner}-${change.token}`,
    );

    const accountsStates = Object.values(
      changesGroupedByAccount,
    ).map<AccountStateInput>((accountChanges) => {
      const { token, owner } = accountChanges[0];

      return {
        owner: owner,
        token: token,
        funds: accountChanges
          .reduce((sum, change) => sum + change.amount, 0n)
          .toString(),
        lockupCurrent: '0',
        lockupRate: '0',
        lockupLastSettledAt: '0',
      };
    });

    for (const part of chunk(accountsStates, 1000)) {
      await tx
        .insertInto('filecoin_pay_account_state')
        .values(part)
        .onConflict((oc) =>
          oc.columns(['owner', 'token']).doUpdateSet((eb) => ({
            funds: eb(
              'filecoin_pay_account_state.funds',
              '+',
              eb.ref('excluded.funds'),
            ),
          })),
        )
        .execute();
    }
  }

  private paymentToFundsChanges(
    railAccounts: RailAccounts | undefined,
    totalAmount: bigint,
    netPayeeAmount: bigint,
    operatorCommission: bigint,
  ): AccountFundsChange[] {
    if (!railAccounts) {
      return [];
    }

    const { token, from, to, serviceFeeRecipient } = railAccounts;

    return [
      { token: token, owner: from, amount: -totalAmount },
      { token: token, owner: to, amount: netPayeeAmount },
      { token: token, owner: serviceFeeRecipient, amount: operatorCommission },
    ];
  }

  private async getRailsAccounts(
    tx: TransactionContext,
    logs: Logs,
  ): Promise<Map<string, RailAccounts>> {
    const railsIds = this.getRailsIds(logs);

    if (railsIds.length === 0) {
      return new Map();
    }

    const rails = await tx
      .selectFrom('filecoin_pay_rail')
      .select(['railId', 'token', 'from', 'to', 'serviceFeeRecipient'])
      .where('railId', 'in', railsIds)
      .execute();

    return new Map(rails.map((rail) => [rail.railId, rail]));
  }

  private async updateAccountsLockups(
    tx: TransactionContext,
    logs: Logs,
  ): Promise<void> {
    const railsIds = this.getRailsIds(logs);

    if (railsIds.length === 0) {
      return;
    }

    await tx
      .insertInto('filecoin_pay_account_state')
      .columns([
        'owner',
        'token',
        'lockupCurrent',
        'lockupRate',
        'lockupLastSettledAt',
      ])
      .expression(
        createFilecoinPayAccountsLockupsQuery(tx, {
          railsIds: railsIds,
          epoch: last(logs).blockNumber.toString(),
        }),
      )
      .onConflict((oc) =>
        oc.columns(['owner', 'token']).doUpdateSet((eb) => ({
          lockupCurrent: eb.ref('excluded.lockupCurrent'),
          lockupRate: eb.ref('excluded.lockupRate'),
          lockupLastSettledAt: eb.ref('excluded.lockupLastSettledAt'),
        })),
      )
      .execute();
  }

  private getRailsIds(logs: Logs): string[] {
    return uniq(
      logs.filter(isRailLog).map((log) => log.args.railId.toString()),
    );
  }

  private logToRailUpdate(previousUpdate: RailUpdate, log: Log): RailUpdate {
    switch (log.eventName) {
      case 'RailLockupModified':
        return {
          values: {
            ...previousUpdate.values,
            lockupPeriod: log.args.newLockupPeriod.toString(),
            lockupFixed: log.args.newLockupFixed.toString(),
          },
          lockupFixedDecrement: 0n,
        };
      case 'RailRateModified':
        return {
          ...previousUpdate,
          values: {
            ...previousUpdate.values,
            paymentRate: log.args.newRate.toString(),
            ...(log.args.oldRate === 0n && log.args.newRate > 0n
              ? {
                  activatedAtBlock: log.blockNumber.toString(),
                  settledUpTo: log.blockNumber.toString(),
                }
              : {}),
          },
        };
      case 'RailSettled':
        return {
          ...previousUpdate,
          values: {
            ...previousUpdate.values,
            settledUpTo: log.args.settledUpTo.toString(),
          },
        };
      case 'RailTerminated':
        return {
          ...previousUpdate,
          values: {
            ...previousUpdate.values,
            endEpoch: log.args.endEpoch.toString(),
          },
        };
      case 'RailFinalized':
        // On-chain, when rail is finalized, all adresses, rate, lockups etc.
        // are reset to zero. We instead set a flag and keep the data.
        return {
          values: {
            ...previousUpdate.values,
            lockupFixed: '0',
            finalized: true,
          },
          lockupFixedDecrement: 0n,
        };
      case 'RailOneTimePaymentProcessed':
        return {
          ...previousUpdate,
          lockupFixedDecrement:
            previousUpdate.lockupFixedDecrement +
            log.args.netPayeeAmount +
            log.args.networkFee +
            log.args.operatorCommission,
        };
      default:
        return previousUpdate;
    }
  }
}
