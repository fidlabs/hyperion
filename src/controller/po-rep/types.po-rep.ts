import { ApiProperty } from '@nestjs/swagger';
import { F0IdInput, IsF0IdInput } from 'src/utils/validators';

export class PoRepProviderResourceParameters {
  @ApiProperty({
    description: `Provider ID for which statistic should be returned. Either
      numerical id or f0 address.`,
    type: 'string',
  })
  @IsF0IdInput()
  providerId: F0IdInput;
}
