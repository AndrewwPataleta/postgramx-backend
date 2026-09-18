import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';

class AdminApproveDataDto {
  @ApiProperty()
  @IsUUID()
  dealId: string;
}

export class AdminApproveDto {
  @ApiProperty({ type: () => AdminApproveDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => AdminApproveDataDto)
  data: AdminApproveDataDto;
}
