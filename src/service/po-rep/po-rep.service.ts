import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { groupBy, sumBy, uniq } from 'lodash';
import { DateTime } from 'luxon';
import { Prisma as PrismaRuntime } from '../../generated/prisma/client';
import { InjectQueryBuilder, QueryBuilder } from 'src/db';
import { PrismaService } from 'src/db/prisma.service';
import {
  createPoRepClientDealsHistoryQuery,
  createPoRepClientSpendQuery,
  createPoRepClientStatisticsQuery,
} from 'src/db/queries/po-rep-clients.query';
import { createPoRepDealsPaymentsHistoryQuery } from 'src/db/queries/po-rep-deals-payments-history.query';
import { createPoRepDealsValueHistoryQuery } from 'src/db/queries/po-rep-deals-value-history.query';
import { createPoRepDealsQuery } from 'src/db/queries/po-rep-deals.query';
import { createPoRepOnboardedDataHistoryQuery } from 'src/db/queries/po-rep-onboarded-data-history.query';
import { createPoRepOnboardedDealsQuery } from 'src/db/queries/po-rep-onboarded-deals.query';
import { createPoRepProviderEconomicsStatisticsQuery } from 'src/db/queries/po-rep-provider-economics-statistics.query';
import { createPoRepProviderStorageStatisticsQuery } from 'src/db/queries/po-rep-provider-storage-statistics.query';
import {
  createPoRepActiveProvidersCountQuery,
  createPoRepProvidersEarningsQuery,
  createPoRepProvidersHistoryQuery,
} from 'src/db/queries/po-rep-providers-statistics.query';
import {
  PoRepConfig,
  PoRepPublicClient,
  RECENT_NODE_CLIENT,
} from 'src/po-rep-indexer';
import {
  arrayAverage,
  dateToFilecoinBlockHeight,
  F0Id,
  filecoinBlockHeightToDate,
  getFilecoinGenesisTimestamp,
  safeDiv,
  stringToBool,
  stringToNumber,
} from 'src/utils/utils';
import { F0IdInput } from 'src/utils/validators';
import { getAddress } from 'viem';
import { filecoinCalibration } from 'viem/chains';
import { PoRepPriceOracleService } from '../po-rep-price-oracle/po-rep-price-oracle.service';
import { UrlFinderDealMeasurement } from '../url-finder/types.url-finder';
import { UrlFinderService } from '../url-finder/url-finder.service';
import {
  DealRailState,
  PoRepClient,
  PoRepClientDealsHistoryEntry,
  PoRepClientDealsSla,
  PoRepClientSlaHistoryEntry,
  PoRepComplianceState,
  PoRepDeal,
  PoRepDealsList,
  PoRepDealsListParameters,
  PoRepDealsPaymentsHistoryEntry,
  PoRepDealsPaymentsHistoryParameters,
  PoRepDealsValueHistoryEntry,
  PoRepDealsValueHistoryParameters,
  PoRepHistoryParameters,
  PoRepOnboardedDataHistoryEntry,
  PoRepOnboardedDataHistoryParameters,
  PoRepProviderComplianceStatistics,
  PoRepProviderEconomicsStatistics,
  PoRepProvidersEarningsAgainstSla,
  PoRepProvidersHistoryEntry,
  PoRepProvidersSlaHistoryEntry,
  PoRepProvidersStatistics,
  PoRepProviderStorageStatistics,
  PoRepSLIComplianceHistoryEntry,
  PoRepSLIComplianceHistoryParameters,
  PoRepSLIComplianceHistoryStateValues,
} from './types.po-rep';
import { ERC20TokenInfoService } from '../erc20-token-info/erc20-token-info.service';

interface TokenDetails {
  tokenAddress: string;
  tokenDecimals: number;
  tokenSymbol: string;
}

interface OnboardedDeal {
  dealId: bigint;
  providerId: string;
  dealSizeBytes: bigint;
  requiredRetrievabilityBps: number;
  requiredBandwidthMbps: number;
  requiredLatencyMs: number;
  onboardedAt: DateTime;
  endedAt: DateTime | null;
}

