import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { ChannelStatus } from '../types/channel-status.enum';
import { ChannelRole } from '../types/channel-role.enum';

const SORT_OPTIONS = ['recent', 'title', 'subscribers'] as const;
const ORDER_OPTIONS = ['asc', 'desc'] as const;

type SortOption = (typeof SORT_OPTIONS)[number];
type OrderOption = (typeof ORDER_OPTIONS)[number];

class ListChannelsDataDto {
  @ApiPropertyOptional({ enum: ChannelStatus })
  @IsOptional()
  @IsIn(Object.values(ChannelStatus))
  status?: ChannelStatus;

  @ApiPropertyOptional({ enum: ChannelRole })
  @IsOptional()
  @IsIn(Object.values(ChannelRole))
  role?: ChannelRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  verifiedOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Include disabled channels in the response.',
  })
  @IsOptional()
  @IsBoolean()
  includeDisabled?: boolean;

  @ApiPropertyOptional({
    description: 'Include active listings for each channel.',
  })
  @IsOptional()
  @IsBoolean()
  includeListings?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  username?: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @ApiPropertyOptional({ enum: SORT_OPTIONS })
  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sort?: SortOption;

  @ApiPropertyOptional({ enum: ORDER_OPTIONS })
  @IsOptional()
  @IsIn(ORDER_OPTIONS)
  order?: OrderOption;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class ListChannelsDto {
  @ApiProperty({ type: () => ListChannelsDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ListChannelsDataDto)
  data: ListChannelsDataDto;
}

export type ListChannelsFilters = ListChannelsDataDto;
