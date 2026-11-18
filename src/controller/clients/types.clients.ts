import { ApiProperty, IntersectionType } from '@nestjs/swagger';
import { PoRepHistoryParameters } from 'src/service/po-rep/types.po-rep';
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
