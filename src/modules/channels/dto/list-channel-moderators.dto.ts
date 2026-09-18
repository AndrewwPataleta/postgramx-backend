import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';

class ListChannelModeratorsDataDto {
  @ApiProperty()
  @IsUUID()
  channelId: string;
}

export class ListChannelModeratorsDto {
  @ApiProperty({ type: () => ListChannelModeratorsDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ListChannelModeratorsDataDto)
  data: ListChannelModeratorsDataDto;
}
