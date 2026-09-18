import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  DealPostAnalyticsLinkTrackingStatus,
  DealPostAnalyticsLinkType,
} from '../../../common/constants/post-analytics/post-analytics.constants';
import { DealPostAnalyticsEntity } from './deal-post-analytics.entity';

@Entity({ name: 'deal_post_analytics_links' })
@Index('IDX_deal_post_analytics_links_analytics_id', ['dealPostAnalyticsId'])
export class DealPostAnalyticsLinkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  dealPostAnalyticsId: string;

  @Column({
    type: 'enum',
    enum: DealPostAnalyticsLinkType,
    enumName: 'deal_post_analytics_link_type_enum',
    default: DealPostAnalyticsLinkType.TG_CHANNEL,
  })
  linkType: DealPostAnalyticsLinkType;

  @Column({ type: 'text' })
  rawUrl: string;

  @Column({ type: 'text', nullable: true })
  normalizedChannelUsername: string | null;

  @Column({ type: 'text', nullable: true })
  resolvedTelegramChatId: string | null;

  @Column({ type: 'int', nullable: true })
  baselineSubscribers: number | null;

  @Column({ type: 'int', nullable: true })
  finalSubscribers: number | null;

  @Column({ type: 'int', nullable: true })
  subscribersDelta: number | null;

  @Column({ type: 'text', default: 'DELTA_SUBSCRIBERS' })
  attributionMethod: string;

  @Column({
    type: 'enum',
    enum: DealPostAnalyticsLinkTrackingStatus,
    enumName: 'deal_post_analytics_link_tracking_status_enum',
    default: DealPostAnalyticsLinkTrackingStatus.ACTIVE,
  })
  trackingStatus: DealPostAnalyticsLinkTrackingStatus;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @ManyToOne(() => DealPostAnalyticsEntity, (analytics) => analytics.links, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'dealPostAnalyticsId' })
  analytics: DealPostAnalyticsEntity;
}
