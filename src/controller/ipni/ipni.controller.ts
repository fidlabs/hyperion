import { Cache, CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ControllerBase } from '../base/controller-base';
import { PrismaService } from 'src/db/prisma.service';
import { getIpniReportingWeekly } from '../../generated/prisma/sql';
import { AggregatedProvidersIPNIReportingStatusWeekly } from './types.ipni';

@Controller('ipni')
@CacheTTL(1000 * 60 * 60) // 1 hour
export class IPNIController extends ControllerBase {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly prismaService: PrismaService,
  ) {
    super();
  }

  @Get('/aggregated-ipni-status-weekly')
  @CacheTTL(1000 * 60 * 60) // 1 hour
  @ApiOperation({
    summary: 'Get aggregated storage providers IPNI reporting status over time',
  })
  @ApiOkResponse({
    description: 'Aggregated storage providers IPNI reporting status over time',
    type: AggregatedProvidersIPNIReportingStatusWeekly,
  })
  public async getAggregatedProvidersIPNIReportingStatusWeekly(): Promise<AggregatedProvidersIPNIReportingStatusWeekly> {
    const result = await this.prismaService.$queryRawTyped(
      getIpniReportingWeekly(),
    );

    return {
      results: result.map((r) => ({
        week: r.week,
        total: r.total,
        misreporting: r.misreporting,
        notReporting: r.not_reporting,
        ok: r.ok,
      })),
    };
  }
}
