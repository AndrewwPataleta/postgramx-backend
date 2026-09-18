import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID, ValidateNested } from 'class-validator';

class SetReviewEnabledDataDto {
  @ApiProperty()
  @IsUUID()
  channelId: string;

  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiProperty()
  @IsBoolean()
  canReviewDeals: boolean;
}

export class SetReviewEnabledDto {
  @ApiProperty({ type: () => SetReviewEnabledDataDto, required: false })
  @ValidateNested()
  @Type(() => SetReviewEnabledDataDto)
  data?: SetReviewEnabledDataDto;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  channelId?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  userId?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  canReviewDeals?: boolean;
}
