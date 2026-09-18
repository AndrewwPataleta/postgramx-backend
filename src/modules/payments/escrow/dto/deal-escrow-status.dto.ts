import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';

class DealEscrowStatusDataDto {
  @ApiProperty()
  @IsUUID()
  dealId: string;
}

export class DealEscrowStatusDto {
  @ApiProperty({ type: () => DealEscrowStatusDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DealEscrowStatusDataDto)
  data: DealEscrowStatusDataDto;
}
