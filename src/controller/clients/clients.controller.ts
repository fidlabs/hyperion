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
  ClientsHistoryEntry,
  ClientsHistoryRequest,
  ClientsList,
  ClientsListRequest,
  ClientsPeriodStatistics,
  ClientsReturningHistoryEntry,
  ClientsRevenueConcentrationHistoryEntry,
  ClientsStatistics,
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

  @Get()
  @ApiOperation({
    summary:
      'Get list of clients (payer wallets) with datasets count and Filecoin Pay wallet status',
  })
  @ApiOkResponse({
    type: ClientsList,
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  @ApiNotImplementedResponse({
    description: 'List for FWSS is not implemented yet',
  })
  public async getClients(
    @Query() { service = 'all', limit, page }: ClientsListRequest,
  ): Promise<ClientsList> {
    this.validateServiceImplemented(service);

    const fcss = await this.poRepService.getClients({
      limit: limit,
      page: page,
    });

    return {
      data: fcss.data.map((entry) => {
        return {
          clientAddress: entry.clientAddress,
          datasetsCount: this.fcssOnly(entry.datasetsCount),
          walletStatus: entry.walletStatus,
        };
      }),
      pagination: fcss.pagination,
    };
  }

  @Get('/statistics')
  @ApiOperation({
    summary:
      'Get clients statistics for a period, with values of the previous period for comparison',
  })
  @ApiOkResponse({
    type: ClientsStatistics,
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  @ApiNotImplementedResponse({
    description: 'Statistics for FWSS are not implemented yet',
  })
  public async getStatistics(
    @Query() { period = '30d', service = 'all' }: StatisticsRequest,
  ): Promise<ClientsStatistics> {
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
      this.getStatisticsPeriods(period).current.periodStart,
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
    @Query() { period = '30d', service = 'all' }: StatisticsRequest,
  ): Promise<ClientsReturningHistoryEntry[]> {
    this.validateServiceImplemented(service);

    const fcss = await this.poRepService.getReturningClientsHistory(
      this.getStatisticsPeriods(period).current.periodStart,
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

  @Get('/revenue-concentration-history')
  @ApiOperation({
    summary:
      'Get history of share of revenue paid by the 10 largest clients, starting from the period start',
  })
  @ApiOkResponse({
    type: [ClientsRevenueConcentrationHistoryEntry],
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  @ApiNotImplementedResponse({
    description: 'History for FWSS is not implemented yet',
  })
  public async getRevenueConcentrationHistory(
    @Query()
    {
      period = '30d',
      service = 'all',
      windowSize = 'month',
    }: ClientsHistoryRequest,
  ): Promise<ClientsRevenueConcentrationHistoryEntry[]> {
    this.validateServiceImplemented(service);

    const fcss = await this.poRepService.getClientsRevenueConcentrationHistory(
      this.getStatisticsPeriods(period).current.periodStart,
      windowSize,
    );

    return fcss.map((entry) => {
      return {
        date: entry.date,
        topClientsRevenueShare: this.fcssOnly(entry.topClientsRevenueShare),
      };
    });
  }

  private async getPeriodStatistics({
    periodStart,
    periodEnd,
  }: StatisticsPeriodBoundaries): Promise<ClientsPeriodStatistics> {
    const fcss = await this.poRepService.getClientsStatistics(
      periodStart,
      periodEnd,
    );

    return {
      periodStart: periodStart !== null ? periodStart.toJSDate() : null,
      periodEnd: periodEnd.toJSDate(),
      totalClientsCount: this.fcssOnly(fcss.totalClientsCount),
      averageDatasetsPerClient: this.fcssOnly(fcss.averageDatasetsPerClient),
      returningClientsCount: this.fcssOnly(fcss.returningClientsCount),
      fundedWalletsCount: this.fcssOnly(fcss.fundedWalletsCount),
      fundedWalletsPercentage: this.fcssOnly(fcss.fundedWalletsPercentage),
    };
  }
}
