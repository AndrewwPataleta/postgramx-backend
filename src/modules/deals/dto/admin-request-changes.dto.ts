import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class AdminRequestChangesDataDto {
  @ApiProperty()
  @IsUUID()
  dealId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class AdminRequestChangesDto {
  @ApiProperty({ type: () => AdminRequestChangesDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => AdminRequestChangesDataDto)
  data: AdminRequestChangesDataDto;
}
