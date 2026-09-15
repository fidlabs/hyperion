import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBooleanString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';
import { PoRepDealState } from '../../generated/prisma/client';
import { F0Id } from 'src/utils/utils';
import { F0IdInput, IsCID, IsF0IdInput } from 'src/utils/validators';

export const poRepHistoryWindowSize = ['day', 'week', 'month'] as const;

function transformOptionalInt({
  value,
}: TransformFnParams): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  // eslint-disable-next-line no-restricted-globals
  return parseInt(String(value), 10);
}

class PaginationParameters {
  @ApiPropertyOptional({
    description: 'Number of items per page; default is no pagination',
    type: 'number',
    required: false,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(transformOptionalInt)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Page number, starts from 1; default is no pagination',
    type: 'number',
    required: false,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(transformOptionalInt)
  page?: number;
}

class PaginationMetadata {
  @ApiProperty({
    description: 'Current pagination page.',
    type: 'integer',
    minimum: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Total number of pages.',
    type: 'integer',
    minimum: 0,
  })
  pagesCount: number;

  @ApiProperty({
    description: 'Total count of matching results.',
    type: 'integer',
    minimum: 0,
  })
  totalCount: number;
}

export class PoRepHistoryParameters {
  @ApiProperty({
    description: 'Window size of returned data, eg. "week"',
    enum: poRepHistoryWindowSize,
    enumName: 'PoRepHistoryWindowSize',
    required: false,
    default: 'day',
  })
  @IsOptional()
  @IsIn(poRepHistoryWindowSize)
  windowSize?: (typeof poRepHistoryWindowSize)[number];
}

// Deals list
export enum DealRailState {
  FINALIZED = 'finalized',
  TERMINATED = 'terminated',
  ACTIVE = 'active',
  IDLE = 'idle',
}

const dealsAvailableSortingKeys = [
  'deal_id',
  'deal_size_bytes',
  'predicted_deal_revenue',
  'total_amount_settled',
  'total_settlements_count',
  'last_settlement_epoch',
  'deal_created_at_epoch',
] as const;

export class PoRepDealsListParameters extends PaginationParameters {
  @ApiPropertyOptional({
    description:
      'Optional filter by storage provider id, if provided then only deals of that provider will be returned',
    type: 'string',
    required: false,
  })
  @IsOptional()
  @IsF0IdInput()
  providerId?: F0IdInput;

  @ApiPropertyOptional({
    description:
      'Optional filter by deal rail state, if not provided all deals will be returned',
    enum: DealRailState,
    required: false,
  })
  @IsOptional()
  @IsEnum(DealRailState)
  railState?: DealRailState;

  @ApiPropertyOptional({
    description:
      'Optional filter by piece CID, if provided only deals including that piece will be returned.',
    required: false,
  })
  @IsOptional()
  @IsCID()
  pieceCid?: string;

  @ApiPropertyOptional({
    description: `Set to true to show active deals only. Deal is considered 
      active when it's in ${PoRepDealState.ACTIVE} state and it's payment
      rail is in ${DealRailState.ACTIVE} or ${DealRailState.TERMINATED} state.`,
    required: false,
  })
  @IsOptional()
  @IsBooleanString()
  activeOnly?: 'true' | 'false';

  @ApiPropertyOptional({
    description:
      'Optional sorting key, if not provided deals will be sorted by deal id ascending',
    enumName: 'DealsListSortingKey',
    enum: dealsAvailableSortingKeys,
    required: false,
  })
  @IsOptional()
  @IsIn(dealsAvailableSortingKeys)
  sort?: (typeof dealsAvailableSortingKeys)[number];

  @ApiPropertyOptional({
    description: 'Optional sorting direction, "asc" by default',
    enumName: 'DealsListSortingDirection',
    enum: ['asc', 'desc'],
    required: false,
    default: 'asc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class PoRepDeal {
  @ApiProperty({
    description: 'Unique identifier of a deal, an incrementing integer',
    type: 'string',
  })
  dealId: bigint;

  @ApiProperty({
    description: `Unique identificator of a storage provider, with whom the
      deal was made, presented in form of a f0 address.`,
    type: 'string',
  })
  @Transform(({ value }) => (value as F0Id).toString())
  providerId: F0Id;

  @ApiProperty({
    description: 'EVM address of the client who made the deal',
  })
  clientAddress: string;

  @ApiProperty({
    description: `State of a deal, can be one of:\n
      - ${PoRepDealState.PROPOSED} - deal was proposed but no yet accepted by
      any storage provider\n
      - ${PoRepDealState.ACCEPTED} - deal was accepted but client needs to 
      prepare deal data\n
      - ${PoRepDealState.ACTIVE} - deal is active or storage provider is
      onboarding deal data\n
      - ${PoRepDealState.EARLY_TERMINATED} - deal was terminated\n
      - ${PoRepDealState.REJECTED} - deal was rejected
    `,
    enum: PoRepDealState,
    enumName: 'PoRepDealState',
  })
  dealState: PoRepDealState;

  @ApiProperty({
    description: `Unique identificator of a payment rail for a deal. Null
      value means that payment rail was not yet created for that deal.`,
    type: 'string',
    nullable: true,
  })
  railId: bigint | null;

  @ApiProperty({
    description: `State of the payment rail for a deal, can be one of:\n
      - ${DealRailState.IDLE}: rail was set up but is not yet active\n
      - ${DealRailState.ACTIVE}: payment rate was set up and rail is active\n
      - ${DealRailState.TERMINATED}: rail is being shut down\n
      - ${DealRailState.FINALIZED}: rail reached it's end and all settlements
      were made\n
      - null - rail was not yet created for that deal`,
    nullable: true,
  })
  railState: DealRailState | null;

  @ApiProperty({
    description: `Deal is considered active when it's in
      ${PoRepDealState.ACTIVE} state and it's payment rail is in
      ${DealRailState.ACTIVE} or ${DealRailState.TERMINATED} state.`,
  })
  active: boolean;

  @ApiProperty({
    description: `Address of ERC20 token used for deal payment rail. Zero
      address signify native token. Null value means no payment rail was set up 
      yet for that deal.`,
    nullable: true,
  })
  tokenAddress: string | null;

  @ApiProperty({
    description: `Symbol of ERC20 token used for deal payment rail. Null value 
      means no payment rail was set up yet for that deal.`,
    nullable: true,
  })
  tokenSymbol: string | null;

  @ApiProperty({
    description: `Number of decimal places of ERC20 token used for deal payment 
      rail. Null value means no payment rail was set up yet for that deal.`,
    nullable: true,
  })
  tokenDecimals: number | null;

  @ApiProperty({
    description: `Minimum retrievability percentage defined in deal requirements. 
      Represented as a floating point number between 0 and 1, eg. value of 0.1
      means that minumum retrievability required by deal is 10%. Null values 
      signify deals that do not have specific retrievability requirements.`,
    minimum: 0,
    maximum: 1,
    nullable: true,
  })
  minRequiredRetrievability: number | null;

  @ApiProperty({
    description: `Minimum bandwidth defined in deal requirements. Represented
      as an integer in units of Megabits per second. Null values signify deals 
      that do not have specific bandwidth requirements.`,
    minimum: 1,
    nullable: true,
  })
  minRequiredBandwidthMbps: number | null;

  @ApiProperty({
    description: `Maximum latency defined in deal requirements. Represented
      as an integer in units of milliseconds. Null values signify deals that do 
      not have specific latency requirements.`,
    minimum: 1,
    nullable: true,
  })
  maxRequiredLatencyMs: number | null;

  @ApiProperty({
    description: `Minimum percentage of positive IPNI advertisments defined 
      in deal requirements. Represented as a floating point number between 0 
      and 1, eg. value of 0.1 means that minumum indexing required by deal is 
      10%. Null values signify deals that do not have specific indexing 
      requirements.`,
    minimum: 0,
    maximum: 1,
    nullable: true,
  })
  minRequiredIndexing: number | null;

  @ApiProperty({
    description: 'Total deal size in bytes.',
    type: 'string',
  })
  dealSizeBytes: bigint;

  @ApiProperty({
    description: 'Flag telling if deal data was onboarded by storage provider.',
  })
  isDataOnboarded: boolean;

  @ApiProperty({
    description: `Price of deal, per sector (32GiB), per month in Wei 
      (smallest non-dividable unit of the underlying token).`,
    type: 'string',
  })
  pricePerSectorPerMonthWei: bigint;

  @ApiProperty({
    description: `Predicted revenue from a deal. Result of dividing total deal
      size by 32GiB (rounded up) and multiplying by deal lenght in full months.
      Presented in Wei (smallest non-dividable unit of the underlying token). 
      Includes network fees.`,
    type: 'string',
  })
  predictedDealRevenueWei: bigint;

  @ApiProperty({
    description: `Total settled amount on the payment rail for a deal. 
      Presented in Wei (smallest non-dividable unit of the underlying token). 
      Includes network fees. Null if no payment rail for deal exists.`,
    type: 'string',
    nullable: true,
  })
  totalSettledValueWei: bigint | null;

  @ApiProperty({
    description: `Total number of settlments done on the payment rail for a 
      deal. Usually one settlement is done per month. Null if no payment rail 
      for deal exists.`,
    nullable: true,
  })
  settlementsCount: number | null;

  @ApiProperty({
    description: `ISO Datetime of last settlement for a deal. Null if no 
      settlements were made.`,
    nullable: true,
  })
  @Transform(({ value }) => {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return null;
  })
  lastSettlementAt: Date | null;

  @ApiProperty({
    description: `Filecoin epoch of deal proposal creation`,
    nullable: true,
  })
  dealCreatedAtEpoch: bigint;

  @ApiProperty({
    description: `ISO Datetime of deal proposal creation`,
    nullable: true,
  })
  @Transform(({ value }) => {
    return (value as Date).toISOString();
  })
  dealCreatedAt: Date;

  constructor(poRepDeal: PoRepDeal) {
    Object.assign(this, poRepDeal);
  }
}

export class PoRepDealsList {
  @ApiProperty({
    description:
      'Paginated and sorted list of deals matching provided parameters.',
    type: [PoRepDeal],
  })
  data: PoRepDeal[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetadata,
  })
  pagination: PaginationMetadata;
}

// Onboarded data history
export class PoRepOnboardedDataHistoryEntry {
  @ApiProperty({
    description: 'Entry date',
  })
  date: string;

  @ApiProperty({
    description: 'Entry volume of onboarded data in bytes',
  })
  volume: string;

  @ApiProperty({
    description:
      'Cumulative amount of onboarded data in bytes, up to the entry date',
  })
  cumulativeTotal: string;
}

// Deals value history
export class PoRepDealsValueHistoryEntry {
  @ApiProperty({
    description: 'Window start ISO date (UTC)',
  })
  date: string;

  @ApiProperty({
    description: 'Total value of deals accepted in entry window in USD',
  })
  volumeUSD: number;

  @ApiProperty({
    description:
      'Cumulative total value of accepted deals in USD, up to entry date',
  })
  cumulativeTotalUSD: number;
}

// Deals payments history
export class PoRepDealsPaymentsHistoryEntry {
  @ApiProperty({
    description: 'Window start ISO date (UTC)',
  })
  date: string;

  @ApiProperty({
    description: 'Daily volume of payments in USD',
  })
  volumeUSD: number;

  @ApiProperty({
    description:
      'Cumulative amount of payments in USD up to the given window end date',
  })
  cumulativeTotalUSD: number;
}

// Active clients history
export class PoRepActiveClientsHistoryParameters extends PoRepHistoryParameters {
  @ApiPropertyOptional({
    description: 'Provider ID to filter by, no filter by default',
    required: false,
    type: 'string',
  })
  @IsOptional()
  @IsF0IdInput()
  providerId?: F0IdInput;
}

export class PoRepActiveClientsHistoryEntry {
  @ApiProperty({
    description: 'Window start ISO date (UTC)',
  })
  date: string;

  @ApiProperty({
    description:
      'Count of active clients in a window. Client is considered active if they have at least one deal completed before or during the window, that was not terminated before window start.',
  })
  activeClientsCount: number;
}

export class PoRepOnboardedDataHistoryParameters extends PoRepHistoryParameters {
  @ApiPropertyOptional({
    description: `Optional filter by provider id`,
    required: false,
    type: 'string',
  })
  @IsF0IdInput()
  @IsOptional()
  providerId?: F0IdInput;
}

export class PoRepProviderStorageStatistics {
  @ApiProperty({
    description: 'Total count of deals made with provider',
  })
  totalDealsCount: number;

  @ApiProperty({
    description: `Number of deals that are in state
      "${PoRepDealState.ACTIVE}" and have active payment rail.`,
  })
  onboardedDealsCount: number;

  @ApiProperty({
    description: `Total space available in bytes, declared by storage provider.`,
  })
  totalAvailableBytes: bigint;

  @ApiProperty({
    description: `Space in bytes reserved for deals not yet accepted.`,
  })
  pendingBytes: bigint;

  @ApiProperty({
    description: `Space in bytes reserved for not yet commited `,
  })
  committedBytes: bigint;

  @ApiProperty({
    description: `Space in bytes in active deals (deals with
      "${PoRepDealState.ACTIVE}") state and with active payment rail)`,
  })
  onboardedBytes: bigint;
}

export class PoRepProviderEconomicsStatistics {
  @ApiProperty({
    description:
      'Total count of payment rails created for deals with provider.',
  })
  totalRailsCount: number;

  @ApiProperty({
    description: 'Total count of active payment rails.',
  })
  activeRailsCount: number;

  @ApiProperty({
    description: 'Total revenue earned and predicted in USD.',
  })
  totalRevenueUSD: number;

  @ApiProperty({
    description: 'Value locked in ongoing deals, in USD.',
  })
  predictedRevenueUSD: number;

  @ApiProperty({
    description: 'Total net amount settled for all deals in USD',
  })
  totalSettledUSD: number;

  @ApiProperty({
    description:
      'Date of last settlement on any deal. Null if no settlements were made.',
    nullable: true,
  })
  lastSettlementAt: Date | null;
}

export class PoRepDealsPaymentsHistoryParameters extends PoRepHistoryParameters {
  @ApiPropertyOptional({
    description: `Sum net amounts received by providers instead of total 
      settlement amounts including commision and network fees. Default is 
      "true".`,
    required: false,
    type: 'boolean',
  })
  @IsBooleanString()
  @IsOptional()
  netAmounts?: 'true' | 'false';

  @ApiPropertyOptional({
    description: `Optional filter by provider id`,
    required: false,
    type: 'string',
  })
  @IsF0IdInput()
  @IsOptional()
  providerId?: F0IdInput;
}

export class PoRepDealsValueHistoryParameters extends PoRepHistoryParameters {
  @ApiPropertyOptional({
    description: `Optional filter by provider id`,
    required: false,
    type: 'string',
  })
  @IsF0IdInput()
  @IsOptional()
  providerId?: F0IdInput;
}
