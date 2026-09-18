import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  SUPPORTED_AUTH_TYPES,
  SUPPORTED_PLATFORM_TYPES,
  SupportedAuthType,
  SupportedPlatformType,
} from '../../auth/auth.constants';

class UserWalletDataDto {
  @ApiProperty({ description: 'TonConnect address' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  tonAddress: string;
}

export class UserWalletDto {
  @ApiProperty({ enum: SUPPORTED_PLATFORM_TYPES })
  @IsIn(SUPPORTED_PLATFORM_TYPES)
  platformType: SupportedPlatformType;

  @ApiProperty({ enum: SUPPORTED_AUTH_TYPES })
  @IsIn(SUPPORTED_AUTH_TYPES)
  authType: SupportedAuthType;

  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ type: () => UserWalletDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => UserWalletDataDto)
  data: UserWalletDataDto;
}
