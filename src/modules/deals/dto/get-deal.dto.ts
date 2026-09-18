import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';

class GetDealDataDto {
  @ApiProperty()
  @IsUUID()
  dealId: string;
}

export class GetDealDto {
  @ApiProperty({ type: () => GetDealDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => GetDealDataDto)
  data: GetDealDataDto;
}
