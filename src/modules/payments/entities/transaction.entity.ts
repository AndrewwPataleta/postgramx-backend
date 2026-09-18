import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TransactionDirection } from '../../../common/constants/payments/transaction-direction.constants';
import { TransactionStatus } from '../../../common/constants/payments/transaction-status.constants';
import { TransactionType } from '../../../common/constants/payments/transaction-type.constants';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';
import { DealEscrowEntity } from '../../deals/entities/deal-escrow.entity';

@Entity({ name: 'transactions' })
@Index('IDX_transactions_user_created_at', ['userId', 'createdAt'])
@Index('IDX_transactions_deal_id', ['dealId'])
@Index('IDX_transactions_escrow_id', ['escrowId'])
@Index('IDX_transactions_status', ['status'])
@Index('IDX_transactions_type', ['type'])
@Index('IDX_transactions_source_request_id', ['sourceRequestId'])
@Index(
  'UQ_transactions_external_tx_hash_currency',
  ['externalTxHash', 'currency'],
  {
    unique: true,
    where: '"externalTxHash" IS NOT NULL',
  },
)
@Index('UQ_transactions_idempotency_key', ['idempotencyKey'], {
  unique: true,
  where: '"idempotencyKey" IS NOT NULL',
})
export class TransactionEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ type: 'enum', enum: TransactionDirection })
  direction: TransactionDirection;

  @Column({ type: 'enum', enum: TransactionStatus })
  status: TransactionStatus;

  @Column({ type: 'bigint' })
  amountNano: string;

  @Column({ type: 'bigint', default: '0' })
  amountToUserNano: string;

  @Column({ type: 'bigint', default: '0' })
  serviceFeeNano: string;

  @Column({ type: 'bigint', default: '0' })
  networkFeeNano: string;

  @Column({ type: 'bigint', default: '0' })
  totalDebitNano: string;

  @Column({ type: 'int', default: 1 })
  feePolicyVersion: number;

  @Column({ type: 'bigint', default: '0' })
  receivedNano: string;

  @Column({ default: CurrencyCode.TON })
  currency: CurrencyCode;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'uuid', nullable: true })
  dealId: string | null;

  @Column({ type: 'uuid', nullable: true })
  escrowId: string | null;

  @Column({ type: 'uuid', nullable: true })
  channelId: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceRequestId: string | null;

  @Column({ type: 'uuid', nullable: true })
  counterpartyUserId: string | null;

  @Column({ type: 'text', nullable: true })
  depositAddress: string | null;

  @Column({ type: 'text', nullable: true })
  externalTxHash: string | null;

  @Column({ type: 'text', nullable: true })
  externalExplorerUrl: string | null;

  @Column({ type: 'uuid', nullable: true })
  tonTransferId: string | null;

  @Column({ type: 'text', nullable: true })
  destinationAddress: string | null;

  @Column({ type: 'text', nullable: true })
  idempotencyKey: string | null;

  @Column({ type: 'text', nullable: true })
  errorCode: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expectedObservedAfter: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expectedObservedBefore: Date | null;

  @ManyToOne(() => DealEscrowEntity, { nullable: true })
  @JoinColumn({ name: 'escrowId' })
  escrow: DealEscrowEntity | null;
}