interface DealCompliance {
  deal: OnboardedDeal;
  state: PoRepComplianceState;
  sla: number | null;
  measurementsCount: number;
  expectedMeasurementsCount: number;
}

interface DealsComplianceWindow {
  date: string;
  dealsCompliance: DealCompliance[];
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
    private readonly urlFinderService: UrlFinderService,
    private readonly configService: ConfigService<PoRepConfig, true>,
  ) {}

  public async getDeals({
    providerId = null,
    clientAddress = null,
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
      clientsAddresses:
        clientAddress !== null ? getAddress(clientAddress) : null,
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

  public async getProviders(): Promise<F0Id[]> {
    const results = await this.prismaService.po_rep_deal.findMany({
      select: {
        providerId: true,
      },
      distinct: ['providerId'],
    });

    return results.map((result) => F0Id.from(result.providerId));
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

  public async getProvidersStatistics(
    periodStart: DateTime | null,
    periodEnd: DateTime,
  ): Promise<PoRepProvidersStatistics> {
    const periodEndEpoch = dateToFilecoinBlockHeight(periodEnd.toJSDate(), {
      testnet: this.isTestnet(),
    });

    const [
      totalProvidersCount,
      activeProviders,
      providersEarningsUSD,
      dealsCompliance,
    ] = await Promise.all([
      this.prismaService.po_rep_storage_provider.count({
        where: {
          registeredAtBlock: {
            lte: periodEndEpoch,
          },
        },
      }),
      createPoRepActiveProvidersCountQuery(this.queryBuilder, {
        periodEndEpoch: periodEndEpoch,
      }).executeTakeFirstOrThrow(),
      this.getProvidersEarningsUSD(periodStart, periodEnd),
      this.getPeriodDealsCompliance(periodStart, periodEnd),
    ]);

    const earningsUSD = [...providersEarningsUSD.values()].reduce(
      (totalUSD, providerEarningsUSD) => totalUSD.add(providerEarningsUSD),
      Decimal(0),
    );

    return {
      totalProvidersCount: totalProvidersCount,
      activeProvidersCount: stringToNumber(
        activeProviders.active_providers_count.toString(),
      ),
      earningsUSD: earningsUSD.toDecimalPlaces(2).toNumber(),
      averageSla: this.getAverageSla(dealsCompliance),
    };
  }

  public async getProvidersEarningsAgainstSla(
    periodStart: DateTime | null,
    periodEnd: DateTime,
  ): Promise<PoRepProvidersEarningsAgainstSla> {
    const [providersEarningsUSD, dealsCompliance] = await Promise.all([
      this.getProvidersEarningsUSD(periodStart, periodEnd),
      this.getPeriodDealsCompliance(periodStart, periodEnd),
    ]);

    const providersDealsCompliance = groupBy(
      dealsCompliance,
      (item) => item.deal.providerId,
    );
    const providersIds = uniq([
      ...providersEarningsUSD.keys(),
      ...Object.keys(providersDealsCompliance),
    ]);

    return {
      slaTarget: this.getSlaTarget(),
      providers: providersIds.map((providerId) => {
        return {
          providerId: F0Id.from(providerId).toString(),
          earningsUSD: (providersEarningsUSD.get(providerId) ?? Decimal(0))
            .toDecimalPlaces(2)
            .toNumber(),
          averageSla: this.getAverageSla(
            providersDealsCompliance[providerId] ?? [],
          ),
        };
      }),
    };
  }

  public async getProvidersHistory(
    periodStart: DateTime | null,
    windowSize: PoRepHistoryParameters['windowSize'],
  ): Promise<PoRepProvidersHistoryEntry[]> {
    const results = await createPoRepProvidersHistoryQuery(this.queryBuilder, {
      genesisTimestamp: getFilecoinGenesisTimestamp({
        testnet: this.isTestnet(),
      }),
      windowSize: windowSize,
      periodStart: periodStart !== null ? periodStart.toJSDate() : null,
    }).execute();

    const firstWindowDate =
      periodStart !== null ? periodStart.startOf(windowSize).toISODate() : null;

    return results
      .map((result) => {
        return {
          date: DateTime.fromJSDate(result.window_start, {
            zone: 'UTC',
          }).toISODate(),
          newProvidersCount: stringToNumber(
            result.new_providers_count.toString(),
          ),
          totalProvidersCount: stringToNumber(
            result.total_providers_count.toString(),
          ),
          activeProvidersCount: stringToNumber(
            result.active_providers_count.toString(),
          ),
        };
      })
      .filter(
        (entry) => firstWindowDate === null || entry.date >= firstWindowDate,
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

  public async getProviderComplianceStatistics(
    providerId: F0IdInput,
  ): Promise<PoRepProviderComplianceStatistics | null> {
    const provider =
      await this.prismaService.po_rep_storage_provider.findUnique({
        where: {
          providerId: F0Id.from(providerId).toBigInt(),
        },
      });

    if (!provider) {
      return null;
    }

    const to = DateTime.utc();
    const from = to.minus({ days: 30 });
    const [totalDealsCount, deals] = await Promise.all([
      this.prismaService.po_rep_deal.count({
        where: {
          providerId: provider.providerId,
        },
      }),
      this.getOnboardedDeals(providerId, null),
    ]);

    const activeDeals = deals.filter((deal) => deal.endedAt === null);
    const dealsCompliance = await Promise.all(
      activeDeals.map(async (deal) => {
        const measurements = await this.urlFinderService.getDealMeasurements(
          deal.dealId,
          from,
          to,
        );

        return this.getDealCompliance(deal, measurements, from, to);
      }),
    );

    const countDeals = (state: PoRepComplianceState) =>
      dealsCompliance.filter((item) => item.state === state).length;

    return {
      totalDealsCount: totalDealsCount,
      activeDealsCount: activeDeals.length,
      compliantDealsPercentage: safeDiv(
        countDeals('compliant'),
        activeDeals.length,
        null,
      ),
      compliantDealsCount: countDeals('compliant'),
      nonCompliantDealsCount: countDeals('nonCompliant'),
      unknownDealsCount: countDeals('unknown'),
      averageSla: this.getAverageSla(dealsCompliance),
      measurementsCount: sumBy(dealsCompliance, 'measurementsCount'),
      expectedMeasurementsCount: sumBy(
        dealsCompliance,
        'expectedMeasurementsCount',
      ),
    };
  }

  public async getSLIComplianceHistory({
    windowSize = 'day',
    providerId = null,
    dealId = null,
  }: PoRepSLIComplianceHistoryParameters): Promise<
    PoRepSLIComplianceHistoryEntry[]
  > {
    const deals = await this.getOnboardedDeals(providerId, dealId);
    const history = await this.getDealsComplianceHistory(deals, windowSize);

    return history.map(({ date, dealsCompliance }) => {
      return {
        date: date,
        averageSla: this.getAverageSla(dealsCompliance),
        measurementsCount: sumBy(dealsCompliance, 'measurementsCount'),
        expectedMeasurementsCount: sumBy(
          dealsCompliance,
          'expectedMeasurementsCount',
        ),
        compliant: this.getComplianceStateValues(dealsCompliance, 'compliant'),
        nonCompliant: this.getComplianceStateValues(
          dealsCompliance,
          'nonCompliant',
        ),
        unknown: this.getComplianceStateValues(dealsCompliance, 'unknown'),
      };
    });
  }

  public async getProvidersSlaHistory(
    periodStart: DateTime | null,
    windowSize: PoRepHistoryParameters['windowSize'],
  ): Promise<PoRepProvidersSlaHistoryEntry[]> {
    const slaTarget = this.getSlaTarget();
    const deals = await this.getOnboardedDeals(null, null);
    const history = await this.getDealsComplianceHistory(
      deals,
      windowSize,
      periodStart,
    );

    return history.map(({ date, dealsCompliance }) => {
      const providersSla = Object.values(
        groupBy(dealsCompliance, (item) => item.deal.providerId),
      )
        .map((providerDealsCompliance) =>
          this.getAverageSla(providerDealsCompliance),
        )
        .filter((sla) => sla !== null);
      const providersBelowTargetCount = providersSla.filter(
        (sla) => sla < slaTarget,
      ).length;

      return {
        date: date,
        averageSla: this.getAverageSla(dealsCompliance),
        slaTarget: slaTarget,
        providersBelowTargetCount: providersBelowTargetCount,
        providersBelowTargetPercentage: safeDiv(
          providersBelowTargetCount,
          providersSla.length,
          null,
        ),
      };
    });
  }

  public async getClient(clientAddress: string): Promise<PoRepClient | null> {
    const address = getAddress(clientAddress);
    const to = DateTime.utc();
    const from = to.minus({ days: 30 });
    const fromEpoch = dateToFilecoinBlockHeight(from.toJSDate(), {
      testnet: this.isTestnet(),
    });

    const [statistics, spend, dealsCompliance] = await Promise.all([
      createPoRepClientStatisticsQuery(this.queryBuilder, {
        clientAddress: address,
      }).executeTakeFirst(),
      createPoRepClientSpendQuery(this.queryBuilder, {
        clientAddress: address,
        fromEpoch: fromEpoch,
      }).execute(),
      this.getPeriodDealsCompliance(from, to, address),
    ]);

    if (!statistics) {
      return null;
    }

    const uniqueTokens = uniq(spend.map((item) => item.token_address));
    const [tokensDetails, tokensExchangeRatesUSD] = await Promise.all([
      this.getTokensDetails(uniqueTokens),
      this.getTokensExchangeRatesUSD(uniqueTokens),
    ]);

    const spendLast30DaysUSD = spend
      .reduce((totalUSD, item) => {
        const tokenDetails = tokensDetails.get(item.token_address);
        const tokenExponent = 10n ** BigInt(tokenDetails.tokenDecimals);

        return totalUSD.add(
          Decimal(item.total_amount_settled.toString())
            .div(tokenExponent.toString())
            .mul(tokensExchangeRatesUSD.get(item.token_address)),
        );
      }, Decimal(0))
      .toDecimalPlaces(2)
      .toNumber();

    return new PoRepClient({
      clientAddress: statistics.client_address,
      servicesUsed: {
        fcss: true,
        fwss: null,
      },
      dealsCount: stringToNumber(statistics.deals_count.toString()),
      firstOnboardedAt:
        statistics.first_onboarded_epoch !== null
          ? this.epochToDate(BigInt(statistics.first_onboarded_epoch))
          : null,
      averageSla: this.getAverageSla(dealsCompliance),
      spendLast30DaysUSD: spendLast30DaysUSD,
    });
  }

  public async getClientDealsHistory(
    clientAddress: string,
    periodStart: DateTime | null,
    windowSize: PoRepHistoryParameters['windowSize'],
  ): Promise<PoRepClientDealsHistoryEntry[]> {
    const results = await createPoRepClientDealsHistoryQuery(
      this.queryBuilder,
      {
        clientAddress: getAddress(clientAddress),
        genesisTimestamp: getFilecoinGenesisTimestamp({
          testnet: this.isTestnet(),
        }),
        windowSize: windowSize,
        periodStart: periodStart !== null ? periodStart.toJSDate() : null,
      },
    ).execute();

    const firstWindowDate =
      periodStart !== null ? periodStart.startOf(windowSize).toISODate() : null;

    return results
      .map((result) => {
        return {
          date: DateTime.fromJSDate(result.window_start, {
            zone: 'UTC',
          }).toISODate(),
          dealsCount: stringToNumber(result.window_total.toString()),
          cumulativeDealsCount: stringToNumber(
            result.cumulative_total.toString(),
          ),
        };
      })
      .filter(
        (entry) => firstWindowDate === null || entry.date >= firstWindowDate,
      );
  }

  public async getClientSlaHistory(
    clientAddress: string,
    periodStart: DateTime | null,
    windowSize: PoRepHistoryParameters['windowSize'],
  ): Promise<PoRepClientSlaHistoryEntry[]> {
    const slaTarget = this.getSlaTarget();
    const deals = await this.getOnboardedDeals(
      null,
      null,
      getAddress(clientAddress),
    );
    const history = await this.getDealsComplianceHistory(
      deals,
      windowSize,
      periodStart,
    );

    return history.map(({ date, dealsCompliance }) => {
      const dealsSla = dealsCompliance
        .map((item) => item.sla)
        .filter((sla) => sla !== null);
      const dealsBelowTargetCount = dealsSla.filter(
        (sla) => sla < slaTarget,
      ).length;

      return {
        date: date,
        averageSla: this.getAverageSla(dealsCompliance),
        slaTarget: slaTarget,
        dealsBelowTargetCount: dealsBelowTargetCount,
        dealsBelowTargetPercentage: safeDiv(
          dealsBelowTargetCount,
          dealsSla.length,
          null,
        ),
      };
    });
  }

  public async getClientDealsSla(
    clientAddress: string,
  ): Promise<PoRepClientDealsSla> {
    const address = getAddress(clientAddress);
    const to = DateTime.utc();
    const from = to.minus({ days: 30 });

    const [deals, dealsCompliance] = await Promise.all([
      this.prismaService.po_rep_deal.findMany({
        where: {
          client: address,
        },
        orderBy: {
          dealId: 'desc',
        },
      }),
      this.getPeriodDealsCompliance(from, to, address),
    ]);

    const dealsSla = new Map(
      dealsCompliance.map((item) => [item.deal.dealId, item.sla]),
    );

    return {
      slaTarget: this.getSlaTarget(),
      deals: deals.map((deal) => {
        return {
          dealId: deal.dealId.toString(),
          providerId: F0Id.from(deal.providerId).toString(),
          state: deal.state,
          averageSla: dealsSla.get(deal.dealId) ?? null,
        };
      }),
    };
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

  private async getOnboardedDeals(
    providerId: F0IdInput | null,
    dealId: string | null,
    clientAddress: string | null = null,
  ): Promise<OnboardedDeal[]> {
    const results = await createPoRepOnboardedDealsQuery(this.queryBuilder, {
      providersIds: providerId,
      dealsIds: dealId,
      clientsAddresses: clientAddress,
    }).execute();

    return results.map((result) => ({
      dealId: BigInt(result.deal_id),
      providerId: result.provider_id.toString(),
      dealSizeBytes: BigInt(result.deal_size_bytes),
      requiredRetrievabilityBps: result.required_retrievability_bps,
      requiredBandwidthMbps:
        stringToNumber(result.required_bandwidth_bytes_per_second.toString()) /
        125000,
      requiredLatencyMs: result.required_latency_ms,
      onboardedAt: DateTime.fromJSDate(
        this.epochToDate(BigInt(result.onboarded_at_epoch)),
        { zone: 'UTC' },
      ),
      endedAt:
        result.ended_at_epoch !== null
          ? DateTime.fromJSDate(
              this.epochToDate(BigInt(result.ended_at_epoch)),
              { zone: 'UTC' },
            )
          : null,
    }));
  }

  private getDealCompliance(
    deal: OnboardedDeal,
    measurements: UrlFinderDealMeasurement[],
    from: DateTime,
    to: DateTime,
  ): DealCompliance {
    const results = measurements
      .map((measurement) => this.getMeasurementResult(deal, measurement))
      .filter((result) => result !== null);
    const periodStart = DateTime.max(from, deal.onboardedAt);
    const periodEnd =
      deal.endedAt !== null ? DateTime.min(to, deal.endedAt) : to;
    const expectedMeasurementsCount = Math.max(
      Math.ceil(periodEnd.diff(periodStart, 'days').days),
      0,
    );

    if (results.length === 0) {
      return {
        deal: deal,
        state: 'unknown',
        sla: null,
        measurementsCount: 0,
        expectedMeasurementsCount: expectedMeasurementsCount,
      };
    }

    const passedCount = results.filter((result) => result).length;

    return {
      deal: deal,
      state: passedCount === results.length ? 'compliant' : 'nonCompliant',
      sla: passedCount / results.length,
      measurementsCount: results.length,
      expectedMeasurementsCount: expectedMeasurementsCount,
    };
  }

  private getMeasurementResult(
    deal: OnboardedDeal,
    measurement: UrlFinderDealMeasurement,
  ): boolean | null {
    if (measurement.measurement_state === 'failed') {
      return false;
    }

    const sliPairs: [
      requiredValue: number,
      measuredValue: number | null,
      reverseCheck: boolean,
    ][] = [
      [
        deal.requiredRetrievabilityBps,
        measurement.porep_slis.retrievability_bps,
        false,
      ],
      [
        deal.requiredBandwidthMbps,
        measurement.porep_slis.bandwidth_mbps,
        false,
      ],
      [deal.requiredLatencyMs, measurement.porep_slis.latency_ms, true],
    ];

    const requiredSliPairs = sliPairs.filter(
      ([requiredValue]) => requiredValue > 0,
    );

    const measuredSliPairs = requiredSliPairs.filter(
      ([, measuredValue]) => measuredValue !== null,
    );

    const measuredSlisMet = measuredSliPairs.every(
      ([requiredValue, measuredValue, reverseCheck]) =>
        reverseCheck
          ? measuredValue <= requiredValue
          : measuredValue >= requiredValue,
    );

    if (!measuredSlisMet) {
      return false;
    }

    return measuredSliPairs.length === requiredSliPairs.length ? true : null;
  }

  private async getDealsComplianceHistory(
    deals: OnboardedDeal[],
    windowSize: PoRepHistoryParameters['windowSize'],
    periodStart: DateTime | null = null,
  ): Promise<DealsComplianceWindow[]> {
    if (deals.length === 0) {
      return [];
    }

    const now = DateTime.utc();
    const firstOnboardedAt = DateTime.min(
      ...deals.map((deal) => deal.onboardedAt),
    );
    const firstWindowStart = (
      periodStart !== null
        ? DateTime.max(firstOnboardedAt, periodStart)
        : firstOnboardedAt
    ).startOf(windowSize);
    const historyDeals = deals.filter(
      (deal) => deal.endedAt === null || deal.endedAt >= firstWindowStart,
    );
    const dealsMeasurements = await Promise.all(
      historyDeals.map((deal) =>
        this.urlFinderService.getDealMeasurements(
          deal.dealId,
          DateTime.max(deal.onboardedAt, firstWindowStart),
          deal.endedAt ?? now,
        ),
      ),
    );

    const history: DealsComplianceWindow[] = [];

    for (
      let windowStart = firstWindowStart;
      windowStart <= now;
      windowStart = windowStart.plus({ [windowSize]: 1 })
    ) {
      const windowEnd = windowStart.plus({ [windowSize]: 1 });
      const windowDealsCompliance = historyDeals.flatMap((deal, index) => {
        if (
          deal.onboardedAt >= windowEnd ||
          (deal.endedAt !== null && deal.endedAt < windowStart)
        ) {
          return [];
        }

        const windowMeasurements = dealsMeasurements[index].filter(
          (measurement) => {
            const testedAt = DateTime.fromISO(measurement.tested_at, {
              zone: 'UTC',
            });

            return testedAt >= windowStart && testedAt < windowEnd;
          },
        );

        return [
          this.getDealCompliance(
            deal,
            windowMeasurements,
            windowStart,
            DateTime.min(windowEnd, now),
          ),
        ];
      });

      history.push({
        date: windowStart.toISODate(),
        dealsCompliance: windowDealsCompliance,
      });
    }

    return history;
  }

  private async getProvidersEarningsUSD(
    periodStart: DateTime | null,
    periodEnd: DateTime,
  ): Promise<Map<string, PrismaRuntime.Decimal>> {
    const earnings = await createPoRepProvidersEarningsQuery(
      this.queryBuilder,
      {
        periodStartEpoch:
          periodStart !== null
            ? dateToFilecoinBlockHeight(periodStart.toJSDate(), {
                testnet: this.isTestnet(),
              })
            : null,
        periodEndEpoch: dateToFilecoinBlockHeight(periodEnd.toJSDate(), {
          testnet: this.isTestnet(),
        }),
      },
    ).execute();

    const uniqueTokens = uniq(earnings.map((item) => item.token_address));
    const [tokensDetails, tokensExchangeRatesUSD] = await Promise.all([
      this.getTokensDetails(uniqueTokens),
      this.getTokensExchangeRatesUSD(uniqueTokens),
    ]);

    return earnings.reduce((providersEarningsUSD, item) => {
      const providerId = item.provider_id.toString();
      const tokenDetails = tokensDetails.get(item.token_address);
      const tokenExchangeRateUSD = tokensExchangeRatesUSD.get(
        item.token_address,
      );

      if (!tokenDetails || !tokenExchangeRateUSD) {
        throw new Error(
          `Exchange rate or info not found for token "${item.token_address}"`,
        );
      }

      const tokenExponent = 10n ** BigInt(tokenDetails.tokenDecimals);

      return providersEarningsUSD.set(
        providerId,
        (providersEarningsUSD.get(providerId) ?? Decimal(0)).add(
          Decimal(item.net_amount.toString())
            .div(tokenExponent.toString())
            .mul(tokenExchangeRateUSD),
        ),
      );
    }, new Map<string, PrismaRuntime.Decimal>());
  }

  private async getPeriodDealsCompliance(
    periodStart: DateTime | null,
    periodEnd: DateTime,
    clientAddress: string | null = null,
  ): Promise<DealCompliance[]> {
    const deals = await this.getOnboardedDeals(null, null, clientAddress);
    const periodDeals = deals.filter(
      (deal) =>
        deal.onboardedAt < periodEnd &&
        (periodStart === null ||
          deal.endedAt === null ||
          deal.endedAt >= periodStart),
    );

    return Promise.all(
      periodDeals.map(async (deal) => {
        const from =
          periodStart !== null
            ? DateTime.max(periodStart, deal.onboardedAt)
            : deal.onboardedAt;
        const to =
          deal.endedAt !== null
            ? DateTime.min(periodEnd, deal.endedAt)
            : periodEnd;
        const measurements = await this.urlFinderService.getDealMeasurements(
          deal.dealId,
          from,
          to,
        );

        return this.getDealCompliance(deal, measurements, from, to);
      }),
    );
  }

  private getSlaTarget(): number {
    return this.configService.get('PO_REP_SLA_TARGET', { infer: true });
  }

  private getAverageSla(dealsCompliance: DealCompliance[]): number | null {
    return arrayAverage(
      dealsCompliance.map((item) => item.sla).filter((sla) => sla !== null),
    );
  }

  private getComplianceStateValues(
    dealsCompliance: DealCompliance[],
    state: PoRepComplianceState,
  ): PoRepSLIComplianceHistoryStateValues {
    const stateDealsCompliance = dealsCompliance.filter(
      (item) => item.state === state,
    );
    const providersCount = uniq(
      stateDealsCompliance.map((item) => item.deal.providerId),
    ).length;
    const totalProvidersCount = uniq(
      dealsCompliance.map((item) => item.deal.providerId),
    ).length;
    const dealsSize = stateDealsCompliance.reduce(
      (total, item) => total + item.deal.dealSizeBytes,
      0n,
    );
    const totalDealsSize = dealsCompliance.reduce(
      (total, item) => total + item.deal.dealSizeBytes,
      0n,
    );

    return {
      providersCount: providersCount,
      providersPercentage: safeDiv(providersCount, totalProvidersCount, 0),
      dealsCount: stateDealsCompliance.length,
      dealsPercentage: safeDiv(
        stateDealsCompliance.length,
        dealsCompliance.length,
        0,
      ),
      totalDealsSize: dealsSize.toString(),
      totalDealsSizePercentage:
        totalDealsSize === 0n
          ? 0
          : Decimal(dealsSize.toString())
              .div(totalDealsSize.toString())
              .toNumber(),
    };
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
    return new Map(tokenDetailsResponses);
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
    return new Map(tokensExchangeRates);
  }
}
