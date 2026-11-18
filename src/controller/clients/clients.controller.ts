import { Cache, CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotImplementedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { PoRepService } from 'src/service/po-rep/po-rep.service';
import { ControllerBase } from '../base/controller-base';
import { DashboardStatisticsRequest } from '../base/types.controller-base';
import {
  ClientsHistoryEntry,
  ClientsHistoryRequest,
  ClientsReturningHistoryEntry,
} from './types.clients';

@Controller('clients')
@CacheTTL(1000 * 60 * 30) // 30 minutes
export class ClientsController extends ControllerBase {
  constructor(
    @Inject(CACHE_MANAGER) private _cacheManager: Cache,
    private readonly poRepService: PoRepService,
  ) {
    super();
  }

  @Get('/history')
  @ApiOperation({
    summary:
      'Get history of new and total clients and average datasets per client, starting from the period start',
  })
  @ApiOkResponse({
    type: [ClientsHistoryEntry],
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
    }: ClientsHistoryRequest,
  ): Promise<ClientsHistoryEntry[]> {
    this.validateServiceImplemented(service);

    const fcss = await this.poRepService.getClientsHistory(
      this.getDashboardPeriods(period).current.periodStart,
      windowSize,
    );

    return fcss.map((entry) => {
      return {
        date: entry.date,
        newClientsCount: this.fcssOnly(entry.newClientsCount),
        totalClientsCount: this.fcssOnly(entry.totalClientsCount),
        averageDatasetsPerClient: this.fcssOnly(entry.averageDatasetsPerClient),
      };
    });
  }

  @Get('/returning-history')
  @ApiOperation({
    summary:
      'Get monthly history of returning clients by action (onboarded new datasets or extended deals), starting from the period start',
  })
  @ApiOkResponse({
    type: [ClientsReturningHistoryEntry],
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  @ApiNotImplementedResponse({
    description: 'History for FWSS is not implemented yet',
  })
  public async getReturningHistory(
    @Query() { period = '30d', service = 'all' }: DashboardStatisticsRequest,
  ): Promise<ClientsReturningHistoryEntry[]> {
    this.validateServiceImplemented(service);

    const fcss = await this.poRepService.getReturningClientsHistory(
      this.getDashboardPeriods(period).current.periodStart,
      'month',
    );

    return fcss.map((entry) => {
      return {
        date: entry.date,
        returningClientsCount: this.fcssOnly(entry.returningClientsCount),
        onboardedNewDatasetsClientsCount: this.fcssOnly(
          entry.onboardedNewDatasetsClientsCount,
        ),
        extendedDealsClientsCount: this.fcssOnly(
          entry.extendedDealsClientsCount,
        ),
      };
    });
  }
}
