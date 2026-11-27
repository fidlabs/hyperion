import { ApiProperty, IntersectionType, PickType } from '@nestjs/swagger';
import { PoRepHistoryParameters } from 'src/service/po-rep/types.po-rep';
import { F0IdInput, IsF0IdInput } from 'src/utils/validators';
import { StatisticsRequest } from '../base/types.controller-base';

export class GetProviderStatisticsRequest {
  @ApiProperty({
    description: `Provider ID for which statistic should be returned. Either
      numerical id or f0 address.`,
    type: 'string',
  })
  @IsF0IdInput()
  providerId: F0IdInput;
}

export class PoRepClientHistoryRequest extends IntersectionType(
  PickType(StatisticsRequest, ['period']),
  PoRepHistoryParameters,
) {}
