import { Cache, CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotImplementedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { PoRepService } from 'src/service/po-rep/po-rep.service';
import {
  ControllerBase,
  StatisticsPeriodBoundaries,
} from '../base/controller-base';
import { StatisticsRequest } from '../base/types.controller-base';
import {
  StorageProvidersEarningsAgainstSla,
  StorageProvidersEarningsAgainstSlaRequest,
  StorageProvidersHistoryEntry,
  StorageProvidersHistoryRequest,
  StorageProvidersPeriodStatistics,
  StorageProvidersSlaHistory,
  StorageProvidersStatistics,
} from './types.storage-providers';

@Controller('storage-providers')
@CacheTTL(1000 * 60 * 30) // 30 minutes
export class StorageProvidersController extends ControllerBase {
  constructor(
    @Inject(CACHE_MANAGER) private _cacheManager: Cache,
    private readonly poRepService: PoRepService,
  ) {
    super();
  }

  @Get('/statistics')
  @ApiOperation({
    summary:
      'Get storage providers statistics for a period, with values of the previous period for comparison',
  })
  @ApiOkResponse({
    type: StorageProvidersStatistics,
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  @ApiNotImplementedResponse({
    description: 'Statistics for FWSS are not implemented yet',
  })
  public async getStatistics(
    @Query() { period = '30d', service = 'all' }: StatisticsRequest,
  ): Promise<StorageProvidersStatistics> {
    this.validateServiceImplemented(service);

    const periods = this.getStatisticsPeriods(period);
    const [current, previous] = await Promise.all([
      this.getPeriodStatistics(periods.current),
      periods.previous !== null
        ? this.getPeriodStatistics(periods.previous)
        : null,
    ]);

    return {
      period: period,
      service: service,
      current: current,
      previous: previous,
    };
  }

  @Get('/history')
  @ApiOperation({
    summary:
      'Get history of new, total and active storage providers, starting from the period start',
  })
  @ApiOkResponse({
    type: [StorageProvidersHistoryEntry],
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  @ApiNotImplementedResponse({
    description: 'History for FWSS is not implemented yet',
  })
  public async getHistory(
    @Query()
    {
      period = '30d',
      service = 'all',
      windowSize = 'day',
    }: StorageProvidersHistoryRequest,
  ): Promise<StorageProvidersHistoryEntry[]> {
    this.validateServiceImplemented(service);

    const fcss = await this.poRepService.getProvidersHistory(
      this.getStatisticsPeriods(period).current.start,
      windowSize,
    );

    return fcss.map((entry) => {
      return {
        date: entry.date,
        newProvidersCount: this.fcssOnly(entry.newProvidersCount),
        totalProvidersCount: this.fcssOnly(entry.totalProvidersCount),
        activeProvidersCount: this.fcssOnly(entry.activeProvidersCount),
      };
    });
  }

  @Get('/sla-history')
  @ApiOperation({
    summary:
      'Get history of average SLA and share of providers below the SLA target, starting from the period start',
  })
  @ApiOkResponse({
    type: StorageProvidersSlaHistory,
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  @ApiNotImplementedResponse({
    description: 'SLA history for FWSS is not implemented yet',
  })
  public async getSlaHistory(
    @Query()
    {
      period = '30d',
      service = 'all',
      windowSize = 'day',
    }: StorageProvidersHistoryRequest,
  ): Promise<StorageProvidersSlaHistory> {
    this.validateServiceImplemented(service);

    const fcss = await this.poRepService.getProvidersSlaHistory(
      this.getStatisticsPeriods(period).current.start,
      windowSize,
    );

    return {
      slaTarget: this.fcssOnlyWithoutTotal(fcss.slaTarget),
      data: fcss.data.map((entry) => {
        return {
          date: entry.date,
          averageSla: this.fcssOnly(entry.averageSla),
          providersBelowTargetCount: this.fcssOnlyWithoutTotal(
            entry.providersBelowTargetCount,
          ),
          providersBelowTargetPercentage: this.fcssOnlyWithoutTotal(
            entry.providersBelowTargetPercentage,
          ),
        };
      }),
    };
  }

  @Get('/earnings-against-sla')
  @ApiOperation({
    summary:
      'Get earnings and average SLA of each storage provider in the last 30 days',
  })
  @ApiOkResponse({
    type: StorageProvidersEarningsAgainstSla,
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  @ApiNotImplementedResponse({
    description: 'Earnings against SLA for FWSS are not implemented yet',
  })
  public async getEarningsAgainstSla(
    @Query() { service = 'all' }: StorageProvidersEarningsAgainstSlaRequest,
  ): Promise<StorageProvidersEarningsAgainstSla> {
    this.validateServiceImplemented(service);

    const { start, end } = this.getStatisticsPeriods('30d').current;
    const fcss = await this.poRepService.getProvidersEarningsAgainstSla(
      start,
      end,
    );

    return {
      periodStart: start.toJSDate(),
      periodEnd: end.toJSDate(),
      slaTarget: this.fcssOnlyWithoutTotal(fcss.slaTarget),
      providers: fcss.providers.map((provider) => {
        return {
          ...provider,
          service: 'fcss',
        };
      }),
    };
  }

  private async getPeriodStatistics({
    start,
    end,
  }: StatisticsPeriodBoundaries): Promise<StorageProvidersPeriodStatistics> {
    const fcss = await this.poRepService.getProvidersStatistics(start, end);

    return {
      periodStart: start !== null ? start.toJSDate() : null,
      periodEnd: end.toJSDate(),
      totalProvidersCount: this.fcssOnly(fcss.totalProvidersCount),
      activeProvidersCount: this.fcssOnly(fcss.activeProvidersCount),
      earningsUSD: this.fcssOnly(fcss.earningsUSD),
      averageSla: this.fcssOnly(fcss.averageSla),
    };
  }
}
