import { ApiProperty } from '@nestjs/swagger';
import { IsBooleanString, IsOptional } from 'class-validator';
import { F0IdInput, IsF0IdInput } from 'src/utils/validators';
import {
  PaginationInfoRequest,
  PaginationInfoResponse,
} from '../base/types.controller-base';

export class PoRepProviderInfo {
  @ApiProperty({
    description: 'Provider ID',
  })
  providerId: string;

  @ApiProperty({
    description: 'Flag telling if provider is paused',
  })
  paused: boolean;

  @ApiProperty({
    description: 'Flag telling if provider is blocked',
  })
  blocked: boolean;

  @ApiProperty({
    description: 'Total Available Space for this Provider',
  })
  availableBytes: string;

  @ApiProperty({
    description: 'Bytes committed to deals',
  })
  committedBytes: string;

  @ApiProperty({
    description: 'Bytes allocated to not yet accepted deals',
  })
  pendingBytes: string;

  @ApiProperty({
    description:
      'Total number of deals with that Provider with either "accepted" or "active" state',
  })
  activeDealsCount: number;

  @ApiProperty({
    description: 'Block at which Provider was registered',
  })
  registeredAtBlock: string;
}

export class PoRepProvidersListParameters extends PaginationInfoRequest {
  @ApiProperty({
    description: 'Filter by provider ID, no filter by default',
    required: false,
    type: 'string',
  })
  @IsOptional()
  @IsF0IdInput()
  filter?: F0IdInput;

  @ApiProperty({
    description:
      'Flag to filter by provider state. True for active only, false for inactive only, omit to include both',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBooleanString()
  showActive?: string;
}

export class GetPoRepProvidersResponse extends PaginationInfoResponse {
  @ApiProperty({
    description: 'List of Providers participating in Po-Rep market',
    type: PoRepProviderInfo,
    isArray: true,
  })
  data: PoRepProviderInfo[];
}

export class PoRepProviderResourceParameters {
  @ApiProperty({
    description: `Provider ID for which statistic should be returned. Either
      numerical id or f0 address.`,
    type: 'string',
  })
  @IsF0IdInput()
  providerId: F0IdInput;
}
