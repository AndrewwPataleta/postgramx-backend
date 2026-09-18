import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DealEntity } from '../../deals/entities/deal.entity';
import { DealPostAnalyticsTrackingStatus } from '../../../common/constants/post-analytics/post-analytics.constants';
import { DealPostAnalyticsLinkEntity } from './deal-post-analytics-link.entity';
import { DealPostAnalyticsSnapshotEntity } from './deal-post-analytics-snapshot.entity';

@Entity({ name: 'deal_post_analytics' })
@Index('UQ_deal_post_analytics_deal_id', ['dealId'], { unique: true })
@Index('IDX_deal_post_analytics_status_ends_at', ['trackingStatus', 'endsAt'])
export class DealPostAnalyticsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  dealId: string;

  @Column({ type: 'uuid' })
  channelId: string;

  @Column({ type: 'text' })
  telegramChatId: string;

  @Column({ type: 'bigint' })
  telegramMessageId: string;

  @Column({
    type: 'enum',
    enum: DealPostAnalyticsTrackingStatus,
    enumName: 'deal_post_analytics_tracking_status_enum',
    default: DealPostAnalyticsTrackingStatus.ACTIVE,
  })
  trackingStatus: DealPostAnalyticsTrackingStatus;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz' })
  endsAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastSampledAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'bigint', nullable: true })
  finalViews: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  finalAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => DealEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dealId' })
  deal: DealEntity;

  @OneToMany(() => DealPostAnalyticsLinkEntity, (link) => link.analytics)
  links: DealPostAnalyticsLinkEntity[];

  @OneToMany(
    () => DealPostAnalyticsSnapshotEntity,
    (snapshot) => snapshot.analytics,
  )
  snapshots: DealPostAnalyticsSnapshotEntity[];
}
