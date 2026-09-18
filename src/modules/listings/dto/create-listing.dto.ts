import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsDefined,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { ListingFormat } from '../../../common/constants/channels/listing-format.constants';

class CreateListingDataDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @ApiProperty({ enum: ListingFormat })
  @IsEnum(ListingFormat)
  format: ListingFormat;

  @ApiProperty({ example: 25 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 9 })
  @IsPositive()
  priceTon: number;

  @ApiProperty({ required: false, nullable: true, example: 24 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  pinDurationHours?: number | null;

  @ApiProperty({ example: 48 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  visibilityDurationHours: number;

  @ApiProperty()
  @IsBoolean()
  allowEdits: boolean;

  @ApiProperty()
  @IsBoolean()
  allowLinkTracking: boolean;

  @ApiProperty()
  @IsBoolean()
  allowPinnedPlacement: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true)
  requiresApproval: boolean;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  contentRulesText?: string;

  @ApiProperty({ type: [String], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  tags: string[];

  @ApiProperty({ example: true })
  @IsBoolean()
  isActive: boolean;
}

export class CreateListingDto {
  @ApiProperty({ type: () => CreateListingDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateListingDataDto)
  data: CreateListingDataDto;
}
