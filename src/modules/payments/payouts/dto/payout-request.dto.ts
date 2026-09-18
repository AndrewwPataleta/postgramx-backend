import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  SUPPORTED_AUTH_TYPES,
  SUPPORTED_PLATFORM_TYPES,
  SupportedAuthType,
  SupportedPlatformType,
} from '../../../auth/auth.constants';
import { CurrencyCode } from '../../../../common/constants/currency/currency.constants';

export enum PayoutRequestMode {
  ALL = 'ALL',
  AMOUNT = 'AMOUNT',
}

class PayoutRequestDataDto {
  @ApiPropertyOptional({ description: 'Amount in nano', type: String })
  @IsOptional()
  @IsString()
  amountNano?: string;

  @ApiPropertyOptional({ enum: CurrencyCode, default: CurrencyCode.TON })
  @IsOptional()
  @IsIn([CurrencyCode.TON])
  currency?: CurrencyCode;

  @ApiPropertyOptional({
    enum: PayoutRequestMode,
    default: PayoutRequestMode.ALL,
  })
  @IsOptional()
  @IsIn([PayoutRequestMode.ALL, PayoutRequestMode.AMOUNT])
  mode?: PayoutRequestMode;
}

export class PayoutRequestDto {
  @ApiProperty({ enum: SUPPORTED_PLATFORM_TYPES })
  @IsIn(SUPPORTED_PLATFORM_TYPES)
  platformType: SupportedPlatformType;

  @ApiProperty({ enum: SUPPORTED_AUTH_TYPES })
  @IsIn(SUPPORTED_AUTH_TYPES)
  authType: SupportedAuthType;

  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ type: () => PayoutRequestDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PayoutRequestDataDto)
  data: PayoutRequestDataDto;
}
