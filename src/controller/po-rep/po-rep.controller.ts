import { Cache, CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { PoRepService } from 'src/service/po-rep/po-rep.service';
import {
  PoRepClient,
  PoRepClientDealsHistoryEntry,
  PoRepClientDealsSla,
  PoRepClientParameters,
  PoRepClientSlaHistoryEntry,
  PoRepDealsList,
  PoRepDealsListParameters,
  PoRepDealsPaymentsHistoryEntry,
  PoRepDealsPaymentsHistoryParameters,
  PoRepDealsValueHistoryEntry,
  PoRepDealsValueHistoryParameters,
  PoRepOnboardedDataHistoryEntry,
  PoRepOnboardedDataHistoryParameters,
  PoRepProviderComplianceStatistics,
  PoRepSLIComplianceHistoryEntry,
  PoRepSLIComplianceHistoryParameters,
} from 'src/service/po-rep/types.po-rep';
import { ControllerBase } from '../base/controller-base';
import {
  PoRepClientHistoryParameters,
  PoRepProviderResourceParameters,
} from './types.po-rep';

@Controller('po-rep')
@CacheTTL(1000 * 60 * 30) // 30 minutes
export class PoRepController extends ControllerBase {
  constructor(
    @Inject(CACHE_MANAGER) private _cacheManager: Cache,
    private readonly poRepService: PoRepService,
  ) {
    super();
  }

  @Get('/deals')
  @UseInterceptors(ClassSerializerInterceptor)
  @ApiOkResponse({
    type: PoRepDealsList,
  })
  public getDeals(
    @Query() query: PoRepDealsListParameters,
  ): Promise<PoRepDealsList> {
    return this.poRepService.getDeals(query);
  }

  @Get('/onboarded-data-history')
  @ApiOperation({
    summary: 'Get the history of onboarded data for PoRep deals',
  })
  @ApiOkResponse({
    type: [PoRepOnboardedDataHistoryEntry],
  })
  public async getOnboardedDataHistory(
    @Query() query: PoRepOnboardedDataHistoryParameters,
  ): Promise<PoRepOnboardedDataHistoryEntry[]> {
    return this.poRepService.getOnboardedDataHistory(query);
  }

  @Get('/deals-value-history')
  @ApiOperation({
    summary: 'Get the history of PoRep deals value',
  })
  @ApiOkResponse({
    type: [PoRepDealsValueHistoryEntry],
  })
  public async getDealsValueHistory(
    @Query() query: PoRepDealsValueHistoryParameters,
  ): Promise<PoRepDealsValueHistoryEntry[]> {
    return this.poRepService.getDealsValueHistory(query);
  }

  @Get('/payments-history')
  @ApiOperation({
    summary:
      'Get the history of USD amounts paid to providers for deal settlements',
  })
  @ApiOkResponse({
    type: [PoRepDealsPaymentsHistoryEntry],
  })
  public async getPaymentsHistory(
    @Query()
    query: PoRepDealsPaymentsHistoryParameters,
  ): Promise<PoRepDealsPaymentsHistoryEntry[]> {
    return this.poRepService.getDealsPaymentsSummaryHistory(query);
  }

  @Get('/sli-compliance-history')
  @ApiOperation({
    summary:
      'Get the history of deals SLI compliance, optionally filtered by Provider ID or Deal ID',
  })
  @ApiOkResponse({
    type: [PoRepSLIComplianceHistoryEntry],
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  public async getSLIComplianceHistory(
    @Query() query: PoRepSLIComplianceHistoryParameters,
  ): Promise<PoRepSLIComplianceHistoryEntry[]> {
    return this.poRepService.getSLIComplianceHistory(query);
  }

  @Get('/providers/:providerId/compliance-stats')
  @ApiOperation({
    summary: 'Get po-rep compliance statistics for given provider id.',
  })
  @ApiOkResponse({
    description: 'Po-rep provider compliance statistics',
    type: PoRepProviderComplianceStatistics,
  })
  @ApiBadRequestResponse({
    description: 'Error response when invalid provider id is given.',
  })
  @ApiNotFoundResponse({
    description: 'Error response when provider with given id does not exist.',
  })
  public async getProviderComplianceStatistics(
    @Param() parameters: PoRepProviderResourceParameters,
  ): Promise<PoRepProviderComplianceStatistics> {
    const stats = await this.poRepService.getProviderComplianceStatistics(
      parameters.providerId,
    );

    if (!stats) {
      throw new NotFoundException(
        `Po-rep provider with ID "${parameters.providerId}" does not exist.`,
      );
    }

    return stats;
  }

  @Get('/clients/:clientAddress')
  @UseInterceptors(ClassSerializerInterceptor)
  @ApiOperation({
    summary: 'Get aggregates of a single PoRep market client (payer wallet)',
  })
  @ApiOkResponse({
    type: PoRepClient,
  })
  @ApiBadRequestResponse({
    description: 'Invalid client address',
  })
  @ApiNotFoundResponse({
    description: 'Client has no PoRep market deals',
  })
  public async getClient(
    @Param() { clientAddress }: PoRepClientParameters,
  ): Promise<PoRepClient> {
    const client = await this.poRepService.getClient(clientAddress);

    if (!client) {
      throw new NotFoundException(
        `PoRep client with address "${clientAddress}" does not exist`,
      );
    }

    return client;
  }

  @Get('/clients/:clientAddress/deals-history')
  @ApiOperation({
    summary:
      'Get the history of deals created by PoRep market client, starting from the period start',
  })
  @ApiOkResponse({
    type: [PoRepClientDealsHistoryEntry],
  })
  @ApiBadRequestResponse({
    description: 'Invalid client address or query parameters',
  })
  public getClientDealsHistory(
    @Param() { clientAddress }: PoRepClientParameters,
    @Query()
    { period = '30d', windowSize = 'day' }: PoRepClientHistoryParameters,
  ): Promise<PoRepClientDealsHistoryEntry[]> {
    return this.poRepService.getClientDealsHistory(
      clientAddress,
      this.getDashboardPeriods(period).current.periodStart,
      windowSize,
    );
  }

  @Get('/clients/:clientAddress/sla-history')
  @ApiOperation({
    summary:
      'Get the history of PoRep market client deals average SLA and share of deals below the SLA target, starting from the period start',
  })
  @ApiOkResponse({
    type: [PoRepClientSlaHistoryEntry],
  })
  @ApiBadRequestResponse({
    description: 'Invalid client address or query parameters',
  })
  public getClientSlaHistory(
    @Param() { clientAddress }: PoRepClientParameters,
    @Query()
    { period = '30d', windowSize = 'day' }: PoRepClientHistoryParameters,
  ): Promise<PoRepClientSlaHistoryEntry[]> {
    return this.poRepService.getClientSlaHistory(
      clientAddress,
      this.getDashboardPeriods(period).current.periodStart,
      windowSize,
    );
  }

  @Get('/clients/:clientAddress/deals-sla')
  @ApiOperation({
    summary:
      'Get PoRep market client deals with their average SLA in the last 30 days',
  })
  @ApiOkResponse({
    type: PoRepClientDealsSla,
  })
  @ApiBadRequestResponse({
    description: 'Invalid client address',
  })
  public getClientDealsSla(
    @Param() { clientAddress }: PoRepClientParameters,
  ): Promise<PoRepClientDealsSla> {
    return this.poRepService.getClientDealsSla(clientAddress);
  }
}
