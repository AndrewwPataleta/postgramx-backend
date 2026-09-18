import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ChannelEntity } from '../../channels/entities/channel.entity';
import { User } from '../../auth/entities/user.entity';
import { ListingFormat } from '../../../common/constants/channels/listing-format.constants';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';

@Entity({ name: 'listings' })
@Index('IDX_listings_channel_active_created_at', [
  'channelId',
  'isActive',
  'createdAt',
])
@Index('IDX_listings_created_by_created_at', ['createdByUserId', 'createdAt'])
export class ListingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channelId: string;

  @Column({ type: 'uuid' })
  createdByUserId: string;

  @ManyToOne(() => ChannelEntity, (channel) => channel.listings, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'channelId' })
  channel: ChannelEntity;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdByUserId' })
  createdByUser: User | null;

  @Column({ type: 'text' })
  format: ListingFormat;

  @Column({ type: 'bigint' })
  priceNano: string;

  @Column({ type: 'text', default: CurrencyCode.TON })
  currency: CurrencyCode;

  @Column({ type: 'integer', nullable: true })
  pinDurationHours: number | null;

  @Column({ type: 'integer' })
  visibilityDurationHours: number;

  @Column({ default: false })
  allowEdits: boolean;

  @Column({ default: false })
  allowLinkTracking: boolean;

  @Column({ default: false })
  allowPinnedPlacement: boolean;

  @Column({ default: true })
  requiresApproval: boolean;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'text', default: '' })
  contentRulesText: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags: string[];

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
