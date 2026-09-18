import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EscrowStatus } from '../../../common/constants/deals/deal-escrow-status.constants';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';
import { DealEntity } from './deal.entity';
import { EscrowWalletEntity } from '../../payments/entities/escrow-wallet.entity';
import { PayoutRequestEntity } from '../../payments/entities/payout-request.entity';
import { RefundRequestEntity } from '../../payments/entities/refund-request.entity';

@Entity({ name: 'deal_escrows' })
@Index('IDX_deal_escrows_status', ['status'])
@Index('IDX_deal_escrows_payment_deadline', ['paymentDeadlineAt'])
@Index('IDX_deal_escrows_payment_address', ['depositAddress'])
@Index('UQ_deal_escrows_deal_id', ['dealId'], { unique: true })
export class DealEscrowEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  dealId: string;

  @Column({
    type: 'enum',
    enum: EscrowStatus,
    enumName: 'deal_escrows_status_enum',
    default: EscrowStatus.CREATED,
  })
  status: EscrowStatus;

  @Column({
    type: 'enum',
    enum: CurrencyCode,
    enumName: 'deal_escrows_currency_enum',
    default: CurrencyCode.TON,
  })
  currency: CurrencyCode;

  @Column({ type: 'bigint' })
  amountNano: string;

  @Column({ type: 'bigint', default: '0' })
  paidNano: string;

  @Column({ type: 'uuid', nullable: true })
  depositWalletId: string | null;

  @Column({ type: 'text', nullable: true })
  depositAddress: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paymentDeadlineAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  heldAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  payoutId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  refundId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidOutAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastSeenLt: string | null;

  @Column({ type: 'text', nullable: true })
  lastSeenTxHash: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => DealEntity, (deal) => deal.escrow, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dealId' })
  deal: DealEntity;

  @ManyToOne(() => EscrowWalletEntity, { nullable: true })
  @JoinColumn({ name: 'depositWalletId' })
  depositWallet: EscrowWalletEntity | null;

  @ManyToOne(() => PayoutRequestEntity, { nullable: true })
  @JoinColumn({ name: 'payoutId' })
  payout: PayoutRequestEntity | null;

  @ManyToOne(() => RefundRequestEntity, { nullable: true })
  @JoinColumn({ name: 'refundId' })
  refund: RefundRequestEntity | null;
}
