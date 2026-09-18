import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { CreativeStatus } from '../../../common/constants/deals/creative-status.constants';
import { DealEntity } from './deal.entity';

@Entity({ name: 'deal_creatives' })
@Unique('UQ_deal_creatives_deal_version', ['dealId', 'version'])
@Index('IDX_deal_creatives_deal_version', ['dealId', 'version'])
@Index('IDX_deal_creatives_status', ['status'])
export class DealCreativeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  dealId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({
    type: 'enum',
    enum: CreativeStatus,
    enumName: 'deal_creatives_status_enum',
    default: CreativeStatus.DRAFT,
  })
  status: CreativeStatus;

  @Column({ type: 'uuid', nullable: true })
  submittedByUserId: string | null;

  @Column({ type: 'bigint', nullable: true })
  botChatId: string | null;

  @Column({ type: 'bigint', nullable: true })
  botMessageId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  adminComment: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => DealEntity, (deal) => deal.creatives, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'dealId' })
  deal: DealEntity;
}
