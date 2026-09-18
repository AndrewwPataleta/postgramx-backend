import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';

class CreativeReviewActionDataDto {
  @ApiProperty()
  @IsUUID()
  id: string;
}

export class CreativeReviewActionDto {
  @ApiProperty({ type: () => CreativeReviewActionDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreativeReviewActionDataDto)
  data: CreativeReviewActionDataDto;
}
