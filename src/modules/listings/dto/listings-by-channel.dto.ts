import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const SORT_OPTIONS = ['recent', 'price_asc', 'price_desc'] as const;
type ListingSortOption = (typeof SORT_OPTIONS)[number];

class ListingsByChannelDataDto {
  @ApiProperty()
  @IsUUID()
  channelId: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit: number = 20;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  onlyActive?: boolean = true;

  @ApiPropertyOptional({ enum: SORT_OPTIONS, default: 'recent' })
  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sort?: ListingSortOption = 'recent';
}

export class ListingsByChannelDto {
  @ApiProperty({ type: () => ListingsByChannelDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ListingsByChannelDataDto)
  data: ListingsByChannelDataDto;
}
