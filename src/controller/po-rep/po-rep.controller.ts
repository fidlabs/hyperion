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
  PoRepClientParameters,
  PoRepClientsList,
  PoRepClientsListParameters,
  PoRepDealsList,
  PoRepDealsListParameters,
  PoRepDealsPaymentsHistoryEntry,
  PoRepDealsPaymentsHistoryParameters,
  PoRepDealsValueHistoryEntry,
  PoRepDealsValueHistoryParameters,
  PoRepOnboardedDataHistoryEntry,
  PoRepOnboardedDataHistoryParameters,
  PoRepOverview,
  PoRepOverviewParameters,
  PoRepProvider,
  PoRepProviderParameters,
  PoRepProvidersList,
  PoRepProvidersListParameters,
} from 'src/service/po-rep/types.po-rep';
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

  @Get('/clients')
  @UseInterceptors(ClassSerializerInterceptor)
  @ApiOperation({
    summary:
      'Get list of PoRep market clients (payer wallets) with their aggregates',
  })
  @ApiOkResponse({
    type: PoRepClientsList,
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  public getClients(
    @Query(new ValidationPipe({ transform: true }))
    query: PoRepClientsListParameters,
  ): Promise<PoRepClientsList> {
    return this.poRepService.getClients(query);
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
    @Param(new ValidationPipe()) { clientAddress }: PoRepClientParameters,
  ): Promise<PoRepClient> {
    const client = await this.poRepService.getClient(clientAddress);

    if (!client) {
      throw new NotFoundException(
        `PoRep client with address "${clientAddress}" does not exist`,
      );
    }

    return client;
  }

  @Get('/overview')
  @UseInterceptors(ClassSerializerInterceptor)
  @ApiOperation({
    summary:
      'Get Peer-to-Pool overview statistics for a period, with values of the previous period for comparison',
  })
  @ApiOkResponse({
    type: PoRepOverview,
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  public getOverview(
    @Query(new ValidationPipe()) query: PoRepOverviewParameters,
  ): Promise<PoRepOverview> {
    return this.poRepService.getOverview(query);
  }

  @Get('/providers')
  @UseInterceptors(ClassSerializerInterceptor)
  @ApiOperation({
    summary:
      'Get list of storage providers registered in SP Registry with their aggregates',
  })
  @ApiOkResponse({
    type: PoRepProvidersList,
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  public getProviders(
    @Query(new ValidationPipe({ transform: true }))
    query: PoRepProvidersListParameters,
  ): Promise<PoRepProvidersList> {
    return this.poRepService.getProvidersList(query);
  }

  @Get('/providers/:providerId')
  @UseInterceptors(ClassSerializerInterceptor)
  @ApiOperation({
    summary: 'Get aggregates of a single storage provider',
  })
  @ApiOkResponse({
    type: PoRepProvider,
  })
  @ApiBadRequestResponse({
    description: 'Invalid provider id',
  })
  @ApiNotFoundResponse({
    description: 'Provider is not registered in SP Registry',
  })
  public async getProvider(
    @Param(new ValidationPipe()) { providerId }: PoRepProviderParameters,
  ): Promise<PoRepProvider> {
    const provider = await this.poRepService.getProvider(providerId);

    if (!provider) {
      throw new NotFoundException(
        `PoRep provider with id "${providerId}" does not exist`,
      );
    }

    return provider;
  }
}
