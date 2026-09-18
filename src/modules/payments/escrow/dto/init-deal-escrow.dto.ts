import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';

class InitDealEscrowDataDto {
  @ApiProperty()
  @IsUUID()
  dealId: string;
}

export class InitDealEscrowDto {
  @ApiProperty({ type: () => InitDealEscrowDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => InitDealEscrowDataDto)
  data: InitDealEscrowDataDto;
}
