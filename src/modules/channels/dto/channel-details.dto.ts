import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsOptional,
  ValidateNested,
} from 'class-validator';

class ChannelDetailsDataDto {
  @ApiPropertyOptional({
    description: 'Include active listings for the channel.',
  })
  @IsOptional()
  @IsBoolean()
  includeListings?: boolean;
}

export class ChannelDetailsDto {
  @ApiProperty({ type: () => ChannelDetailsDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ChannelDetailsDataDto)
  data: ChannelDetailsDataDto;
}
