import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TelegramAdminRole {
  CREATOR = 'creator',
  ADMINISTRATOR = 'administrator',
}

@Entity({ name: 'channel_telegram_admins' })
@Index('IDX_channel_telegram_admins_channel_id', ['channelId'])
@Index('IDX_channel_telegram_admins_telegram_user_id', ['telegramUserId'])
@Index(
  'IDX_channel_telegram_admins_channel_user',
  ['channelId', 'telegramUserId'],
  {
    unique: true,
  },
)
export class ChannelTelegramAdminEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channelId: string;

  @Column({ type: 'bigint' })
  telegramUserId: string;

  @Column({ type: 'text', nullable: true })
  username: string | null;

  @Column({ type: 'text', nullable: true })
  firstName: string | null;

  @Column({ type: 'text', nullable: true })
  lastName: string | null;

  @Column({ default: false })
  isBot: boolean;

  @Column({ type: 'enum', enum: TelegramAdminRole })
  telegramRole: TelegramAdminRole;

  @Column({ name: 'rights', type: 'jsonb', nullable: true })
  permissionsSnapshot: Record<string, unknown> | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
