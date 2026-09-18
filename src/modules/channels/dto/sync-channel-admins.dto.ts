import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

class SyncChannelAdminsDataDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  channelId: string;
}

export class SyncChannelAdminsDto {
  @ApiProperty({ type: () => SyncChannelAdminsDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => SyncChannelAdminsDataDto)
  data: SyncChannelAdminsDataDto;
}
