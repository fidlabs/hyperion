import { Inject, Injectable } from '@nestjs/common';
import { groupBy, uniq } from 'lodash';
import { DateTime } from 'luxon';
import { Prisma as PrismaRuntime } from '../../generated/prisma/client';
import { InjectQueryBuilder, QueryBuilder } from 'src/db';
import { PrismaService } from 'src/db/prisma.service';
import { createPoRepDealsPaymentsHistoryQuery } from 'src/db/queries/po-rep-deals-payments-history.query';
import { createPoRepDealsValueHistoryQuery } from 'src/db/queries/po-rep-deals-value-history.query';
import { createPoRepDealsQuery } from 'src/db/queries/po-rep-deals.query';
import { createPoRepOnboardedDataHistoryQuery } from 'src/db/queries/po-rep-onboarded-data-history.query';
import { createPoRepProviderEconomicsStatisticsQuery } from 'src/db/queries/po-rep-provider-economics-statistics.query';
import { createPoRepProviderStorageStatisticsQuery } from 'src/db/queries/po-rep-provider-storage-statistics.query';
import { PoRepPublicClient, RECENT_NODE_CLIENT } from 'src/po-rep-indexer';
import {
  dateToFilecoinBlockHeight,
  F0Id,
  filecoinBlockHeightToDate,
  getFilecoinGenesisTimestamp,
  stringToBool,
  stringToNumber,
} from 'src/utils/utils';
import { F0IdInput } from 'src/utils/validators';
import { filecoinCalibration } from 'viem/chains';
import { PoRepPriceOracleService } from '../po-rep-price-oracle/po-rep-price-oracle.service';
import {
  DealRailState,
  PoRepDeal,
  PoRepDealsList,
  PoRepDealsListParameters,
  PoRepDealsPaymentsHistoryEntry,
  PoRepDealsPaymentsHistoryParameters,
  PoRepDealsValueHistoryEntry,
  PoRepDealsValueHistoryParameters,
  PoRepOnboardedDataHistoryEntry,
  PoRepOnboardedDataHistoryParameters,
  PoRepProviderEconomicsStatistics,
  PoRepProviderStorageStatistics,
} from './types.po-rep';
import { ERC20TokenInfoService } from '../erc20-token-info/erc20-token-info.service';

interface TokenDetails {
  tokenAddress: string;
  tokenDecimals: number;
  tokenSymbol: string;
}

const Decimal = PrismaRuntime.Decimal;

