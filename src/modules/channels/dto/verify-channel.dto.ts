import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

class VerifyChannelDataDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  username: string;
}

export class VerifyChannelDto {
  @ApiProperty({ type: () => VerifyChannelDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => VerifyChannelDataDto)
  data: VerifyChannelDataDto;
}
