import { type InsertObject, type Updateable, type UpdateResult } from 'kysely';
import { chunk, groupBy, last, uniqBy } from 'lodash';
import { type DB, type TransactionContext } from 'src/db';
import { PoRepDealState, PoRepDealType } from 'src/db/auto-generated/enums';
import {
  type AbiEvent,
  type Address,
  getAbiItem,
  type GetLogsReturnType,
  isAddressEqual,
  type ReadContractReturnType,
  zeroAddress,
} from 'viem';
import PoRepMarketABI from '../abis/po-rep-market.abi';
import SPRegistryABI from '../abis/sp-registry.abi';
import { PO_REP_ORIGIN_BLOCK } from '../po-rep-indexer.constants';
import { UnknownDealTypeError } from '../po-rep-indexer.errors';
import {
  DealManifestResult,
  DealManifestSuccessResult,
} from '../po-rep-indexer.types';
import { AbstractPoRepIndexerRunner } from './abstract-po-rep-indexer.runner';

const EPOCHS_IN_DAY = 2880n;

const dealStateByContractValue: Record<number, PoRepDealState> = {
  10: PoRepDealState.PROPOSED,
  20: PoRepDealState.ACCEPTED,
  30: PoRepDealState.ACTIVE,
  40: PoRepDealState.FINALIZED,
  50: PoRepDealState.REJECTED,
  60: PoRepDealState.EXPIRED,
  70: PoRepDealState.EARLY_TERMINATED,
};

const dealTypeByContractValue: Record<number, PoRepDealType> = {
  0: PoRepDealType.NONE,
  10: PoRepDealType.PUBLIC,
  20: PoRepDealType.PRIVATE,
};

type EventType = (typeof events)[number];
type TerminatedDealsStates = Map<string, PoRepDealState>;
type ProviderInput = InsertObject<DB, 'po_rep_storage_provider'>;
type OfferInput = InsertObject<DB, 'po_rep_offer'>;
type OfferPaymentInput = InsertObject<DB, 'po_rep_offer_payment'>;
type DealInput = InsertObject<DB, 'po_rep_deal'>;
type DealRequirementsInput = InsertObject<DB, 'po_rep_deal_requirements'>;
type DealTermsInput = InsertObject<DB, 'po_rep_deal_terms'>;
type DealUpdate = Updateable<DB['po_rep_deal']>;
type DealStateChangeInput = InsertObject<DB, 'po_rep_deal_state_change'>;
type DealPieceInput = InsertObject<DB, 'po_rep_deal_pieces'>;

type OfferView = ReadContractReturnType<
  typeof SPRegistryABI,
  'getOfferView',
  [bigint]
>;
type Deal = ReadContractReturnType<typeof PoRepMarketABI, 'getDeal', [bigint]>;
type DealTerms = ReadContractReturnType<
  typeof PoRepMarketABI,
  'getDealTerms',
  [bigint]
>;
type DealPayment = ReadContractReturnType<
  typeof PoRepMarketABI,
  'getDealPayment',
  [bigint]
>;

type SPRegistryLog = GetLogsReturnType<
  undefined,
  typeof spRegistryEvents,
  undefined,
  bigint,
  bigint
>[number];
type PoRepMarketLog = GetLogsReturnType<
  undefined,
  typeof poRepMarketEvents,
  undefined,
  bigint,
  bigint
>[number];
type Log = SPRegistryLog | PoRepMarketLog;
type Logs = Log[];

type ProviderScopedLog = Extract<
  SPRegistryLog,
  { eventName: (typeof providerScopedEventNames)[number] }
>;

type OfferCreatedLog = Extract<SPRegistryLog, { eventName: 'OfferCreated' }>;
type DealCreatedLog = Extract<PoRepMarketLog, { eventName: 'DealCreated' }>;

interface CreatedOffer {
  log: OfferCreatedLog;
  offerView: OfferView;
}

interface CreatedDeal {
  log: DealCreatedLog;
  deal: Deal;
  terms: DealTerms;
  payment: DealPayment;
}

interface ProviderUpdate {
  values: Updateable<DB['po_rep_storage_provider']>;
  committedBytesChange: bigint;
  pendingBytesChange: bigint;
}

interface Changes {
  logs: Logs;
  createdOffers: CreatedOffer[];
  createdDeals: CreatedDeal[];
  terminatedDealsStates: TerminatedDealsStates;
  manifestResults: DealManifestSuccessResult[];
}

