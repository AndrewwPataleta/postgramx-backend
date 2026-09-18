import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';
import { TransactionEntity } from './transaction.entity';
import { TonTransferStatus } from '../../../common/constants/payments/ton-transfer-status.constants';
import { TonTransferType } from '../../../common/constants/payments/ton-transfer-type.constants';

@Entity({ name: 'ton_transfers' })
@Index('UQ_ton_transfers_tx_hash_network', ['txHash', 'network'], {
  unique: true,
  where: '"txHash" IS NOT NULL',
})
@Index('UQ_ton_transfers_idempotency_key', ['idempotencyKey'], {
  unique: true,
  where: '"idempotencyKey" IS NOT NULL',
})
@Index('IDX_ton_transfers_to_address', ['toAddress'])
@Index('IDX_ton_transfers_transaction_id', ['transactionId'])
@Index('UQ_ton_transfers_transaction_id', ['transactionId'], { unique: true })
export class TonTransferEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  transactionId: string | null;

  @Column({ type: 'uuid', nullable: true })
  dealId: string | null;

  @Column({ type: 'uuid', nullable: true })
  escrowWalletId: string | null;

  @Column({ type: 'text', nullable: true })
  idempotencyKey: string | null;

  @Column({
    type: 'enum',
    enum: TonTransferStatus,
    default: TonTransferStatus.CREATED,
  })
  status: TonTransferStatus;

  @Column({
    type: 'enum',
    enum: CurrencyCode,
    enumName: 'ton_transfers_network_enum',
    default: CurrencyCode.TON,
  })
  network: CurrencyCode;

  @Column({
    type: 'enum',
    enum: TonTransferType,
    enumName: 'ton_transfers_type_enum',
  })
  type: TonTransferType;

  @Column({ type: 'text' })
  toAddress: string;

  @Column({ type: 'text' })
  fromAddress: string;

  @Column({ type: 'bigint' })
  amountNano: string;

  @Column({ type: 'text', nullable: true })
  txHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  observedAt: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  raw: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => TransactionEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'transactionId' })
  transaction: TransactionEntity | null;
}
