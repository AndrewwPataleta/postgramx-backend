import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  SUPPORTED_AUTH_TYPES,
  SUPPORTED_PLATFORM_TYPES,
  SupportedAuthType,
  SupportedPlatformType,
} from '../../auth/auth.constants';

class DealDetailDataDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;
}

export class DealDetailDto {
  @ApiProperty({ enum: SUPPORTED_PLATFORM_TYPES })
  @IsIn(SUPPORTED_PLATFORM_TYPES)
  platformType: SupportedPlatformType;

  @ApiProperty({ enum: SUPPORTED_AUTH_TYPES })
  @IsIn(SUPPORTED_AUTH_TYPES)
  authType: SupportedAuthType;

  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ type: () => DealDetailDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DealDetailDataDto)
  data: DealDetailDataDto;
}
