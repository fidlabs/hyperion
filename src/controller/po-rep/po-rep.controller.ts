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

import {
  GetPoRepClientResponse,
  GetClientDealsHistoryResponse,
  GetClientDealsSlaResponse,
  GetPoRepClientRequest,
  GetClientSlaHistoryResponse,
  GetPoRepDealsResponse,
  GetPoRepDealsRequest,
  GetPaymentsHistoryResponse,
  GetPaymentsHistoryRequest,
  GetDealsValueHistoryResponse,
  GetDealsValueHistoryRequest,
  GetOnboardedDataHistoryResponse,
  GetOnboardedDataHistoryRequest,
  GetProviderComplianceStatisticsResponse,
  GetProviderEconomicsStatisticsResponse,
  GetProviderStorageStatisticsResponse,
  GetSLIComplianceHistoryResponse,
  GetSLIComplianceHistoryRequest,
} from 'src/service/po-rep/types.po-rep';

import {
  PoRepClientHistoryRequest,
  GetProviderStatisticsRequest,
} from './types.po-rep';

import { Cache, CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import { PoRepService } from 'src/service/po-rep/po-rep.service';
import { ControllerBase } from '../base/controller-base';

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
    type: GetPoRepDealsResponse,
  })
  public getPoRepDeals(
    @Query() query: GetPoRepDealsRequest,
  ): Promise<GetPoRepDealsResponse> {
    return this.poRepService.getDeals(query);
  }

  @Get('/providers')
  @ApiOperation({
    summary: 'Get list of storage providers participating in PoRep market',
  })
  @ApiOkResponse({
    type: PoRepProvidersList,
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  public getProvidersList(
    @Query() query: PoRepProvidersListParameters,
  ): Promise<PoRepProvidersList> {
    return this.poRepService.getProvidersList(query);
  }

  @Get('/onboarded-data-history')
  @ApiOperation({
    summary: 'Get the history of onboarded data for PoRep deals',
  })
  @ApiOkResponse({
    type: [GetOnboardedDataHistoryResponse],
  })
  public async getOnboardedDataHistory(
    @Query() query: GetOnboardedDataHistoryRequest,
  ): Promise<GetOnboardedDataHistoryResponse[]> {
    return this.poRepService.getOnboardedDataHistory(query);
  }

  @Get('/deals-value-history')
  @ApiOperation({
    summary: 'Get the history of PoRep deals value',
  })
  @ApiOkResponse({
    type: [GetDealsValueHistoryResponse],
  })
  public async getDealsValueHistory(
    @Query() query: GetDealsValueHistoryRequest,
  ): Promise<GetDealsValueHistoryResponse[]> {
    return this.poRepService.getDealsValueHistory(query);
  }

  @Get('/payments-history')
  @ApiOperation({
    summary:
      'Get the history of USD amounts paid to providers for deal settlements',
  })
  @ApiOkResponse({
    type: [GetPaymentsHistoryResponse],
  })
  public async getPaymentsHistory(
    @Query() query: GetPaymentsHistoryRequest,
  ): Promise<GetPaymentsHistoryResponse[]> {
    return this.poRepService.getDealsPaymentsSummaryHistory(query);
  }

  @Get('/sli-compliance-history')
  @ApiOperation({
    summary:
      'Get the history of deals SLI compliance, optionally filtered by Provider ID or Deal ID',
  })
  @ApiOkResponse({
    type: [GetSLIComplianceHistoryResponse],
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  public async getSLIComplianceHistory(
    @Query() query: GetSLIComplianceHistoryRequest,
  ): Promise<GetSLIComplianceHistoryResponse[]> {
    return this.poRepService.getSLIComplianceHistory(query);
  }

  @Get('/providers/:providerId/compliance-stats')
  @ApiOperation({
    summary: 'Get PoRep compliance statistics for given provider id.',
  })
  @ApiOkResponse({
    description: 'PoRep provider compliance statistics',
    type: GetProviderComplianceStatisticsResponse,
  })
  @ApiBadRequestResponse({
    description: 'Error response when invalid provider id is given.',
  })
  @ApiNotFoundResponse({
    description: 'Error response when provider with given id does not exist.',
  })
  public async getProviderComplianceStatistics(
    @Param() query: GetProviderStatisticsRequest,
  ): Promise<GetProviderComplianceStatisticsResponse> {
    const stats = await this.poRepService.getProviderComplianceStatistics(
      query.providerId,
    );

    if (!stats) {
      throw new NotFoundException(
        `PoRep provider with ID "${query.providerId}" does not exist.`,
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
    type: GetPoRepClientResponse,
  })
  @ApiBadRequestResponse({
    description: 'Invalid client address',
  })
  @ApiNotFoundResponse({
    description: 'Client has no PoRep market deals',
  })
  public async getPoRepClient(
    @Param() query: GetPoRepClientRequest,
  ): Promise<GetPoRepClientResponse> {
    const client = await this.poRepService.getClient(query.clientAddress);

    if (!client) {
      throw new NotFoundException(
        `PoRep client with address "${query.clientAddress}" does not exist`,
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
    type: [GetClientDealsHistoryResponse],
  })
  @ApiBadRequestResponse({
    description: 'Invalid client address or query parameters',
  })
  @ApiNotFoundResponse({
    description: 'Client has no PoRep market deals',
  })
  public async getClientDealsHistory(
    @Param() query: GetPoRepClientRequest,
    @Query()
    { period = '30d', windowSize = 'day' }: PoRepClientHistoryRequest,
  ): Promise<GetClientDealsHistoryResponse[]> {
    const history = await this.poRepService.getClientDealsHistory(
      query.clientAddress,
      this.getStatisticsPeriods(period).current.start,
      windowSize,
    );

    if (!history) {
      throw new NotFoundException(
        `PoRep client with address "${query.clientAddress}" does not exist`,
      );
    }

    return history;
  }

  @Get('/clients/:clientAddress/sla-history')
  @ApiOperation({
    summary:
      'Get the history of PoRep market client deals average SLA and share of deals below the SLA target, ' +
      'starting from the period start',
  })
  @ApiOkResponse({
    type: [GetClientSlaHistoryResponse],
  })
  @ApiBadRequestResponse({
    description: 'Invalid client address or query parameters',
  })
  @ApiNotFoundResponse({
    description: 'Client has no PoRep market deals',
  })
  public async getClientSlaHistory(
    @Param() query: GetPoRepClientRequest,
    @Query()
    { period = '30d', windowSize = 'day' }: PoRepClientHistoryRequest,
  ): Promise<GetClientSlaHistoryResponse[]> {
    const history = await this.poRepService.getClientSlaHistory(
      query.clientAddress,
      this.getStatisticsPeriods(period).current.start,
      windowSize,
    );

    if (!history) {
      throw new NotFoundException(
        `PoRep client with address "${query.clientAddress}" does not exist`,
      );
    }

    return history;
  }

  @Get('/clients/:clientAddress/deals-sla')
  @ApiOperation({
    summary:
      'Get PoRep market client deals with their average SLA in the last 30 days',
  })
  @ApiOkResponse({
    type: GetClientDealsSlaResponse,
  })
  @ApiBadRequestResponse({
    description: 'Invalid client address',
  })
  @ApiNotFoundResponse({
    description: 'Client has no PoRep market deals',
  })
  public async getClientDealsSla(
    @Param() query: GetPoRepClientRequest,
  ): Promise<GetClientDealsSlaResponse> {
    const dealsSla = await this.poRepService.getClientDealsSla(
      query.clientAddress,
    );

    if (!dealsSla) {
      throw new NotFoundException(
        `PoRep client with address "${query.clientAddress}" does not exist`,
      );
    }

    return dealsSla;
  }

  @Get('/providers/:providerId/storage-stats')
  @ApiOperation({
    summary: 'Get PoRep storage statistics for given provider id.',
  })
  @ApiOkResponse({
    description: 'PoRep provider storage statistics',
    type: GetProviderStorageStatisticsResponse,
  })
  @ApiBadRequestResponse({
    description: 'Error response when invalid provider id is given.',
  })
  @ApiNotFoundResponse({
    description: 'Error response when provider with given id does not exist.',
  })
  public async getProviderStorageStatistics(
    @Param() query: GetProviderStatisticsRequest,
  ): Promise<GetProviderStorageStatisticsResponse> {
    const stats = await this.poRepService.getProviderStorageStatistics(
      query.providerId,
    );

    if (!stats) {
      throw new NotFoundException(
        `PoRep provider with ID "${query.providerId}" does not exist.`,
      );
    }

    return stats;
  }

  @Get('/providers/:providerId/economics-stats')
  @ApiOperation({
    summary: 'Get PoRep economics statistics for given provider id.',
  })
  @ApiOkResponse({
    description: 'PoRep provider economics statistics',
    type: GetProviderEconomicsStatisticsResponse,
  })
  @ApiBadRequestResponse({
    description: 'Error response when invalid provider id is given.',
  })
  @ApiNotFoundResponse({
    description: 'Error response when provider with given id does not exist.',
  })
  public async getProviderEconomicsStatistics(
    @Param() query: GetProviderStatisticsRequest,
  ): Promise<GetProviderEconomicsStatisticsResponse> {
    const stats = this.poRepService.getProviderEconomicsStatistics(
      query.providerId,
    );

    if (!stats) {
      throw new NotFoundException(
        `PoRep provider with ID "${query.providerId}" does not exist.`,
      );
    }

    return stats;
  }
}
