import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';

class CreativeSubmitDataDto {
  @ApiProperty()
  @IsUUID()
  dealId: string;
}

export class CreativeSubmitDto {
  @ApiProperty({ type: () => CreativeSubmitDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreativeSubmitDataDto)
  data: CreativeSubmitDataDto;
}
