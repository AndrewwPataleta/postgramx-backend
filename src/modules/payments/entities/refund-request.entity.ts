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
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';
import { RequestStatus } from '../../../common/constants/payments/request-status.constants';
import { User } from '../../auth/entities/user.entity';
import { DealEntity } from '../../deals/entities/deal.entity';

@Entity({ name: 'refund_requests' })
@Index('UQ_refund_requests_idempotency', ['idempotencyKey'], { unique: true })
@Index('IDX_refund_requests_status', ['status'])
export class RefundRequestEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid' })
  dealId: string;

  @Column({ type: 'bigint' })
  amountNano: string;

  @Column({ type: 'enum', enum: CurrencyCode, default: CurrencyCode.TON })
  currency: CurrencyCode;

  @Column({ type: 'enum', enum: RequestStatus })
  status: RequestStatus;

  @Column({ type: 'text' })
  idempotencyKey: string;

  @Column({ type: 'text', nullable: true })
  txHash: string | null;

  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => DealEntity, { nullable: false })
  @JoinColumn({ name: 'dealId' })
  deal: DealEntity;
}
