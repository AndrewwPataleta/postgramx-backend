import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class ChannelDetailDataDto {
  @ApiProperty({ description: 'Channel UUID.' })
  @IsDefined()
  @IsUUID('4')
  id: string;

  @ApiPropertyOptional({
    description: 'Include active listings for the channel.',
  })
  @IsOptional()
  @IsBoolean()
  includeListings?: boolean;
}

export class ChannelDetailByBodyDto {
  @ApiProperty({ type: () => ChannelDetailDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ChannelDetailDataDto)
  data: ChannelDetailDataDto;
}