const spRegistryEvents = [
  getAbiItem({ abi: SPRegistryABI, name: 'ProviderRegistered' }),
  getAbiItem({ abi: SPRegistryABI, name: 'AvailableSpaceUpdated' }),
  getAbiItem({ abi: SPRegistryABI, name: 'CapacityCommitted' }),
  getAbiItem({ abi: SPRegistryABI, name: 'CapacityReleased' }),
  getAbiItem({ abi: SPRegistryABI, name: 'PendingCapacityReserved' }),
  getAbiItem({ abi: SPRegistryABI, name: 'PendingCapacityReleased' }),
  getAbiItem({ abi: SPRegistryABI, name: 'ProviderBlocked' }),
  getAbiItem({ abi: SPRegistryABI, name: 'ProviderUnblocked' }),
  getAbiItem({ abi: SPRegistryABI, name: 'ProviderPaused' }),
  getAbiItem({ abi: SPRegistryABI, name: 'ProviderUnpaused' }),
  getAbiItem({ abi: SPRegistryABI, name: 'PayeeUpdated' }),
  getAbiItem({ abi: SPRegistryABI, name: 'OfferCreated' }),
  getAbiItem({ abi: SPRegistryABI, name: 'OfferActiveUpdated' }),
  getAbiItem({ abi: SPRegistryABI, name: 'OfferPaymentUpdated' }),
] as const satisfies AbiEvent[];

const poRepMarketEvents = [
  getAbiItem({ abi: PoRepMarketABI, name: 'DealCreated' }),
  getAbiItem({ abi: PoRepMarketABI, name: 'DealAccepted' }),
  getAbiItem({ abi: PoRepMarketABI, name: 'RailIdUpdated' }),
  getAbiItem({ abi: PoRepMarketABI, name: 'PaymentActivated' }),
  getAbiItem({ abi: PoRepMarketABI, name: 'DealFinalized' }),
  getAbiItem({ abi: PoRepMarketABI, name: 'DealTerminated' }),
  getAbiItem({ abi: PoRepMarketABI, name: 'DealRejected' }),
  getAbiItem({ abi: PoRepMarketABI, name: 'ManifestUpdated' }),
] as const satisfies AbiEvent[];

const events = [
  ...spRegistryEvents,
  ...poRepMarketEvents,
] as const satisfies AbiEvent[];

const providerScopedEventNames = [
  'AvailableSpaceUpdated',
  'CapacityCommitted',
  'CapacityReleased',
  'PendingCapacityReserved',
  'PendingCapacityReleased',
  'ProviderBlocked',
  'ProviderUnblocked',
  'ProviderPaused',
  'ProviderUnpaused',
  'PayeeUpdated',
] as const satisfies SPRegistryLog['eventName'][];

function assertRowUpdated(result: UpdateResult, message: string) {
  if (result.numUpdatedRows === 0n) {
    throw new Error(message);
  }
}

export class PoRepProvidersAndDealsIndexerRunner extends AbstractPoRepIndexerRunner<
  EventType,
  Changes
