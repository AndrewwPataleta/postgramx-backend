import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, ValidateNested } from 'class-validator';

class GetTransactionDataDto {}

export class GetTransactionDto {
  @ApiProperty({ type: () => GetTransactionDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => GetTransactionDataDto)
  data: GetTransactionDataDto;
}
