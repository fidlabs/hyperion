import { ApiProperty } from '@nestjs/swagger';

export enum StorageProviderIpniReportingStatus {
  MISREPORTING = 'MISREPORTING',
  NOT_REPORTING = 'NOT_REPORTING',
  OK = 'OK',
}

export class AggregatedProvidersIPNIReportingStatusWeek {
  @ApiProperty({
    description: 'ISO format',
    type: String,
    format: 'date-time',
    example: '2024-04-22T00:00:00.000Z',
  })
  week: Date;

  @ApiProperty({
    description: 'Number of storage providers misreporting the IPNI data',
  })
  misreporting: number;

  @ApiProperty({
    description: 'Number of storage providers reporting no IPNI data',
  })
  notReporting: number;

  @ApiProperty({
    description:
      'Number of storage providers reporting the IPNI data correctly',
  })
  ok: number;

  @ApiProperty({
    description: 'Total number of storage providers',
  })
  total: number;
}

export class AggregatedProvidersIPNIReportingStatusWeekly {
  @ApiProperty({
    description: 'IPNI Reporting data week over week',
    isArray: true,
    type: AggregatedProvidersIPNIReportingStatusWeek,
  })
  results: AggregatedProvidersIPNIReportingStatusWeek[];
}

export class AggregatedProvidersIPNIReportingStatus {
  @ApiProperty({
    description: 'Number of storage providers misreporting the IPNI data',
  })
  misreporting: number;

  @ApiProperty({
    description: 'Number of storage providers reporting no IPNI data',
  })
  notReporting: number;

  @ApiProperty({
    description:
      'Number of storage providers reporting the IPNI data correctly',
  })
  ok: number;

  @ApiProperty({
    description: 'Total number of storage providers',
  })
  total: number;
}

export class ProviderIPNIReportingStatus {
  status: StorageProviderIpniReportingStatus;
  actualClaimsCount: number;
  ipniReportedClaimsCount: number | null;
}