@Injectable()
export class PoRepService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tokenInfoService: ERC20TokenInfoService,
    private readonly priceOracle: PoRepPriceOracleService,
    @Inject(RECENT_NODE_CLIENT)
    private readonly recentNodeClient: PoRepPublicClient,
    @InjectQueryBuilder() private readonly queryBuilder: QueryBuilder,
  ) {}

  public async getDeals({
    providerId = null,
    railState = null,
    pieceCid = null,
    activeOnly,
    sort = 'deal_id',
    order = 'asc',
    limit = 0,
    page = 1,
  }: PoRepDealsListParameters): Promise<PoRepDealsList> {
    let baseQuery = createPoRepDealsQuery(this.queryBuilder, {
      providersIds: providerId,
      railStates: railState,
      activeOnly: Boolean(stringToBool(activeOnly)),
    });

    if (pieceCid !== null) {
      const matchedDeals = await this.prismaService.po_rep_deal_pieces.findMany(
        {
          select: {
            deal_id: true,
          },
          where: {
            piece_cid: pieceCid,
          },
        },
      );

      if (matchedDeals.length === 0) {
        return {
          data: [],
          pagination: {
            page: 1,
            pagesCount: 1,
            totalCount: 0,
          },
        };
      }

      const dealsIds = matchedDeals.map((i) => i.deal_id.toString());
      baseQuery = baseQuery.where('deal_id', 'in', dealsIds);
    }

    let resultsQuery = baseQuery.selectAll();

    if (sort !== null) {
      resultsQuery = resultsQuery.orderBy(sort, (ob) =>
        order === 'asc' ? ob.asc().nullsLast() : ob.desc().nullsLast(),
      );
    }

    if (limit) {
      resultsQuery = resultsQuery.limit(limit).offset((page - 1) * limit);
    }

    const countQuery = baseQuery.select((eb) => [
      eb.fn.count('deal_data.deal_id').as('count'),
    ]);

    const [results, countResult] = await Promise.all([
      resultsQuery.execute(),
      countQuery.executeTakeFirstOrThrow(),
    ]);

    const totalCount = stringToNumber(countResult.count.toString()) ?? 0;
    const pagesCount = limit ? Math.ceil(totalCount / limit) : 1;

    const uniqueTokens = uniq(
      results.map((result) => result.token_address),
    ).filter((tokenAddress) => tokenAddress !== null);
    const tokenDetailsMap = await this.getTokensDetails(uniqueTokens);

    const deals = results.map((result) => {
      const tokenDetails = result.token_address
        ? tokenDetailsMap.get(result.token_address)
        : null;

      return new PoRepDeal({
        dealId: BigInt(result.deal_id),
        providerId: F0Id.from(result.provider_id),
        clientAddress: result.client_address,
        dealState: result.deal_state,
        dealType: result.deal_type,
        railId: result.rail_id ? BigInt(result.rail_id) : null,
        railState: result.rail_state as DealRailState | null,
        active: Boolean(result.active),
        tokenAddress: result.token_address,
        tokenSymbol: tokenDetails?.tokenSymbol ?? null,
        tokenDecimals: tokenDetails?.tokenDecimals ?? null,
        minRequiredRetrievability: this.safeNumericToNumber(
          result.min_required_retrievability,
        ),
        minRequiredBandwidthMbps: this.safeNumericToNumber(
          result.min_required_bandwidth_mbps,
        ),
        maxRequiredLatencyMs: this.safeNumericToNumber(
          result.max_required_latency_ms,
        ),
        minRequiredIndexing: this.safeNumericToNumber(
          result.min_required_indexing,
        ),
        dealSizeBytes: BigInt(result.deal_size_bytes),
        isDataOnboarded: result.rail_activated_at_epoch !== null,
        pricePerSectorPerMonthWei: BigInt(result.price_per_sector_per_month),
        predictedDealRevenueWei: BigInt(result.predicted_deal_revenue),
        totalSettledValueWei: result.total_amount_settled
          ? BigInt(result.total_amount_settled)
          : null,
        settlementsCount: result.total_settlements_count
          ? stringToNumber(result.total_settlements_count.toString())
          : null,
        lastSettlementAt:
          result.last_settlement_epoch !== null
            ? this.epochToDate(BigInt(result.last_settlement_epoch))
            : null,
        dealCreatedAtEpoch: BigInt(result.deal_created_at_epoch),
        dealCreatedAt: this.epochToDate(BigInt(result.deal_created_at_epoch)),
      });
    });

    return {
      data: deals,
      pagination: {
        page: page ?? 1,
        pagesCount: pagesCount,
        totalCount: totalCount,
      },
    };
  }

  public async getProviderStorageStatistics(
    providerId: F0Id | F0IdInput,
  ): Promise<PoRepProviderStorageStatistics | null> {
    const result = await createPoRepProviderStorageStatisticsQuery(
      this.queryBuilder,
      { providerId: providerId },
    ).executeTakeFirst();

    if (!result) {
      return null;
    }

    return {
      totalDealsCount: stringToNumber(result.totalDealsCount.toString()),
      onboardedDealsCount: stringToNumber(result.onbardedDealsCount.toString()),
      totalAvailableBytes: BigInt(result.availableBytes),
      pendingBytes: BigInt(result.pendingBytes),
      committedBytes: BigInt(result.committedBytes),
      onboardedBytes: BigInt(result.onboardedBytes),
    };
  }

  public async getProviderEconomicsStatistics(
    providerId: F0Id | F0IdInput,
  ): Promise<PoRepProviderEconomicsStatistics> {
    const perTokenResults = await createPoRepProviderEconomicsStatisticsQuery(
      this.queryBuilder,
      { providerId: providerId },
    ).execute();

    const uniqueTokens = uniq(
      perTokenResults.map((i) => i.token_address).filter((i) => i !== null),
    );
    const [tokensDetails, tokensExchangeRatesUSD] = await Promise.all([
      this.getTokensDetails(uniqueTokens),
      this.getTokensExchangeRatesUSD(uniqueTokens),
    ]);

    return perTokenResults.reduce<PoRepProviderEconomicsStatistics>(
      (stats, result) => {
        const resultRailsCount = stringToNumber(
          result.total_rails_count.toString(),
        );

        if (result.token_address === null) {
          return {
            ...stats,
            totalRailsCount: stats.totalRailsCount + resultRailsCount,
          };
        }

        const tokenDetails = tokensDetails.get(result.token_address);
        const exchangeRateUSD = tokensExchangeRatesUSD.get(
          result.token_address,
        );
        const tokenExponent = 10n ** BigInt(tokenDetails.tokenDecimals);

        const lastSettlementAt = (() => {
          const candidateLastSettlement = result.last_settlement_epoch
            ? this.epochToDate(BigInt(result.last_settlement_epoch))
            : null;

          if (candidateLastSettlement === null) {
            return stats.lastSettlementAt;
          }

          if (stats.lastSettlementAt === null) {
            return candidateLastSettlement;
          }

          return candidateLastSettlement.valueOf() >
            stats.lastSettlementAt.valueOf()
            ? candidateLastSettlement
            : stats.lastSettlementAt;
        })();

        return {
          totalRailsCount: stats.totalRailsCount + resultRailsCount,
          activeRailsCount:
            stats.activeRailsCount +
            stringToNumber(result.active_rails_count.toString()),
          totalRevenueUSD:
            stats.totalRevenueUSD +
            Decimal(result.total_revenue.toString())
              .div(tokenExponent.toString())
              .mul(exchangeRateUSD)
              .toDecimalPlaces(2)
              .toNumber(),
          predictedRevenueUSD:
            stats.predictedRevenueUSD +
            Decimal(result.predicted_revenue.toString())
              .div(tokenExponent.toString())
              .mul(exchangeRateUSD)
              .toDecimalPlaces(2)
              .toNumber(),
          totalSettledUSD:
            stats.totalSettledUSD +
            Decimal(result.total_amount_settled.toString())
              .div(tokenExponent.toString())
              .mul(exchangeRateUSD)
              .toDecimalPlaces(2)
              .toNumber(),
          lastSettlementAt: lastSettlementAt,
        };
      },
      {
        totalRailsCount: 0,
        activeRailsCount: 0,
        totalRevenueUSD: 0,
        predictedRevenueUSD: 0,
        totalSettledUSD: 0,
        lastSettlementAt: null,
      },
    );
  }

  public async getDealsPaymentsSummaryHistory({
    netAmounts = 'true',
    providerId = null,
    windowSize = 'day',
  }: PoRepDealsPaymentsHistoryParameters): Promise<
    PoRepDealsPaymentsHistoryEntry[]
  > {
    const earliestDeal = await this.prismaService.po_rep_deal.findFirst({
      orderBy: {
        proposedAtBlock: 'asc',
      },
      where:
        providerId !== null
          ? {
              providerId: F0Id.from(providerId).toBigInt(),
            }
          : undefined,
    });

    if (!earliestDeal) {
      return [];
    }

    const startDate = DateTime.fromJSDate(
      // eslint-disable-next-line no-restricted-syntax
      filecoinBlockHeightToDate(Number(earliestDeal.proposedAtBlock), {
        testnet: this.isTestnet(),
      }),
    )
      .toUTC()
      .startOf(windowSize);
    const endDate = DateTime.utc().startOf(windowSize);
    const entriesCount =
      endDate.diff(startDate, windowSize)[`${windowSize}s`] + 1;
    const data = await createPoRepDealsPaymentsHistoryQuery(this.queryBuilder, {
      genesisTimestamp: getFilecoinGenesisTimestamp({
        testnet: this.isTestnet(),
      }),
      netAmount: stringToBool(netAmounts),
      providersIds: providerId,
      windowSize: windowSize,
    }).execute();

    const uniqueTokens = uniq(data.map((item) => item.token_address));
    const [tokensInfo, tokensUSDExchangeRates] = await Promise.all([
      this.getTokensDetails(uniqueTokens),
      this.getTokensExchangeRatesUSD(uniqueTokens),
    ]);

    const dataByWindow = groupBy(
      data.filter((item) => item.window_start !== null),
      (item) => DateTime.fromJSDate(item.window_start).toISODate(),
    );

    return [...new Array(entriesCount)].reduce<
      PoRepDealsPaymentsHistoryEntry[]
    >((result, _, index) => {
      const entryDate = startDate.plus({ [windowSize]: index });
      const entryISODate = entryDate.toISODate();
      const dataForWindow = dataByWindow[entryISODate] ?? [];

      const windowVolumeUSD = dataForWindow.reduce(
        (currentWindowVolumeUSD, result) => {
          const tokenUSDExchangeRate = tokensUSDExchangeRates.get(
            result.token_address,
          );
          const tokenInfo = tokensInfo.get(result.token_address);

          // Should not happen but type safety
          if (!tokenUSDExchangeRate || !tokenInfo) {
            throw new Error(
              `Exchange rate or info not found for token "${result.token_address}"`,
            );
          }

          const tokenExponent = Math.pow(10, tokenInfo.tokenDecimals);
          const tokenWindowTotalUSD = Decimal(result.window_total.toString())
            .div(tokenExponent)
            .mul(tokenUSDExchangeRate);

          return currentWindowVolumeUSD.add(tokenWindowTotalUSD);
        },
        Decimal(0),
      );

      const previousEntry = index === 0 ? undefined : result.at(index - 1);
      const previousTotalUSD = previousEntry
        ? Decimal(previousEntry.cumulativeTotalUSD)
        : Decimal(0);

      const nextEntry: PoRepDealsPaymentsHistoryEntry = {
        date: entryISODate,
        volumeUSD: windowVolumeUSD.toDecimalPlaces(2).toNumber(),
        cumulativeTotalUSD: previousTotalUSD
          .add(windowVolumeUSD)
          .toDecimalPlaces(2)
          .toNumber(),
      };

      return [...result, nextEntry];
    }, []);
  }

  public async getDealsDoneCountUpToDate(upToDate?: Date): Promise<number> {
    const cutoffBlock = dateToFilecoinBlockHeight(
      upToDate ?? DateTime.utc().toJSDate(),
      { testnet: this.isTestnet() },
    );

    return this.prismaService.po_rep_deal.count({
      where: {
        proposedAtBlock: {
          lt: cutoffBlock,
        },
      },
    });
  }

  public async getOnboardedDataHistory({
    providerId,
    windowSize = 'day',
  }: PoRepOnboardedDataHistoryParameters): Promise<
    PoRepOnboardedDataHistoryEntry[]
  > {
    const results = await createPoRepOnboardedDataHistoryQuery(
      this.queryBuilder,
      {
        genesisTimestamp: getFilecoinGenesisTimestamp({
          testnet: this.isTestnet(),
        }),
        windowSize: windowSize,
        providersIds: providerId,
      },
    ).execute();

    return results.map((result) => {
      return {
        date: DateTime.fromJSDate(result.window_start, {
          zone: 'UTC',
        }).toISODate(),
        volume: result.window_total.toString(),
        cumulativeTotal: result.cumulative_total.toString(),
      };
    });
  }

  public async getDealsValueHistory({
    providerId = null,
    windowSize = 'day',
  }: PoRepDealsValueHistoryParameters): Promise<PoRepDealsValueHistoryEntry[]> {
    const data = await createPoRepDealsValueHistoryQuery(this.queryBuilder, {
      genesisTimestamp: getFilecoinGenesisTimestamp({
        testnet: this.isTestnet(),
      }),
      providersIds: providerId,
      windowSize: windowSize,
    }).execute();

    const firstWindow = data.at(0);

    if (!firstWindow) {
      return [];
    }

    const startDate = DateTime.fromJSDate(firstWindow.window_start);
    const endDate = DateTime.utc().startOf(windowSize);
    const entriesCount =
      Math.ceil(endDate.diff(startDate, windowSize)[`${windowSize}s`]) + 1;
    const uniqueTokens = uniq(data.map((item) => item.token_address));
    const [tokensInfo, tokensUSDExchangeRates] = await Promise.all([
      this.getTokensDetails(uniqueTokens),
      this.getTokensExchangeRatesUSD(uniqueTokens),
    ]);

    const dataByWindow = groupBy(
      data.filter((item) => item.window_start !== null),
      (item) => DateTime.fromJSDate(item.window_start).toISODate(),
    );

    return [...new Array(entriesCount)].reduce<PoRepDealsValueHistoryEntry[]>(
      (result, _, index) => {
        const entryDate = startDate.plus({ [windowSize]: index });
        const entryISODate = entryDate.toISODate();
        const dataForWindow = dataByWindow[entryISODate] ?? [];

        const windowVolumeUSD = dataForWindow.reduce(
          (currentWindowVolumeUSD, result) => {
            const tokenUSDExchangeRate = tokensUSDExchangeRates.get(
              result.token_address,
            );
            const tokenInfo = tokensInfo.get(result.token_address);

            // Should not happen but type safety
            if (!tokenUSDExchangeRate || !tokenInfo) {
              throw new Error(
                `Exchange rate or info not found for token "${result.token_address}"`,
              );
            }

            const tokenExponent = Math.pow(10, tokenInfo.tokenDecimals);
            const tokenWindowTotalUSD = Decimal(result.window_total.toString())
              .div(tokenExponent)
              .mul(tokenUSDExchangeRate);

            return currentWindowVolumeUSD.add(tokenWindowTotalUSD);
          },
          Decimal(0),
        );

        const previousEntry = index === 0 ? undefined : result.at(index - 1);
        const previousTotalUSD = previousEntry
          ? Decimal(previousEntry.cumulativeTotalUSD)
          : Decimal(0);

        const nextEntry: PoRepDealsValueHistoryEntry = {
          date: entryISODate,
          volumeUSD: windowVolumeUSD.toDecimalPlaces(2).toNumber(),
          cumulativeTotalUSD: previousTotalUSD
            .add(windowVolumeUSD)
            .toDecimalPlaces(2)
            .toNumber(),
        };

        return [...result, nextEntry];
      },
      [],
    );
  }

  private isTestnet(): boolean {
    return this.recentNodeClient.chain.id === filecoinCalibration.id;
  }

  private epochToDate(epoch: bigint | number): Date {
    const genesisTimestamp = getFilecoinGenesisTimestamp({
      testnet: this.isTestnet(),
    });
    const epochTimestamp = BigInt(epoch) * 30n + BigInt(genesisTimestamp);

    // eslint-disable-next-line no-restricted-syntax
    return DateTime.fromSeconds(Number(epochTimestamp), {
      zone: 'UTC',
    }).toJSDate();
  }

  private safeNumericToNumber(input: null): null;
  private safeNumericToNumber(input: string | number | bigint): number;
  private safeNumericToNumber(
    input: string | number | bigint | null,
  ): number | null {
    if (input === null) {
      return null;
    }

    return stringToNumber(input.toString());
  }

  private async getTokensDetails<T extends string>(
    tokenAddresses: T[],
  ): Promise<Map<T, TokenDetails>> {
    const tokenDetailsRequests = tokenAddresses.map(async (tokenAddress) => {
      const [tokenSymbol, tokenDecimals] = await Promise.all([
        this.tokenInfoService.getTokenSymbol(tokenAddress),
        this.tokenInfoService.getTokenDecimals(tokenAddress),
      ]);

      return [
        tokenAddress,
        {
          tokenAddress: tokenAddress,
          tokenSymbol: tokenSymbol,
          tokenDecimals: tokenDecimals,
        },
      ] as const;
    });

    const tokenDetailsResponses = await Promise.all(tokenDetailsRequests);
    const tokenDetailsMap = new Map(tokenDetailsResponses);
    return tokenDetailsMap;
  }

  private async getTokensExchangeRatesUSD<T extends string>(
    tokenAddresses: T[],
  ): Promise<Map<T, number>> {
    const tokenExchangeRateRequests = tokenAddresses.map((tokenAddress) => {
      return Promise.all([
        tokenAddress,
        this.priceOracle.getTokenExchangeRateUSD(tokenAddress),
      ]);
    });

    const tokensExchangeRates = await Promise.all(tokenExchangeRateRequests);
    const tokensExchangeRateMap = new Map(tokensExchangeRates);

    return tokensExchangeRateMap;
  }
}
