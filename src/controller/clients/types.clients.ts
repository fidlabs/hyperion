import { ApiProperty, IntersectionType, PickType } from '@nestjs/swagger';
import {
  PaginationMetadata,
  PaginationParameters,
  PoRepClientWalletStatus,
  PoRepHistoryParameters,
} from 'src/service/po-rep/types.po-rep';
import {
  DashboardPeriod,
  dashboardPeriods,
  DashboardService,
  dashboardServices,
  DashboardServiceValue,
  DashboardStatisticsRequest,
} from '../base/types.controller-base';

export class ClientsReturningHistoryEntry {
  @ApiProperty({
    description: 'Month start ISO date (UTC)',
  })
  date: string;

  @ApiProperty({
    description: `Count of clients that had a deal before the month and created
      a new deal in the month`,
  })
  returningClientsCount: DashboardServiceValue;

  @ApiProperty({
    description: `Count of returning clients that onboarded a new dataset in the
      month. Dataset is a unique pair of client and deal manifest hash.`,
  })
  onboardedNewDatasetsClientsCount: DashboardServiceValue;

  @ApiProperty({
    description: `Count of returning clients that only extended deals in the
      month, i.e. created deals for datasets they already had`,
  })
  extendedDealsClientsCount: DashboardServiceValue;
}

export class ClientsHistoryRequest extends IntersectionType(
  DashboardStatisticsRequest,
  PoRepHistoryParameters,
) {}

export class ClientsHistoryEntry {
  @ApiProperty({
    description: 'Window start ISO date (UTC)',
  })
  date: string;

  @ApiProperty({
    description: `Count of clients that made their first deal in the window.
      Client is a single payer wallet.`,
  })
  newClientsCount: DashboardServiceValue;

  @ApiProperty({
    description: 'Count of clients with at least one deal up to the window end',
  })
  totalClientsCount: DashboardServiceValue;

  @ApiProperty({
    description: `Average count of datasets per client up to the window end.
      Dataset is a unique pair of client and deal manifest hash, deals in any
      state are counted. Null when there are no clients yet.`,
  })
  averageDatasetsPerClient: DashboardServiceValue;
}

export class ClientsRevenueConcentrationHistoryEntry {
  @ApiProperty({
    description: 'Window start ISO date (UTC)',
  })
  date: string;

  @ApiProperty({
    description: `Share of revenue paid by the 10 largest clients, out of all
      revenue paid up to the window end. Revenue is the amount settled on
      Filecoin Pay rails of client deals. Null when there is no revenue yet.`,
  })
  topClientsRevenueShare: DashboardServiceValue;
}

export class ClientsListRequest extends IntersectionType(
  PickType(DashboardStatisticsRequest, ['service']),
  PaginationParameters,
) {}

export class ClientsListEntry {
  @ApiProperty({
    description: 'Client (payer wallet) EVM address',
  })
  clientAddress: string;

  @ApiProperty({
    description: `Count of client datasets. Dataset is a unique pair of client
      and deal manifest hash, deals in any state are counted.`,
  })
  datasetsCount: DashboardServiceValue;

  @ApiProperty({
    description: `Status of client Filecoin Pay account. Not set up when it has
      no funds and no lockup rate, empty when it has no available funds, low
      balance when available funds cover lockups for less than 30 days.`,
    enum: ['funded', 'low_balance', 'empty', 'not_set_up'],
  })
  walletStatus: PoRepClientWalletStatus;
}

export class ClientsList {
  @ApiProperty({
    description: 'Clients sorted by datasets count, descending',
    type: [ClientsListEntry],
  })
  data: ClientsListEntry[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetadata,
  })
  pagination: PaginationMetadata;
}

export class ClientsPeriodStatistics {
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
    description: `Count of clients with at least one deal up to period end.
      Client is a single payer wallet.`,
  })
  totalClientsCount: DashboardServiceValue;

  @ApiProperty({
    description: `Average count of datasets per client up to period end. Dataset
      is a unique pair of client and deal manifest hash. Null when there are no
      clients yet.`,
  })
  averageDatasetsPerClient: DashboardServiceValue;

  @ApiProperty({
    description: `Count of clients that had a deal before the period and created
      a new deal in the period, either for a new dataset or extending a dataset
      they already had. For "all" period, count of clients that created more
      than one deal.`,
  })
  returningClientsCount: DashboardServiceValue;

  @ApiProperty({
    description: `Count of clients with a positive Filecoin Pay account balance
      at period end`,
  })
  fundedWalletsCount: DashboardServiceValue;

  @ApiProperty({
    description: `Share of clients with a positive Filecoin Pay account balance
      at period end. Null when there are no clients yet.`,
  })
  fundedWalletsPercentage: DashboardServiceValue;
}

export class ClientsStatistics {
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
  current: ClientsPeriodStatistics;

  @ApiProperty({
    description:
      'Statistics for the previous period of the same length, null for "all" period',
    type: ClientsPeriodStatistics,
    nullable: true,
  })
  previous: ClientsPeriodStatistics | null;
}
