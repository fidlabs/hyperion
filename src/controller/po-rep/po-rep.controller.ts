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
import { PrismaService } from 'src/db/prisma.service';
import { PoRepDealState, Prisma } from 'src/generated/prisma/client';
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
  PoRepProviderEconomicsStatistics,
  PoRepProviderStorageStatistics,
} from 'src/service/po-rep/types.po-rep';
import { F0Id, stringToBool } from 'src/utils/utils';
import { ControllerBase } from '../base/controller-base';
import {
  GetPoRepProvidersResponse,
  PoRepProviderResourceParameters,
  PoRepProvidersListParameters,
} from './types.po-rep';

@Controller('po-rep')
@CacheTTL(1000 * 60 * 30) // 30 minutes
export class PoRepController extends ControllerBase {
  constructor(
    @Inject(CACHE_MANAGER) private _cacheManager: Cache,
    private readonly prismaService: PrismaService,
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
    @Query() query: PoRepClientsListParameters,
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

  @Get('/overview')
  @UseInterceptors(ClassSerializerInterceptor)
  @ApiOperation({
    summary:
      'Get PoRep market overview statistics for a period, with values of the previous period for comparison',
  })
  @ApiOkResponse({
    type: PoRepOverview,
  })
  @ApiBadRequestResponse({
    description: 'Query parameters validation error',
  })
  public getOverview(
    @Query() query: PoRepOverviewParameters,
  ): Promise<PoRepOverview> {
    return this.poRepService.getOverview(query);
  }

  @Get('/providers')
  @ApiOperation({
    summary: 'Get list of storage providers participating in PoRep market',
  })
  @ApiOkResponse({
    description: 'List of storage providers participating in PoRep market',
    type: GetPoRepProvidersResponse,
  })
  public async getParticipants(
    @Query() query: PoRepProvidersListParameters,
  ): Promise<GetPoRepProvidersResponse> {
    const { filter } = query;
    const paginationInfo = this.validatePaginationInfo(query);
    const showActive = stringToBool(query.showActive);

    const where = {
      AND: [
        filter ? { providerId: F0Id.from(filter).toBigInt() } : {},
        showActive !== null
          ? {
              [showActive ? 'AND' : 'OR']: [
                { paused: !showActive },
                { blocked: !showActive },
              ],
            }
          : {},
      ],
    } satisfies Prisma.po_rep_storage_providerWhereInput;

    const [providers, totalCount] = await this.prismaService.$transaction([
      this.prismaService.po_rep_storage_provider.findMany({
        ...this.validateQueryPagination(paginationInfo),
        include: {
          _count: {
            select: {
              deals: {
                where: {
                  state: {
                    in: [PoRepDealState.ACCEPTED, PoRepDealState.ACTIVE],
                  },
                },
              },
            },
          },
        },
        where: where,
        orderBy:
          showActive === null
            ? [
                { paused: 'asc' },
                { blocked: 'asc' },
                { registeredAtBlock: 'desc' },
              ]
            : [
                {
                  registeredAtBlock: 'desc',
                },
              ],
      }),
      this.prismaService.po_rep_storage_provider.count({ where: where }),
    ]);

    const data = providers.map((provider) => {
      return {
        providerId: 'f0' + provider.providerId.toString(),
        paused: provider.paused,
        blocked: provider.blocked,
        availableBytes: provider.availableBytes.toString(),
        committedBytes: provider.committedBytes.toString(),
        pendingBytes: provider.pendingBytes.toString(),
        activeDealsCount: provider._count.deals,
        registeredAtBlock: provider.registeredAtBlock.toString(),
      };
    });

    return this.withPaginationInfo(
      {
        data: data,
      },
      query,
      totalCount,
    );
  }

  @Get('/providers/:providerId/storage-stats')
  @ApiOperation({
    summary: 'Get po-rep storage statistics for given provider id.',
  })
  @ApiOkResponse({
    description: 'Po-rep provider storage statistics',
    type: PoRepProviderStorageStatistics,
  })
  @ApiBadRequestResponse({
    description: 'Error response when invalid provider id is given.',
  })
  @ApiNotFoundResponse({
    description: 'Error response when provider with given id does not exist.',
  })
  public async getProviderStorageStatistics(
    @Param() parameters: PoRepProviderResourceParameters,
  ): Promise<PoRepProviderStorageStatistics> {
    const stats = await this.poRepService.getProviderStorageStatistics(
      parameters.providerId,
    );

    if (!stats) {
      throw new NotFoundException(
        `Po-rep provider with ID "${parameters.providerId}" does not exist.`,
      );
    }

    return stats;
  }

  @Get('/providers/:providerId/economics-stats')
  @ApiOperation({
    summary: 'Get po-rep economics statistics for given provider id.',
  })
  @ApiOkResponse({
    description: 'Po-rep provider economics statistics',
    type: PoRepProviderEconomicsStatistics,
  })
  @ApiBadRequestResponse({
    description: 'Error response when invalid provider id is given.',
  })
  @ApiNotFoundResponse({
    description: 'Error response when provider with given id does not exist.',
  })
  public getProviderEconomicsStatistics(
    @Param() parameters: PoRepProviderResourceParameters,
  ): Promise<PoRepProviderEconomicsStatistics> {
    return this.poRepService.getProviderEconomicsStatistics(
      parameters.providerId,
    );
  }
}
