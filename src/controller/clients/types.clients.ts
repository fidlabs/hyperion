import { ApiProperty, IntersectionType, PickType } from '@nestjs/swagger';
import {
  PaginationMetadata,
  PaginationParameters,
  PoRepClientWalletStatus,
  PoRepHistoryParameters,
} from 'src/service/po-rep/types.po-rep';
import {
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
