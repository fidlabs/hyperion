import { ApiProperty, IntersectionType, PickType } from '@nestjs/swagger';
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

export class StorageProvidersEarningsAgainstSlaRequest extends PickType(
  DashboardStatisticsRequest,
  ['service'],
) {}

export class StorageProviderEarningsAgainstSla {
  @ApiProperty({
    description: 'Provider ID',
  })
  providerId: string;

  @ApiProperty({
    description: 'Service the values are for',
    enum: ['fcss', 'fwss'],
  })
  service: Exclude<DashboardService, 'all'>;

  @ApiProperty({
    description: 'Net amount settled to the provider in the period, in USD',
  })
  earningsUSD: number;

  @ApiProperty({
    description: `Average SLA of provider deals active in the period, eg.
      average share of URL Finder measurements in which all SLIs required by
      the deal were met. Null when none of the deals was measured in the
      period.`,
    type: Number,
    nullable: true,
  })
  averageSla: number | null;
}

export class StorageProvidersEarningsAgainstSla {
  @ApiProperty({
    description: 'ISO Datetime of the period start',
  })
  periodStart: Date;

  @ApiProperty({
    description: 'ISO Datetime of the period end',
  })
  periodEnd: Date;

  @ApiProperty({
    description: 'SLA target that providers SLA is compared against',
  })
  slaTarget: DashboardServiceValue;

  @ApiProperty({
    description: `Providers with earnings or deals active in the period, one
      entry per provider and service`,
    type: StorageProviderEarningsAgainstSla,
    isArray: true,
  })
  providers: StorageProviderEarningsAgainstSla[];
}

export class StorageProvidersSlaHistoryEntry {
  @ApiProperty({
    description: 'Window start ISO date (UTC)',
  })
  date: string;

  @ApiProperty({
    description: `Average SLA of deals active in the window, eg. average share
      of URL Finder measurements in which all SLIs required by the deal were
      met. Null when none of the deals was measured in the window.`,
  })
  averageSla: DashboardServiceValue;

  @ApiProperty({
    description: 'SLA target that providers SLA is compared against',
  })
  slaTarget: DashboardServiceValue;

  @ApiProperty({
    description: `Count of providers with SLA below the target in the window.
      Provider SLA is the average SLA of its deals active in the window.
      Providers without measurements in the window are not included.`,
  })
  providersBelowTargetCount: DashboardServiceValue;

  @ApiProperty({
    description: `Percentage of providers measured in the window with SLA below
      the target. Null when none of the providers was measured in the window.`,
  })
  providersBelowTargetPercentage: DashboardServiceValue;
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
