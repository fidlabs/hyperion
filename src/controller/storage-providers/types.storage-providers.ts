import { ApiProperty, IntersectionType } from '@nestjs/swagger';
import { PoRepHistoryParameters } from 'src/service/po-rep/types.po-rep';
import {
  DashboardPeriod,
  dashboardPeriods,
  DashboardService,
  dashboardServices,
  DashboardServiceValue,
  DashboardStatisticsRequest,
} from '../base/types.controller-base';

export class StorageProvidersHistoryRequest extends IntersectionType(
  DashboardStatisticsRequest,
  PoRepHistoryParameters,
) {}

export class StorageProvidersHistoryEntry {
  @ApiProperty({
    description: 'Window start ISO date (UTC)',
  })
  date: string;

  @ApiProperty({
    description: 'Count of providers registered in SP Registry in the window',
  })
  newProvidersCount: DashboardServiceValue;

  @ApiProperty({
    description:
      'Count of providers registered in SP Registry up to the window end',
  })
  totalProvidersCount: DashboardServiceValue;

  @ApiProperty({
    description: `Count of providers with at least one deal active in the
      window. Deal is active from reaching ACTIVE state until reaching
      FINALIZED, EXPIRED or EARLY_TERMINATED state.`,
  })
  activeProvidersCount: DashboardServiceValue;
}

export class StorageProvidersPeriodStatistics {
  @ApiProperty({
    description: 'ISO Datetime of the period start, null for "all" period',
    type: Date,
    nullable: true,
  })
  periodStart: Date | null;

  @ApiProperty({
    description: 'ISO Datetime of the period end',
  })
  periodEnd: Date;

  @ApiProperty({
    description:
      'Count of providers registered in SP Registry up to period end',
  })
  totalProvidersCount: DashboardServiceValue;

  @ApiProperty({
    description: `Count of providers with at least one active deal at period
      end. Deal is active when it reached ACTIVE state and did not reach
      FINALIZED, EXPIRED or EARLY_TERMINATED state.`,
  })
  activeProvidersCount: DashboardServiceValue;

  @ApiProperty({
    description: 'Net amount settled to providers in the period, in USD',
  })
  earningsUSD: DashboardServiceValue;

  @ApiProperty({
    description: `Average SLA of deals active in the period, eg. average share
      of URL Finder measurements in which all SLIs required by the deal were
      met. Null when none of the deals was measured in the period.`,
  })
  averageSla: DashboardServiceValue;
}

export class StorageProvidersStatistics {
  @ApiProperty({
    description: 'Period of the statistics',
    enum: dashboardPeriods,
    enumName: 'DashboardPeriod',
  })
  period: DashboardPeriod;

  @ApiProperty({
    description: 'Service of the statistics',
    enum: dashboardServices,
    enumName: 'DashboardService',
  })
  service: DashboardService;

  @ApiProperty({
    description: 'Statistics for the requested period',
  })
  current: StorageProvidersPeriodStatistics;

  @ApiProperty({
    description:
      'Statistics for the previous period of the same length, null for "all" period',
    type: StorageProvidersPeriodStatistics,
    nullable: true,
  })
  previous: StorageProvidersPeriodStatistics | null;
}
