import { Cache, CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import {
  Controller,
  Get,
  Inject,
  NotImplementedException,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotImplementedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { PoRepService } from 'src/service/po-rep/po-rep.service';
import {
  ControllerBase,
  DashboardPeriodBoundaries,
} from '../base/controller-base';
import {
  DashboardService,
  DashboardServiceValue,
  DashboardStatisticsRequest,
} from '../base/types.controller-base';
import {
  StorageProvidersHistoryEntry,
  StorageProvidersHistoryRequest,
  StorageProvidersPeriodStatistics,
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
    @Query() { period = '30d', service = 'all' }: DashboardStatisticsRequest,
  ): Promise<StorageProvidersStatistics> {
    this.validateServiceImplemented(service);

    const periods = this.getDashboardPeriods(period);
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
      this.getDashboardPeriods(period).current.periodStart,
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

  private async getPeriodStatistics({
    periodStart,
    periodEnd,
  }: DashboardPeriodBoundaries): Promise<StorageProvidersPeriodStatistics> {
    const fcss = await this.poRepService.getProvidersStatistics(
      periodStart,
      periodEnd,
    );

    return {
      periodStart: periodStart !== null ? periodStart.toJSDate() : null,
      periodEnd: periodEnd.toJSDate(),
      totalProvidersCount: this.fcssOnly(fcss.totalProvidersCount),
      activeProvidersCount: this.fcssOnly(fcss.activeProvidersCount),
      earningsUSD: this.fcssOnly(fcss.earningsUSD),
      averageSla: this.fcssOnly(null),
    };
  }

  private validateServiceImplemented(service: DashboardService) {
    if (service === 'fwss') {
      throw new NotImplementedException(
        'Storage providers statistics for FWSS are not implemented yet',
      );
    }
  }

  private fcssOnly(value: number | null): DashboardServiceValue {
    return {
      total: value,
      fcss: value,
      fwss: null,
    };
  }
}
