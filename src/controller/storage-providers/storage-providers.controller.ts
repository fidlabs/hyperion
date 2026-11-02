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
  DashboardServiceValue,
  DashboardStatisticsRequest,
} from '../base/types.controller-base';
import {
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
    if (service === 'fwss') {
      throw new NotImplementedException(
        'Storage providers statistics for FWSS are not implemented yet',
      );
    }

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

  private async getPeriodStatistics({
    periodStart,
    periodEnd,
  }: DashboardPeriodBoundaries): Promise<StorageProvidersPeriodStatistics> {
    const fcss = await this.poRepService.getProvidersStatistics(
      periodStart,
      periodEnd,
    );

    const fcssOnly = (value: number | null): DashboardServiceValue => ({
      total: value,
      fcss: value,
      fwss: null,
    });

    return {
      periodStart: periodStart !== null ? periodStart.toJSDate() : null,
      periodEnd: periodEnd.toJSDate(),
      totalProvidersCount: fcssOnly(fcss.totalProvidersCount),
      activeProvidersCount: fcssOnly(fcss.activeProvidersCount),
      earningsUSD: fcssOnly(fcss.earningsUSD),
      averageSla: fcssOnly(null),
    };
  }
}
