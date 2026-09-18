import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const SORT_OPTIONS = ['recent', 'price_min', 'subscribers'] as const;
const ORDER_OPTIONS = ['asc', 'desc'] as const;

type SortOption = (typeof SORT_OPTIONS)[number];
type OrderOption = (typeof ORDER_OPTIONS)[number];

export class MarketplaceListChannelsDataDto {
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSubscribers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxSubscribers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 9 })
  @Min(0)
  minPriceTon?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 9 })
  @Min(0)
  maxPriceTon?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  verifiedOnly?: boolean;

  @ApiProperty({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiProperty({ default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({ enum: SORT_OPTIONS })
  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sort?: SortOption;

  @ApiPropertyOptional({ enum: ORDER_OPTIONS })
  @IsOptional()
  @IsIn(ORDER_OPTIONS)
  order?: OrderOption;
}

export class MarketplaceListChannelsDto {
  @ApiProperty({ type: () => MarketplaceListChannelsDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => MarketplaceListChannelsDataDto)
  data: MarketplaceListChannelsDataDto;
}