> {
  public getName(): string {
    return PoRepProvidersAndDealsIndexerRunner.name;
  }

  protected getOriginBlock(): bigint {
    return PO_REP_ORIGIN_BLOCK;
  }

  protected getVersion(): number {
    return 3;
  }

  protected getBatchBlockSize(): bigint {
    return 2n * 60n * 24n; // 1 day worth of logs
  }

  protected getEventTypes() {
    return events;
  }

  protected getOriginAddresses(): Address | Address[] | undefined {
    return [
      this.configService.get('SP_REGISTRY_CONTRACT_ADDRESS'),
      this.configService.get('PO_REP_MARKET_CONTRACT_ADDRESS'),
    ] satisfies Address[];
  }

  protected async cleanup(tx: TransactionContext): Promise<void> {
    await tx.deleteFrom('po_rep_deal_requirements').execute();
    await tx.deleteFrom('po_rep_deal_terms').execute();
    await tx.deleteFrom('po_rep_deal_state_change').execute();
    await tx.deleteFrom('po_rep_deal_pieces').execute();
    await tx.deleteFrom('po_rep_deal').execute();
    await tx.deleteFrom('po_rep_offer_payment').execute();
    await tx.deleteFrom('po_rep_offer').execute();
    await tx.deleteFrom('po_rep_storage_provider').execute();
  }

  protected async getChanges(logs: Logs): Promise<Changes> {
    const [
      createdDeals,
      createdOffers,
      terminatedDealsStates,
      manifestResults,
    ] = await Promise.all([
      this.resolveCreatedDeals(logs),
      this.resolveCreatedOffers(logs),
      this.resolveTerminatedDealsStates(logs),
      this.resolveDealsManifests(logs),
    ]);

    return {
      logs: logs,
      createdOffers: createdOffers,
      createdDeals: createdDeals,
      terminatedDealsStates: terminatedDealsStates,
      manifestResults: manifestResults,
    };
  }

  protected async updateDb(
    tx: TransactionContext,
    {
      logs,
      createdOffers,
      createdDeals,
      terminatedDealsStates,
      manifestResults,
    }: Changes,
  ): Promise<void> {
    await this.createDealManifestsCache(tx, manifestResults);
    await this.createProviders(tx, logs);
    await this.updateProviders(tx, logs);
    await this.createOffers(tx, createdOffers);
    await this.updateOffers(tx, logs);
    await this.createDeals(tx, createdDeals);
    await this.createDealsPieces(tx, manifestResults);
    await this.updateDeals(tx, logs, terminatedDealsStates);
    await this.createDealsStateChanges(tx, logs, terminatedDealsStates);
  }

  private async resolveDealsManifests(
    logs: Logs,
  ): Promise<DealManifestSuccessResult[]> {
    const manifestRequests = logs
      .filter((log) => {
        return isAddressEqual(
          log.address,
          this.configService.get('PO_REP_MARKET_CONTRACT_ADDRESS'),
        );
      })
      .filter((log) => {
        return log.eventName === 'DealCreated';
      })
      .map((log) => {
        return this.dealManifestService.readDealManifest(
          log.args.dealId,
          log.args.manifestLocation,
        );
      });

    const manifestResponses = await Promise.all(manifestRequests);

    manifestResponses.forEach((response) => {
      if (!response.success) {
        this.logger.warn(
          `Could not read manifest for deal ${response.dealId} at "${response.manifestLocation}" - skipping: ${String(response.error)}`,
        );
      }
    });

    return manifestResponses.filter(
      (response): response is DealManifestSuccessResult => response.success,
    );
  }

  private async createDealManifestsCache(
    tx: TransactionContext,
    results: DealManifestSuccessResult[],
  ): Promise<void> {
    const uncachedResults = results.filter((result) => !result.data.cached);

    for (const part of chunk(uncachedResults, 1000)) {
      await tx
        .insertInto('po_rep_deal_manifest_cache')
        .values(
          part.map((result) => ({
            deal_id: result.dealId.toString(),
            manifest_location: result.manifestLocation,
            manifest_content: JSON.stringify(result.data.manifestContent),
          })),
        )
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }

  private async createDealsPieces(
    tx: TransactionContext,
    results: DealManifestResult[],
  ): Promise<void> {
    const dealsPieces = results.flatMap<DealPieceInput>((result) => {
      const pieces = this.dealManifestService.extractDealManifestPieces(
        result.data.manifestContent,
      );

      return pieces.map((piece) => {
        return {
          deal_id: result.dealId.toString(),
          piece_cid: piece.pieceCid,
        };
      });
    });

    for (const part of chunk(dealsPieces, 1000)) {
      await tx
        .insertInto('po_rep_deal_pieces')
        .values(part)
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }

  private async createProviders(
    tx: TransactionContext,
    logs: Logs,
  ): Promise<void> {
    const providers = logs
      .filter((log) => {
        return isAddressEqual(
          log.address,
          this.configService.get('SP_REGISTRY_CONTRACT_ADDRESS'),
        );
      })
      .filter((log) => {
        return log.eventName === 'ProviderRegistered';
      })
      .map<ProviderInput>((log) => {
        return {
          providerId: log.args.provider.toString(),
          organization: log.args.organization,
          payee: zeroAddress,
          paused: false,
          blocked: false,
          availableBytes: '0',
          committedBytes: '0',
          pendingBytes: '0',
          pricePerSectorPerMonth: '0',
          minDealDurationDays: 0,
          maxDealDurationDays: 0,
          registeredAtBlock: log.blockNumber.toString(),
        };
      });

    for (const part of chunk(providers, 1000)) {
      await tx.insertInto('po_rep_storage_provider').values(part).execute();
    }
  }

  private async updateProviders(
    tx: TransactionContext,
    logs: Logs,
  ): Promise<void> {
    const registryLogs = logs.filter((log): log is ProviderScopedLog => {
      return (
        isAddressEqual(
          log.address,
          this.configService.get('SP_REGISTRY_CONTRACT_ADDRESS'),
        ) &&
        (providerScopedEventNames as readonly string[]).includes(log.eventName)
      );
    });

    const logsGroupedByProvider = groupBy(registryLogs, (log) => {
      return log.args.provider.toString();
    });

    for (const [providerId, logsForProvider] of Object.entries(
      logsGroupedByProvider,
    )) {
      const { values, committedBytesChange, pendingBytesChange } =
        logsForProvider.reduce<ProviderUpdate>(this.logToProviderUpdate, {
          values: {},
          committedBytesChange: 0n,
          pendingBytesChange: 0n,
        });

      const result = await tx
        .updateTable('po_rep_storage_provider')
        .set((eb) => ({
          ...values,
          committedBytes: eb(
            'committedBytes',
            '+',
            committedBytesChange.toString(),
          ),
          pendingBytes: eb('pendingBytes', '+', pendingBytesChange.toString()),
        }))
        .where('providerId', '=', providerId)
        .executeTakeFirst();

      assertRowUpdated(result, `Provider "${providerId}" not found`);
    }
  }

  private async resolveCreatedOffers(logs: Logs): Promise<CreatedOffer[]> {
    const offerCreatedLogs = logs
      .filter((log) => {
        return isAddressEqual(
          log.address,
          this.configService.get('SP_REGISTRY_CONTRACT_ADDRESS'),
        );
      })
      .filter((log) => {
        return log.eventName === 'OfferCreated';
      });

    return Promise.all(
      offerCreatedLogs.map(async (log) => {
        const offerView = await this.recentNodeClient.readContract({
          address: this.configService.get('SP_REGISTRY_CONTRACT_ADDRESS'),
          abi: SPRegistryABI,
          functionName: 'getOfferView',
          args: [log.args.offerId],
        });

        return { log: log, offerView: offerView };
      }),
    );
  }

  private async createOffers(
    tx: TransactionContext,
    createdOffers: CreatedOffer[],
  ): Promise<void> {
    const offers = createdOffers.map<OfferInput>(({ log, offerView }) => {
      return {
        offerId: log.args.offerId.toString(),
        providerId: log.args.provider.toString(),
        active: offerView.active,
        minSizeBytes: offerView.terms.minSizeBytes.toString(),
        maxSizeBytes: offerView.terms.maxSizeBytes.toString(),
        minDurationEpochs: offerView.terms.minDurationEpochs.toString(),
        maxDurationEpochs: offerView.terms.maxDurationEpochs.toString(),
        retrievabilityBps: offerView.slis.retrievabilityBps,
        bandwidthBytesPerSecond:
          offerView.slis.bandwidthBytesPerSecond.toString(),
        latencyMs: offerView.slis.latencyMs,
        indexingPct: offerView.slis.indexingPct,
        createdAtBlock: log.blockNumber.toString(),
      };
    });

    for (const part of chunk(offers, 1000)) {
      await tx.insertInto('po_rep_offer').values(part).execute();
    }

    const offersPayments = createdOffers.flatMap<OfferPaymentInput>(
      ({ offerView }) => {
        return offerView.payments.map((payment) => {
          return {
            offerId: offerView.offerId.toString(),
            token: payment.token,
            active: payment.active,
            pricePer32GiBPerMonth: payment.pricePer32GiBPerMonth.toString(),
          };
        });
      },
    );

    for (const part of chunk(offersPayments, 1000)) {
      await tx.insertInto('po_rep_offer_payment').values(part).execute();
    }
  }

  private async updateOffers(
    tx: TransactionContext,
    logs: Logs,
  ): Promise<void> {
    const offerActiveLogs = logs
      .filter((log) => {
        return isAddressEqual(
          log.address,
          this.configService.get('SP_REGISTRY_CONTRACT_ADDRESS'),
        );
      })
      .filter((log) => {
        return log.eventName === 'OfferActiveUpdated';
      });

    const logsGroupedByOffer = groupBy(offerActiveLogs, (log) => {
      return log.args.offerId.toString();
    });

    for (const [offerId, logsForOffer] of Object.entries(logsGroupedByOffer)) {
      const result = await tx
        .updateTable('po_rep_offer')
        .set({ active: last(logsForOffer).args.active })
        .where('offerId', '=', offerId)
        .executeTakeFirst();

      assertRowUpdated(result, `Offer "${offerId}" not found`);
    }

    const offerPaymentLogs = logs
      .filter((log) => {
        return isAddressEqual(
          log.address,
          this.configService.get('SP_REGISTRY_CONTRACT_ADDRESS'),
        );
      })
      .filter((log) => {
        return log.eventName === 'OfferPaymentUpdated';
      });

    for (const log of offerPaymentLogs) {
      await tx
        .insertInto('po_rep_offer_payment')
        .values({
          offerId: log.args.offerId.toString(),
          token: log.args.token,
          active: log.args.active,
          pricePer32GiBPerMonth: log.args.pricePer32GiBPerMonth.toString(),
        })
        .onConflict((oc) =>
          oc.columns(['offerId', 'token']).doUpdateSet((eb) => ({
            active: eb.ref('excluded.active'),
            pricePer32GiBPerMonth: eb.ref('excluded.pricePer32GiBPerMonth'),
          })),
        )
        .execute();
    }
  }

  private async resolveCreatedDeals(logs: Logs): Promise<CreatedDeal[]> {
    const dealCreatedLogs = logs
      .filter((log) => {
        return isAddressEqual(
          log.address,
          this.configService.get('PO_REP_MARKET_CONTRACT_ADDRESS'),
        );
      })
      .filter((log) => {
        return log.eventName === 'DealCreated';
      });

    return Promise.all(
      dealCreatedLogs.map(async (log) => {
        const [deal, terms, payment] = await Promise.all([
          this.recentNodeClient.readContract({
            address: this.configService.get('PO_REP_MARKET_CONTRACT_ADDRESS'),
            abi: PoRepMarketABI,
            functionName: 'getDeal',
            args: [log.args.dealId],
          }),
          this.recentNodeClient.readContract({
            address: this.configService.get('PO_REP_MARKET_CONTRACT_ADDRESS'),
            abi: PoRepMarketABI,
            functionName: 'getDealTerms',
            args: [log.args.dealId],
          }),
          this.recentNodeClient.readContract({
            address: this.configService.get('PO_REP_MARKET_CONTRACT_ADDRESS'),
            abi: PoRepMarketABI,
            functionName: 'getDealPayment',
            args: [log.args.dealId],
          }),
        ]);

        return { log: log, deal: deal, terms: terms, payment: payment };
      }),
    );
  }

  private async createDeals(
    tx: TransactionContext,
    createdDeals: CreatedDeal[],
  ): Promise<void> {
    const deals = createdDeals.map<DealInput>(({ log, deal }) => {
      return {
        dealId: log.args.dealId.toString(),
        providerId: log.args.provider.toString(),
        offerId: deal.offerId.toString(),
        client: log.args.client,
        state: PoRepDealState.ACCEPTED,
        dealType: this.resolveDealType(deal.dealType),
        manifestHash: log.args.manifestHash,
        manifestLocation: log.args.manifestLocation,
        totalDealSize: log.args.totalDealSize.toString(),
        proposedAtBlock: log.args.proposedAtBlock.toString(),
        railId: null,
      };
    });

    for (const part of chunk(deals, 1000)) {
      await tx.insertInto('po_rep_deal').values(part).execute();
    }

    const dealsRequirements = createdDeals.map<DealRequirementsInput>(
      ({ log }) => {
        return {
          dealId: log.args.dealId.toString(),
          retrievabilityBps: log.args.requirements.retrievabilityBps,
          bandwidthBytesPerSecond:
            log.args.requirements.bandwidthBytesPerSecond.toString(),
          latencyMs: log.args.requirements.latencyMs,
          indexingPct: log.args.requirements.indexingPct,
        };
      },
    );

    for (const part of chunk(dealsRequirements, 1000)) {
      await tx.insertInto('po_rep_deal_requirements').values(part).execute();
    }

    const dealsTerms = createdDeals.map<DealTermsInput>(
      ({ log, terms, payment }) => {
        return {
          deal_id: log.args.dealId.toString(),
          deal_size_bytes: terms.requestedSizeBytes.toString(),
          price_per_sector_per_month: payment.pricePer32GiBPerMonth.toString(),
          duration_days: (terms.durationEpochs / EPOCHS_IN_DAY).toString(),
        };
      },
    );

    for (const part of chunk(dealsTerms, 1000)) {
      await tx.insertInto('po_rep_deal_terms').values(part).execute();
    }
  }

  private resolveDealType(contractValue: number): PoRepDealType {
    const dealType = dealTypeByContractValue[contractValue];

    if (!dealType) {
      throw new UnknownDealTypeError(contractValue);
    }

    return dealType;
  }

  private async resolveTerminatedDealsStates(
    logs: Logs,
  ): Promise<TerminatedDealsStates> {
    const terminatedLogs = logs
      .filter((log) => {
        return isAddressEqual(
          log.address,
          this.configService.get('PO_REP_MARKET_CONTRACT_ADDRESS'),
        );
      })
      .filter((log) => {
        return log.eventName === 'DealTerminated';
      });

    if (terminatedLogs.length === 0) {
      return new Map();
    }

    const deals = await Promise.all(
      uniqBy(terminatedLogs, (log) => log.args.dealId.toString()).map((log) => {
        return this.recentNodeClient.readContract({
          address: this.configService.get('PO_REP_MARKET_CONTRACT_ADDRESS'),
          abi: PoRepMarketABI,
          functionName: 'getDeal',
          args: [log.args.dealId],
        });
      }),
    );

    return new Map(
      deals.map((deal) => {
        const state = dealStateByContractValue[deal.state];

        if (!state) {
          this.logger.warn(
            `Unknown state "${deal.state}" of terminated deal ${deal.dealId.toString()}, assuming ${PoRepDealState.EARLY_TERMINATED}`,
          );
        }

        return [
          deal.dealId.toString(),
          state ?? PoRepDealState.EARLY_TERMINATED,
        ];
      }),
    );
  }

  private async updateDeals(
    tx: TransactionContext,
    logs: Logs,
    terminatedDealsStates: TerminatedDealsStates,
  ): Promise<void> {
    const poRepMarketLogs = logs.filter((log): log is PoRepMarketLog => {
      return (
        isAddressEqual(
          log.address,
          this.configService.get('PO_REP_MARKET_CONTRACT_ADDRESS'),
        ) &&
        poRepMarketEvents
          .map<string>((item) => item.name)
          .includes(log.eventName)
      );
    });

    const logsGroupedByDeal = groupBy(poRepMarketLogs, (log) => {
      return log.args.dealId.toString();
    });

    for (const [dealId, logsForDeal] of Object.entries(logsGroupedByDeal)) {
      const values = logsForDeal.reduce<DealUpdate>((update, log) => {
        return this.logToDealUpdate(update, log, terminatedDealsStates);
      }, {});

      if (Object.keys(values).length === 0) {
        continue;
      }

      const result = await tx
        .updateTable('po_rep_deal')
        .set(values)
        .where('dealId', '=', dealId)
        .executeTakeFirst();

      assertRowUpdated(result, `Deal "${dealId}" not found`);

      if (values.totalDealSize) {
        const termsResult = await tx
          .updateTable('po_rep_deal_terms')
          .set({ deal_size_bytes: values.totalDealSize })
          .where('deal_id', '=', dealId)
          .executeTakeFirst();

        assertRowUpdated(termsResult, `Terms of deal "${dealId}" not found`);
      }
    }
  }

  private async createDealsStateChanges(
    tx: TransactionContext,
    logs: Logs,
    terminatedDealsStates: TerminatedDealsStates,
  ): Promise<void> {
    const stateChangeLogs = logs
      .filter((log) => {
        return isAddressEqual(
          log.address,
          this.configService.get('PO_REP_MARKET_CONTRACT_ADDRESS'),
        );
      })
      .filter((log) => {
        return (
          log.eventName === 'DealRejected' ||
          log.eventName === 'DealAccepted' ||
          log.eventName === 'PaymentActivated' ||
          log.eventName === 'DealFinalized' ||
          log.eventName === 'DealTerminated'
        );
      });

    const stateChanges = stateChangeLogs.reduce<DealStateChangeInput[]>(
      (result, log) => {
        const state = this.logToDealState(log, terminatedDealsStates);

        if (state === null) {
          return result;
        }

        return [
          ...result,
          {
            deal_id: log.args.dealId.toString(),
            state: state,
            changed_at_block: log.blockNumber.toString(),
          },
        ];
      },
      [],
    );

    for (const part of chunk(stateChanges, 1000)) {
      await tx.insertInto('po_rep_deal_state_change').values(part).execute();
    }
  }

  private logToProviderUpdate(
    previousUpdate: ProviderUpdate,
    log: Log,
  ): ProviderUpdate {
    switch (log.eventName) {
      case 'AvailableSpaceUpdated':
        return {
          ...previousUpdate,
          values: {
            ...previousUpdate.values,
            availableBytes: log.args.availableBytes.toString(),
          },
        };
      case 'CapacityCommitted':
        return {
          ...previousUpdate,
          committedBytesChange:
            previousUpdate.committedBytesChange + log.args.committedBytes,
        };
      case 'CapacityReleased':
        return {
          ...previousUpdate,
          committedBytesChange:
            previousUpdate.committedBytesChange - log.args.releasedBytes,
        };
      case 'PendingCapacityReserved':
        return {
          ...previousUpdate,
          pendingBytesChange:
            previousUpdate.pendingBytesChange + log.args.sizeBytes,
        };
      case 'PendingCapacityReleased':
        return {
          ...previousUpdate,
          pendingBytesChange:
            previousUpdate.pendingBytesChange - log.args.sizeBytes,
        };
      case 'ProviderBlocked':
        return {
          ...previousUpdate,
          values: {
            ...previousUpdate.values,
            blocked: true,
          },
        };
      case 'ProviderUnblocked':
        return {
          ...previousUpdate,
          values: {
            ...previousUpdate.values,
            blocked: false,
          },
        };
      case 'ProviderPaused':
        return {
          ...previousUpdate,
          values: {
            ...previousUpdate.values,
            paused: true,
          },
        };
      case 'ProviderUnpaused':
        return {
          ...previousUpdate,
          values: {
            ...previousUpdate.values,
            paused: false,
          },
        };
      case 'PayeeUpdated':
        return {
          ...previousUpdate,
          values: {
            ...previousUpdate.values,
            payee: log.args.newPayee,
          },
        };
      default:
        return previousUpdate;
    }
  }

  private logToDealUpdate(
    previousUpdate: DealUpdate,
    log: Log,
    terminatedDealsStates: TerminatedDealsStates,
  ): DealUpdate {
    switch (log.eventName) {
      case 'DealAccepted':
        return {
          ...previousUpdate,
          state: PoRepDealState.ACCEPTED,
        };
      case 'RailIdUpdated':
        return {
          ...previousUpdate,
          railId: log.args.railId.toString(),
        };
      case 'PaymentActivated':
        return {
          ...previousUpdate,
          state: PoRepDealState.ACTIVE,
        };
      case 'DealFinalized':
        return {
          ...previousUpdate,
          state: PoRepDealState.FINALIZED,
        };
      case 'DealRejected':
        return {
          ...previousUpdate,
          state: PoRepDealState.REJECTED,
        };
      case 'DealTerminated':
        return {
          ...previousUpdate,
          state:
            terminatedDealsStates.get(log.args.dealId.toString()) ??
            PoRepDealState.EARLY_TERMINATED,
        };
      case 'ManifestUpdated':
        return {
          ...previousUpdate,
          manifestHash: log.args.newManifestHash,
          manifestLocation: log.args.newManifestLocation,
          totalDealSize: log.args.newRequestedSizeBytes.toString(),
        };
      default:
        return previousUpdate;
    }
  }

  private logToDealState(
    log: Log,
    terminatedDealsStates: TerminatedDealsStates,
  ): PoRepDealState | null {
    switch (log.eventName) {
      case 'DealRejected':
        return PoRepDealState.REJECTED;
      case 'DealAccepted':
        return PoRepDealState.ACCEPTED;
      case 'PaymentActivated':
        return PoRepDealState.ACTIVE;
      case 'DealFinalized':
        return PoRepDealState.FINALIZED;
      case 'DealTerminated':
        return (
          terminatedDealsStates.get(log.args.dealId.toString()) ??
          PoRepDealState.EARLY_TERMINATED
        );
      default:
        return null;
    }
  }
}
