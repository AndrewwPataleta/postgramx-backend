import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import {
  SUPPORTED_AUTH_TYPES,
  SUPPORTED_PLATFORM_TYPES,
  SupportedAuthType,
  SupportedPlatformType,
} from '../../auth/auth.constants';
import { Type } from 'class-transformer';

class DealPaymentPrepareDataDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  id?: string;
}

export class DealPaymentPrepareDto {
  @ApiProperty({ enum: SUPPORTED_PLATFORM_TYPES })
  @IsIn(SUPPORTED_PLATFORM_TYPES)
  platformType: SupportedPlatformType;

  @ApiProperty({ enum: SUPPORTED_AUTH_TYPES })
  @IsIn(SUPPORTED_AUTH_TYPES)
  authType: SupportedAuthType;

  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ required: false, type: () => DealPaymentPrepareDataDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DealPaymentPrepareDataDto)
  data?: DealPaymentPrepareDataDto;
}
