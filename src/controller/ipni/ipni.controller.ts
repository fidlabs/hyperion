import { Cache, CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ControllerBase } from '../base/controller-base';
import { IpniReportingCheckerService } from 'src/service/ipni-reporting-checker/ipni-reporting-checker.service';
import { AggregatedProvidersIPNIReportingStatusWeekly } from 'src/service/ipni-reporting-checker/types.ipni-reporting-checker';

@Controller('ipni')
@CacheTTL(1000 * 60 * 60) // 1 hour
export class IPNIController extends ControllerBase {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly ipniReportingCheckerService: IpniReportingCheckerService,
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
    return await this.ipniReportingCheckerService.getAggregatedProvidersReportingStatusWeekly();
  }
}
