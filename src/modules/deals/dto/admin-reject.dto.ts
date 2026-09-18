import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class AdminRejectDataDto {
  @ApiProperty()
  @IsUUID()
  dealId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminRejectDto {
  @ApiProperty({ type: () => AdminRejectDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => AdminRejectDataDto)
  data: AdminRejectDataDto;
}
