import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ChannelStatus } from '../types/channel-status.enum';
import { ListingEntity } from '../../listings/entities/listing.entity';
import { User } from '../../auth/entities/user.entity';

@Entity({ name: 'channels' })
@Index('IDX_channels_username', ['username'])
@Index('IDX_channels_subscribers_count', ['subscribersCount'])
export class ChannelEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 64, unique: true })
  username: string;

  @Column({ type: 'bigint', nullable: true, unique: true })
  telegramChatId: string | null;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  avatarUrl: string;

  @Column({ type: 'enum', enum: ChannelStatus, default: ChannelStatus.DRAFT })
  status: ChannelStatus;

  @Column({ type: 'uuid' })
  createdByUserId: string;

  @Column({ type: 'uuid' })
  ownerUserId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'ownerUserId' })
  ownerUser: User;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  @Column({ type: 'integer', nullable: true })
  subscribersCount: number | null;

  @Column({ type: 'integer', nullable: true })
  avgViews: number | null;

  @Column({ default: false })
  isDisabled: boolean;

  @Column({ type: 'jsonb', nullable: true })
  languageStats: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => ListingEntity, (listing) => listing.channel, {
    cascade: false,
  })
  listings: ListingEntity[];
}
