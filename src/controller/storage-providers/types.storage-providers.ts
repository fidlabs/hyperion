import { ApiProperty } from '@nestjs/swagger';
import {
  DashboardPeriod,
  dashboardPeriods,
  DashboardService,
  dashboardServices,
  DashboardServiceValue,
} from '../base/types.controller-base';

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
    description: `Average SLA of providers, eg. percentage of the contract met.
      Null until SLA data is available.`,
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
