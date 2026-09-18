import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

class ListChannelAdminsDataDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  channelId: string;
}

export class ListChannelAdminsDto {
  @ApiProperty({ type: () => ListChannelAdminsDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ListChannelAdminsDataDto)
  data: ListChannelAdminsDataDto;
}
