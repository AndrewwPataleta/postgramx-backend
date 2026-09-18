import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DealPostAnalyticsEntity } from './deal-post-analytics.entity';

@Entity({ name: 'deal_post_analytics_snapshots' })
@Index('IDX_deal_post_analytics_snapshots_analytics_id_sampled_at', [
  'dealPostAnalyticsId',
  'sampledAt',
])
export class DealPostAnalyticsSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  dealPostAnalyticsId: string;

  @Column({ type: 'timestamptz' })
  sampledAt: Date;

  @Column({ type: 'bigint', nullable: true })
  views: string | null;

  @ManyToOne(
    () => DealPostAnalyticsEntity,
    (analytics) => analytics.snapshots,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'dealPostAnalyticsId' })
  analytics: DealPostAnalyticsEntity;
}
