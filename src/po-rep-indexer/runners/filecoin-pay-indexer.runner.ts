import { groupBy, uniq } from 'lodash';
import { Prisma } from '../../generated/prisma/client';
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
type RailCreationInput = Prisma.filecoin_pay_railCreateManyInput;
type PaymentCreationInput = Prisma.filecoin_pay_paymentCreateManyInput;
type RailUpdateInput = Prisma.filecoin_pay_railUpdateManyMutationInput;
type AccountTransferCreationInput =
  Prisma.filecoin_pay_account_transferCreateManyInput;

type Log = GetLogsReturnType<
  undefined,
  typeof events,
  undefined,
  bigint,
  bigint
>[number];
type Logs = Log[];
type RailLog = Extract<Log, { args: { railId: bigint } }>;

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

  protected prepareCleanup(): Prisma.PrismaPromise<unknown>[] {
    return [
      this.prismaService.filecoin_pay_account_state.deleteMany(),
      this.prismaService.filecoin_pay_account_transfer.deleteMany(),
      this.prismaService.filecoin_pay_payment.deleteMany(),
      this.prismaService.filecoin_pay_rail.deleteMany(),
    ];
  }

  protected async prepareUpdates(
    logs: Logs,
  ): Promise<Prisma.PrismaPromise<unknown>[]> {
    const accountsFundsUpdates = await this.prepareAccountsFundsUpdates(logs);

    return [
      ...this.prepareRailsCreations(logs),
      ...this.prepareRailUpdates(logs),
      ...this.preparePaymentsCreations(logs),
      ...this.prepareAccountsTransfersCreations(logs),
      ...accountsFundsUpdates,
      ...this.prepareAccountsLockupsUpdates(logs),
    ];
  }

  private prepareRailsCreations(logs: Logs): Prisma.PrismaPromise<unknown>[] {
    const createLogs = logs.filter((log) => {
      return log.eventName === 'RailCreated';
    });

    if (createLogs.length === 0) {
      return [];
    }

    return [
      this.prismaService.filecoin_pay_rail.createMany({
        data: createLogs.map<RailCreationInput>((log) => {
          return {
            railId: log.args.railId,
            token: log.args.token,
            from: log.args.payer,
            to: log.args.payee,
            operator: log.args.operator,
            validator: log.args.validator,
            settledUpTo: log.blockNumber,
            // eslint-disable-next-line no-restricted-syntax
            commissionRateBps: Number(log.args.commissionRateBps),
            serviceFeeRecipient: log.args.serviceFeeRecipient,
            createdAtBlock: log.blockNumber,
          };
        }),
      }),
    ];
  }

  private prepareRailUpdates(logs: Logs): Prisma.PrismaPromise<unknown>[] {
    const filecoinPayLogs = logs.filter(isRailLog).filter((log) => {
      return isAddressEqual(
        log.address,
        this.configService.get('FILECOIN_PAY_CONTRACT_ADDRESS'),
      );
    });

    const logsGroupedByRail = groupBy(filecoinPayLogs, (log) => {
      return log.args.railId.toString();
    });

    return Object.entries(logsGroupedByRail).map(([railId, logsForRail]) => {
      // We use `updateMany` here because we want to skip updated on rail we
      // dont have registered (they were created before runner's origin block)
      return this.prismaService.filecoin_pay_rail.updateMany({
        data: logsForRail.reduce(this.logToRailUpdateInput, {}),
        where: {
          railId: BigInt(railId),
        },
      });
    });
  }

  private preparePaymentsCreations(
    logs: Logs,
  ): Prisma.PrismaPromise<unknown>[] {
    if (logs.length === 0) {
      return [];
    }

    const oneTimePaymentsCreations = logs
      .filter((log) => log.eventName === 'RailOneTimePaymentProcessed')
      .map<PaymentCreationInput>((log) => {
        const { railId, netPayeeAmount, networkFee, operatorCommission } =
          log.args;
        const totalAmount = netPayeeAmount + networkFee + operatorCommission;

        return {
          railId: railId,
          totalAmount: totalAmount.toString(),
          netPayeeAmount: netPayeeAmount.toString(),
          networkFee: networkFee.toString(),
          operatorCommission: operatorCommission.toString(),
          oneTime: true,
          createdAtBlock: log.blockNumber,
        };
      });

    const settlementsCreations = logs
      .filter((log) => log.eventName === 'RailSettled')
      .map<PaymentCreationInput>((log) => {
        const {
          railId,
          totalSettledAmount,
          totalNetPayeeAmount,
          networkFee,
          operatorCommission,
        } = log.args;

        return {
          railId: railId,
          totalAmount: totalSettledAmount.toString(),
          netPayeeAmount: totalNetPayeeAmount.toString(),
          networkFee: networkFee.toString(),
          operatorCommission: operatorCommission.toString(),
          oneTime: false,
          createdAtBlock: log.blockNumber,
        };
      });

    return [
      this.prismaService.filecoin_pay_payment.createMany({
        data: [...oneTimePaymentsCreations, ...settlementsCreations],
      }),
    ];
  }

  private prepareAccountsTransfersCreations(
    logs: Logs,
  ): Prisma.PrismaPromise<unknown>[] {
    if (logs.length === 0) {
      return [];
    }

    const depositsCreations = logs
      .filter((log) => log.eventName === 'DepositRecorded')
      .map<AccountTransferCreationInput>((log) => {
        return {
          token: log.args.token,
          owner: log.args.to,
          amount: log.args.amount.toString(),
          createdAtBlock: log.blockNumber,
        };
      });

    const withdrawalsCreations = logs
      .filter((log) => log.eventName === 'WithdrawRecorded')
      .map<AccountTransferCreationInput>((log) => {
        return {
          token: log.args.token,
          owner: log.args.from,
          amount: (-log.args.amount).toString(),
          createdAtBlock: log.blockNumber,
        };
      });

    return [
      this.prismaService.filecoin_pay_account_transfer.createMany({
        data: [...depositsCreations, ...withdrawalsCreations],
      }),
    ];
  }

  private async prepareAccountsFundsUpdates(
    logs: Logs,
  ): Promise<Prisma.PrismaPromise<unknown>[]> {
    const railsAccounts = await this.getRailsAccounts(logs);

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
            railsAccounts.get(log.args.railId),
            log.args.totalSettledAmount,
            log.args.totalNetPayeeAmount,
            log.args.operatorCommission,
          );
        case 'RailOneTimePaymentProcessed':
          return this.paymentToFundsChanges(
            railsAccounts.get(log.args.railId),
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

    return Object.values(changesGroupedByAccount).map((accountChanges) => {
      const { token, owner } = accountChanges[0];
      const fundsChange = accountChanges
        .reduce((sum, change) => sum + change.amount, 0n)
        .toString();

      return this.prismaService.filecoin_pay_account_state.upsert({
        where: {
          owner_token: {
            owner: owner,
            token: token,
          },
        },
        create: {
          owner: owner,
          token: token,
          funds: fundsChange,
        },
        update: {
          funds: {
            increment: fundsChange,
          },
        },
      });
    });
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
    logs: Logs,
  ): Promise<Map<bigint, RailAccounts>> {
    const railsAccounts = new Map<bigint, RailAccounts>();

    logs.forEach((log) => {
      if (log.eventName === 'RailCreated') {
        railsAccounts.set(log.args.railId, {
          token: log.args.token,
          from: log.args.payer,
          to: log.args.payee,
          serviceFeeRecipient: log.args.serviceFeeRecipient,
        });
      }
    });

    const missingRailsIds = uniq(
      logs.filter(isRailLog).map((log) => log.args.railId),
    ).filter((railId) => !railsAccounts.has(railId));

    if (missingRailsIds.length === 0) {
      return railsAccounts;
    }

    const savedRails = await this.prismaService.filecoin_pay_rail.findMany({
      where: {
        railId: {
          in: missingRailsIds,
        },
      },
    });

    savedRails.forEach((rail) => {
      railsAccounts.set(rail.railId, rail);
    });

    return railsAccounts;
  }

  private prepareAccountsLockupsUpdates(
    logs: Logs,
  ): Prisma.PrismaPromise<unknown>[] {
    const railsIds = uniq(logs.filter(isRailLog).map((log) => log.args.railId));

    if (railsIds.length === 0) {
      return [];
    }

    const lastBlock = logs[logs.length - 1].blockNumber;

    return [
      this.prismaService.$executeRaw`
        INSERT INTO "filecoin_pay_account_state" (
          "owner",
          "token",
          "lockupCurrent",
          "lockupRate",
          "lockupLastSettledAt"
        )
        SELECT
          "from",
          "token",
          COALESCE(
            SUM(
              "lockupFixed" + "paymentRate" * (
                CASE
                  WHEN "endEpoch" = 0 THEN "lockupPeriod" + ${lastBlock}::bigint
                  ELSE "endEpoch"
                END - "settledUpTo"
              )
            ) FILTER (WHERE NOT "finalized"),
            0
          ),
          COALESCE(
            SUM("paymentRate") FILTER (WHERE NOT "finalized" AND "endEpoch" = 0),
            0
          ),
          ${lastBlock}::bigint
        FROM "filecoin_pay_rail"
        WHERE ("from", "token") IN (
          SELECT "from", "token"
          FROM "filecoin_pay_rail"
          WHERE "railId" IN (${Prisma.join(railsIds)})
        )
        GROUP BY "from", "token"
        ON CONFLICT ("owner", "token") DO UPDATE SET
          "lockupCurrent" = EXCLUDED."lockupCurrent",
          "lockupRate" = EXCLUDED."lockupRate",
          "lockupLastSettledAt" = EXCLUDED."lockupLastSettledAt"
      `,
    ];
  }

  private logToRailUpdateInput(
    previousUpdateInput: RailUpdateInput,
    log: Log,
  ): RailUpdateInput {
    switch (log.eventName) {
      case 'RailLockupModified':
        return {
          ...previousUpdateInput,
          lockupPeriod: log.args.newLockupPeriod,
          lockupFixed: log.args.newLockupFixed.toString(),
        };
      case 'RailRateModified':
        return {
          ...previousUpdateInput,
          paymentRate: log.args.newRate.toString(),
          ...(log.args.oldRate === 0n && log.args.newRate > 0n
            ? {
                activatedAtBlock: log.blockNumber,
                settledUpTo: log.blockNumber,
              }
            : {}),
        };
      case 'RailSettled':
        return {
          ...previousUpdateInput,
          settledUpTo: log.args.settledUpTo,
        };
      case 'RailTerminated':
        return {
          ...previousUpdateInput,
          endEpoch: log.args.endEpoch,
        };
      case 'RailFinalized':
        // On-chain, when rail is finalized, all adresses, rate, lockups etc.
        // are reset to zero. We instead set a flag and keep the data.
        return {
          ...previousUpdateInput,
          lockupFixed: 0,
          finalized: true,
        };
      case 'RailOneTimePaymentProcessed': {
        const { lockupFixed } = previousUpdateInput;
        const paymentAmount =
          log.args.netPayeeAmount +
          log.args.networkFee +
          log.args.operatorCommission;

        if (typeof lockupFixed === 'string') {
          return {
            ...previousUpdateInput,
            lockupFixed: (BigInt(lockupFixed) - paymentAmount).toString(),
          };
        }

        const previousDecrement =
          typeof lockupFixed === 'object' && 'decrement' in lockupFixed
            ? BigInt(lockupFixed.decrement?.toString() ?? 0)
            : 0n;

        return {
          ...previousUpdateInput,
          lockupFixed: {
            decrement: (previousDecrement + paymentAmount).toString(),
          },
        };
      }
      default:
        return previousUpdateInput;
    }
  }
}
