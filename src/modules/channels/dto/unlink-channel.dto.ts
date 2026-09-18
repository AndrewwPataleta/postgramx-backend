import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

class UnlinkChannelDataDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  channelId: string;
}

export class UnlinkChannelDto {
  @ApiProperty({ type: () => UnlinkChannelDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => UnlinkChannelDataDto)
  data: UnlinkChannelDataDto;
}
