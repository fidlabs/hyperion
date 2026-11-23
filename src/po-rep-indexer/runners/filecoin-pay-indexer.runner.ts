import { groupBy, uniq, uniqBy } from 'lodash';
import { type Prisma } from '../../generated/prisma/client';
import {
  type AbiEvent,
  type Address,
  getAbiItem,
  getAddress,
  type GetLogsReturnType,
  isAddressEqual,
} from 'viem';
import FilecoinPayV1ABI from '../abis/filecoin-pay-v1-abi';
import { PO_REP_ORIGIN_BLOCK } from '../po-rep-indexer.constants';
import { AbstractPoRepIndexerRunner } from './abstract-po-rep-indexer.runner';

type EventType = (typeof events)[number];
type RailCreationInput = Prisma.filecoin_pay_railCreateManyInput;
type PaymentCreationInput = Prisma.filecoin_pay_paymentCreateManyInput;
type RailUpdateInput = Prisma.filecoin_pay_railUpdateManyMutationInput;
type AccountStateCreationInput =
  Prisma.filecoin_pay_account_stateCreateManyInput;

type Log = GetLogsReturnType<
  undefined,
  typeof events,
  undefined,
  bigint,
  bigint
>[number];
type Logs = Log[];
type RailLog = Extract<Log, { args: { railId: bigint } }>;

const events = [
  getAbiItem({ abi: FilecoinPayV1ABI, name: 'AccountLockupSettled' }),
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
    // We only care about rails and payments created after the creation of
    // PoRep contracts
    return PO_REP_ORIGIN_BLOCK;
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
      this.prismaService.filecoin_pay_payment.deleteMany(),
      this.prismaService.filecoin_pay_rail.deleteMany(),
    ];
  }

  protected async prepareUpdates(
    logs: Logs,
  ): Promise<Prisma.PrismaPromise<unknown>[]> {
    return [
      ...this.prepareRailsCreations(logs),
      ...this.prepareRailUpdates(logs),
      ...this.preparePaymentsCreations(logs),
      ...(await this.prepareAccountsStatesCreations(logs)),
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

  private async prepareAccountsStatesCreations(
    logs: Logs,
  ): Promise<Prisma.PrismaPromise<unknown>[]> {
    if (logs.length === 0) {
      return [];
    }

    const rails = await this.prismaService.filecoin_pay_rail.findMany({
      where: {
        railId: {
          in: logs.filter(isRailLog).map((log) => log.args.railId),
        },
      },
    });
    const railsPayers = new Map(
      rails.map((rail) => [
        rail.railId,
        { token: rail.token, owner: rail.from },
      ]),
    );

    logs.forEach((log) => {
      if (log.eventName === 'RailCreated') {
        railsPayers.set(log.args.railId, {
          token: log.args.token,
          owner: log.args.payer,
        });
      }
    });

    const accounts = uniqBy(
      logs.flatMap((log) => {
        switch (log.eventName) {
          case 'AccountLockupSettled':
            return [
              {
                token: log.args.token,
                owner: log.args.owner,
                blockNumber: log.blockNumber,
              },
            ];
          case 'DepositRecorded':
            return [
              {
                token: log.args.token,
                owner: log.args.to,
                blockNumber: log.blockNumber,
              },
            ];
          case 'WithdrawRecorded':
            return [
              {
                token: log.args.token,
                owner: log.args.from,
                blockNumber: log.blockNumber,
              },
            ];
          case 'RailCreated':
            return [];
          default: {
            const railPayer = railsPayers.get(log.args.railId);

            return railPayer
              ? [{ ...railPayer, blockNumber: log.blockNumber }]
              : [];
          }
        }
      }),
      (account) => `${account.token}-${account.owner}-${account.blockNumber}`,
    );

    const clients = await this.prismaService.po_rep_deal.findMany({
      select: {
        client: true,
      },
      where: {
        client: {
          in: uniq(accounts.map((account) => account.owner)),
        },
      },
      distinct: ['client'],
    });
    const clientsAddresses = new Set(clients.map(({ client }) => client));
    const clientsAccounts = accounts.filter((account) =>
      clientsAddresses.has(account.owner),
    );

    if (clientsAccounts.length === 0) {
      return [];
    }

    const accountsStates = await Promise.all(
      clientsAccounts.map<Promise<AccountStateCreationInput>>(
        async ({ token, owner, blockNumber }) => {
          const [funds, lockupCurrent, lockupRate, lockupLastSettledAt] =
            await this.archiveNodeClient.readContract({
              address: this.configService.get('FILECOIN_PAY_CONTRACT_ADDRESS'),
              abi: FilecoinPayV1ABI,
              functionName: 'accounts',
              args: [getAddress(token), getAddress(owner)],
              blockNumber: blockNumber,
            });

          return {
            token: token,
            owner: owner,
            funds: funds.toString(),
            lockupCurrent: lockupCurrent.toString(),
            lockupRate: lockupRate.toString(),
            lockupLastSettledAt: lockupLastSettledAt,
            createdAtBlock: blockNumber,
          };
        },
      ),
    );

    return [
      this.prismaService.filecoin_pay_account_state.createMany({
        data: accountsStates,
      }),
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
      case 'RailOneTimePaymentProcessed':
        return {
          ...previousUpdateInput,
          lockupFixed: {
            decrement: (
              log.args.netPayeeAmount +
              log.args.networkFee +
              log.args.operatorCommission
            ).toString(),
          },
        };
      default:
        return previousUpdateInput;
    }
  }
}
