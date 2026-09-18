import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ListingEntity } from '../../listings/entities/listing.entity';
import { ChannelEntity } from '../../channels/entities/channel.entity';
import { DealListingSnapshot } from '../types/deal-listing-snapshot.type';
import { DealStatus } from '../../../common/constants/deals/deal-status.constants';
import { DealStage } from '../../../common/constants/deals/deal-stage.constants';
import { DealEscrowEntity } from './deal-escrow.entity';
import { DealCreativeEntity } from './deal-creative.entity';
import { DealPublicationEntity } from './deal-publication.entity';
import { User } from '../../auth/entities/user.entity';

@Entity({ name: 'deals' })
@Index('IDX_deals_advertiser_status', ['advertiserUserId', 'status'])
@Index('IDX_deals_publisher_status', ['publisherUserId', 'status'])
@Index('IDX_deals_channel_status', ['channelId', 'status'])
@Index('IDX_deals_stage', ['stage'])
@Index('IDX_deals_scheduled_stage', ['scheduledAt', 'stage'])
@Index('IDX_deals_idle_expires_at', ['idleExpiresAt'])
@Index('IDX_deals_last_activity_at', ['lastActivityAt'])
export class DealEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  advertiserUserId: string;

  @Column({ type: 'uuid', nullable: true })
  publisherUserId: string | null;

  @Column({ type: 'uuid' })
  channelId: string;

  @Column({ type: 'uuid', nullable: true })
  listingId: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => ListingEntity, { nullable: true })
  @JoinColumn({ name: 'listingId' })
  listing: ListingEntity | null;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'advertiserUserId' })
  advertiserUser: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'publisherUserId' })
  publisherUser: User | null;

  @ManyToOne(() => ChannelEntity, { nullable: false })
  @JoinColumn({ name: 'channelId' })
  channel: ChannelEntity;

  @Column({
    type: 'enum',
    enum: DealStatus,
    enumName: 'deals_status_enum',
    default: DealStatus.PENDING,
  })
  status: DealStatus;

  @Column({
    type: 'enum',
    enum: DealStage,
    enumName: 'deals_stage_enum',
    default: DealStage.CREATIVE_AWAITING_SUBMIT,
  })
  stage: DealStage;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastActivityAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  idleExpiresAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastScheduleLateNotifiedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  listingSnapshot: DealListingSnapshot;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => DealEscrowEntity, (escrow) => escrow.deal, {
    cascade: true,
    eager: false,
  })
  escrow: DealEscrowEntity;

  @OneToMany(() => DealCreativeEntity, (creative) => creative.deal, {
    cascade: true,
  })
  creatives: DealCreativeEntity[];

  @OneToOne(() => DealPublicationEntity, (publication) => publication.deal, {
    cascade: true,
    eager: false,
  })
  publication: DealPublicationEntity;
}
