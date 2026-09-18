import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class CancelDealDataDto {
  @ApiProperty()
  @IsUUID()
  dealId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CancelDealDto {
  @ApiProperty({ type: () => CancelDealDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CancelDealDataDto)
  data: CancelDealDataDto;
}
