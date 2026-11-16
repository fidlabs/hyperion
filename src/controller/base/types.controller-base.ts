import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class PaginationInfoRequest {
  @ApiPropertyOptional({
    description: 'Number of items per page; default is no pagination',
    minimum: 1,
    type: Number,
  })
  limit?: string;

  @ApiPropertyOptional({
    description: 'Page number, starts from 1; default is no pagination',
    minimum: 1,
    type: Number,
  })
  page?: string;
}

export class PaginationInfo {
  @ApiPropertyOptional({
    description: 'Number of items per page; undefined if no pagination',
  })
  limit?: number;

  @ApiPropertyOptional({
    description: 'Page number, starts from 1; undefined if no pagination',
  })
  page?: number;
}

class _PaginationInfoResponse extends PaginationInfo {
  @ApiPropertyOptional({
    description: 'Total number of pages; undefined if no pagination or unknown',
  })
  pages?: number;

  @ApiPropertyOptional({
    description: 'Total number of items; undefined if no pagination or unknown',
  })
  total?: number;
}

export class PaginationInfoResponse {
  @ApiPropertyOptional({
    description: 'Pagination information',
  })
  pagination?: _PaginationInfoResponse;
}

export class SortingInfoRequest {
  @ApiPropertyOptional({
    description: 'Sorting field; default is no sorting',
  })
  sort?: string;

  @ApiPropertyOptional({
    description: 'Sorting order; default is ascending',
    enum: ['asc', 'desc'],
  })
  order?: 'asc' | 'desc';
}

// Dashboards
export const dashboardPeriods = ['30d', '90d', '1y', 'all'] as const;

export type DashboardPeriod = (typeof dashboardPeriods)[number];

export const dashboardServices = ['all', 'fcss', 'fwss'] as const;

export type DashboardService = (typeof dashboardServices)[number];

export class DashboardStatisticsRequest {
  @ApiPropertyOptional({
    description: `Period of the statistics, "30d" by default. Values of the
      previous period of the same length are returned for comparison, except
      for "all".`,
    enum: dashboardPeriods,
    enumName: 'DashboardPeriod',
    default: '30d',
  })
  @IsOptional()
  @IsIn(dashboardPeriods)
  period?: DashboardPeriod;

  @ApiPropertyOptional({
    description: 'Service of the statistics, "all" by default',
    enum: dashboardServices,
    enumName: 'DashboardService',
    default: 'all',
  })
  @IsOptional()
  @IsIn(dashboardServices)
  service?: DashboardService;
}

export class DashboardServiceValue {
  @ApiProperty({
    description: `Value for all requested services. Services that are not
      implemented yet are not included.`,
    type: Number,
    nullable: true,
  })
  total: number | null;

  @ApiProperty({
    description: 'Value for FCSS, null if not requested or unavailable',
    type: Number,
    nullable: true,
  })
  fcss: number | null;

  @ApiProperty({
    description:
      'Value for FWSS, null if not requested, unavailable or not implemented yet',
    type: Number,
    nullable: true,
  })
  fwss: number | null;
}
