import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TransactionDirection } from '../../../common/constants/payments/transaction-direction.constants';
import { TransactionStatus } from '../../../common/constants/payments/transaction-status.constants';
import { TransactionType } from '../../../common/constants/payments/transaction-type.constants';

const SORT_OPTIONS = ['recent', 'amount'] as const;
const ORDER_OPTIONS = ['asc', 'desc'] as const;

type SortOption = (typeof SORT_OPTIONS)[number];
type OrderOption = (typeof ORDER_OPTIONS)[number];

class ListTransactionsDataDto {
  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({ enum: TransactionDirection })
  @IsOptional()
  @IsEnum(TransactionDirection)
  direction?: TransactionDirection;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dealId?: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @ApiPropertyOptional({ description: 'ISO date string' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date string' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: SORT_OPTIONS })
  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sort?: SortOption;

  @ApiPropertyOptional({ enum: ORDER_OPTIONS })
  @IsOptional()
  @IsIn(ORDER_OPTIONS)
  order?: OrderOption;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class ListTransactionsDto {
  @ApiProperty({ type: () => ListTransactionsDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ListTransactionsDataDto)
  data: ListTransactionsDataDto;
}

export type ListTransactionsFilters = ListTransactionsDataDto;
