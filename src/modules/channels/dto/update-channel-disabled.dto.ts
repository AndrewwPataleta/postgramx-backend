import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, ValidateNested } from 'class-validator';

class UpdateChannelDisabledDataDto {
  @ApiProperty()
  @IsBoolean()
  disabled: boolean;
}

export class UpdateChannelDisabledDto {
  @ApiProperty({ type: () => UpdateChannelDisabledDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => UpdateChannelDisabledDataDto)
  data: UpdateChannelDisabledDataDto;
}
