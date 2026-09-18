import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';

class CreativeStatusDataDto {
  @ApiProperty()
  @IsUUID()
  dealId: string;
}

export class CreativeStatusDto {
  @ApiProperty({ type: () => CreativeStatusDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreativeStatusDataDto)
  data: CreativeStatusDataDto;
}
