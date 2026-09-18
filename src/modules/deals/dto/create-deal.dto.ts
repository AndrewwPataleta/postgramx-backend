import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class CreateDealDataDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  listingId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  brief?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class CreateDealDto {
  @ApiProperty({ type: () => CreateDealDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateDealDataDto)
  data: CreateDealDataDto;
}
