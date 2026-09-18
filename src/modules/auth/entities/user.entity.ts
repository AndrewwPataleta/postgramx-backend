import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  BaseEntity,
  ManyToMany,
  JoinTable,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity({ name: 'users' })
export class User extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  username?: string;

  @Column({ nullable: true, unique: true })
  email?: string | null;

  @Column({ nullable: true })
  telegramId?: string;

  @Column({ nullable: true })
  firstName?: string;

  @Column({ nullable: true })
  lastName?: string;

  @Column({ nullable: true })
  avatar?: string;

  @Column({ nullable: true })
  lang: string;

  @Column({ default: false })
  isPremium: boolean;

  @Column({ default: false })
  isActive: boolean;

  @Column({ nullable: true })
  platformType: string;

  @Column({ nullable: true })
  authType?: string;

  @Column({ nullable: true })
  fbPushToken?: string;

  @Column({ nullable: true })
  timeZone?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
