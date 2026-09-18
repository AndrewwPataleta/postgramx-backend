import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

class PreviewChannelDataDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  usernameOrLink: string;
}

export class PreviewChannelDto {
  @ApiProperty({ type: () => PreviewChannelDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PreviewChannelDataDto)
  data: PreviewChannelDataDto;
}
