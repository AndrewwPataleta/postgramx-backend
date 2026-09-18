import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TransactionDirection } from '../../../common/constants/payments/transaction-direction.constants';
import { TransactionStatus } from '../../../common/constants/payments/transaction-status.constants';
import { TransactionType } from '../../../common/constants/payments/transaction-type.constants';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';

class CreateTransactionDataDto {
  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiPropertyOptional({ format: 'uuid', readOnly: true })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ enum: TransactionDirection })
  @IsEnum(TransactionDirection)
  direction: TransactionDirection;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiProperty({ description: 'Amount in nano TON as a string' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/)
  amountNano: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  dealId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  escrowId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  channelId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  counterpartyUserId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  depositAddress?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  externalTxHash?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  externalExplorerUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  errorCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  errorMessage?: string | null;

  @ApiPropertyOptional({ type: 'object' })
  @IsOptional()
  metadata?: Record<string, unknown> | null;
}

export class CreateTransactionDto {
  @ApiProperty({ type: () => CreateTransactionDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateTransactionDataDto)
  data: CreateTransactionDataDto;
}

export type CreateTransactionPayload = CreateTransactionDataDto;
