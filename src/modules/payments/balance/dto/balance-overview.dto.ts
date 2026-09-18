import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
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

class BalanceOverviewDataDto {
  @ApiPropertyOptional({ enum: CurrencyCode, default: CurrencyCode.TON })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;
}

export class BalanceOverviewDto {
  @ApiProperty({ enum: SUPPORTED_PLATFORM_TYPES })
  @IsIn(SUPPORTED_PLATFORM_TYPES)
  platformType: SupportedPlatformType;

  @ApiProperty({ enum: SUPPORTED_AUTH_TYPES })
  @IsIn(SUPPORTED_AUTH_TYPES)
  authType: SupportedAuthType;

  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ type: () => BalanceOverviewDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BalanceOverviewDataDto)
  data: BalanceOverviewDataDto;
}
