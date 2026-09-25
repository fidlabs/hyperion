import { Cache, CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  Inject,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from 'src/db/prisma.service';
import { PoRepService } from 'src/service/po-rep/po-rep.service';
import {
  PoRepDealsList,
  PoRepDealsListParameters,
  PoRepDealsPaymentsHistoryEntry,
  PoRepDealsPaymentsHistoryParameters,
  PoRepDealsValueHistoryEntry,
  PoRepDealsValueHistoryParameters,
  PoRepOnboardedDataHistoryEntry,
  PoRepOnboardedDataHistoryParameters,
} from 'src/service/po-rep/types.po-rep';
import { ControllerBase } from '../base/controller-base';

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
}
