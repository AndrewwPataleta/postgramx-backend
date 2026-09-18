import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PublicationStatus } from '../../../common/constants/deals/publication-status.constants';
import { PinVisibilityStatus } from '../../../common/constants/deals/pin-visibility-status.constants';
import { DealEntity } from './deal.entity';

@Entity({ name: 'deal_publications' })
@Index('IDX_deal_publications_status', ['status'])
@Index('IDX_deal_publications_must_remain', ['mustRemainUntil'])
@Index('IDX_deal_publications_pin_visibility', [
  'pinVisibilityStatus',
  'pinMissingLastCheckedAt',
])
@Index('UQ_deal_publications_deal_id', ['dealId'], { unique: true })
export class DealPublicationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  dealId: string;

  @Column({
    type: 'enum',
    enum: PublicationStatus,
    enumName: 'deal_publications_status_enum',
    default: PublicationStatus.NOT_POSTED,
  })
  status: PublicationStatus;

  @Column({ type: 'bigint', nullable: true })
  publishedMessageId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  telegramChatId: string | null;

  @Column({ type: 'bigint', nullable: true })
  telegramMessageId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  postedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  mustRemainUntil: Date | null;

  @Column({
    type: 'enum',
    enum: PinVisibilityStatus,
    enumName: 'deal_publications_pin_visibility_enum',
    default: PinVisibilityStatus.NOT_REQUIRED,
  })
  pinVisibilityStatus: PinVisibilityStatus;

  @Column({ type: 'timestamptz', nullable: true })
  pinMonitoringEndsAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pinMissingFirstSeenAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pinMissingLastCheckedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  pinMissingCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  pinMissingWarningSentAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pinMissingFinalizedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pinPermissionWarningSentAt: Date | null;

  @Column({ type: 'text', nullable: true })
  pinLastErrorCode: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastVerifiedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'text', nullable: true })
  publishedMessageText: string | null;

  @Column({ type: 'text', nullable: true })
  publishedMessageCaption: string | null;

  @Column({ type: 'text', nullable: true })
  publishedMessageMediaFingerprint: string | null;

  @Column({ type: 'text', nullable: true })
  publishedMessageKeyboardFingerprint: string | null;

  @Column({ type: 'text', nullable: true })
  publishedMessageHash: string | null;

  @Column({ type: 'jsonb', nullable: true })
  publishedMessageSnapshotJson: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => DealEntity, (deal) => deal.publication, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'dealId' })
  deal: DealEntity;
}
