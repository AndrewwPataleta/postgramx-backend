import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ChannelRole } from '../types/channel-role.enum';

export enum TelegramAdminStatus {
  CREATOR = 'creator',
  ADMINISTRATOR = 'administrator',
}

@Entity({ name: 'channel_memberships' })
@Index('IDX_channel_memberships_channel_id', ['channelId'])
@Index('IDX_channel_memberships_user_id', ['userId'])
@Index('IDX_channel_memberships_telegram_user_id', ['telegramUserId'])
@Index('IDX_channel_memberships_channel_user', ['channelId', 'userId'], {
  unique: true,
})
@Index('IDX_channel_memberships_channel_telegram_user', [
  'channelId',
  'telegramUserId',
])
export class ChannelMembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channelId: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'bigint', nullable: true })
  telegramUserId: string | null;

  @Column({ type: 'enum', enum: ChannelRole })
  role: ChannelRole;

  @Column({
    type: 'enum',
    enum: TelegramAdminStatus,
    nullable: true,
  })
  telegramAdminStatus: TelegramAdminStatus | null;

  @Column({ type: 'jsonb', nullable: true })
  permissionsSnapshot: Record<string, unknown> | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isManuallyDisabled: boolean;

  @Column({ default: false })
  canReviewDeals: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  permissionsUpdatedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastRecheckAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
