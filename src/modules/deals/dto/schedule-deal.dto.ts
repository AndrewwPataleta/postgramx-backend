import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class ScheduleDealDataDto {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty({
    required: false,
    description: 'Backward-compatible UTC ISO publish time',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsDateString()
  scheduledAt?: string;

  @ApiProperty({
    required: false,
    description: 'Preferred UTC ISO publish time',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsDateString()
  publishAtUtc?: string;

  @ApiProperty({
    required: false,
    description: 'Local datetime e.g. 2026-02-12T15:00:00',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  publishAtLocal?: string;

  @ApiProperty({ required: false, description: 'IANA timezone string' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  timeZone?: string;

  @ApiProperty({
    required: false,
    description: 'Client offset from UTC in minutes',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  utcOffsetMinutes?: number;
}

export class ScheduleDealDto {
  @ApiProperty({ type: () => ScheduleDealDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ScheduleDealDataDto)
  data: ScheduleDealDataDto;
}
