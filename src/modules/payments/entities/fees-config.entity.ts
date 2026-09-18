import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'fees_config' })
export class FeesConfigEntity {
  @PrimaryColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'boolean', default: true })
  feesEnabled: boolean;

  @Column({ type: 'text' })
  payoutServiceFeeMode: string;

  @Column({ type: 'bigint' })
  payoutServiceFeeFixedNano: string;

  @Column({ type: 'bigint' })
  payoutServiceFeeBps: string;

  @Column({ type: 'bigint' })
  payoutServiceFeeMinNano: string;

  @Column({ type: 'bigint', nullable: true })
  payoutServiceFeeMaxNano: string | null;

  @Column({ type: 'text' })
  payoutNetworkFeeMode: string;

  @Column({ type: 'bigint' })
  payoutNetworkFeeFixedNano: string;

  @Column({ type: 'bigint' })
  payoutNetworkFeeMinNano: string;

  @Column({ type: 'bigint', nullable: true })
  payoutNetworkFeeMaxNano: string | null;

  @Column({ type: 'bigint', nullable: true })
  payoutMinNetAmountNano: string | null;

  @Column({ type: 'text' })
  feeRevenueStrategy: string;

  @Column({ type: 'text', nullable: true })
  feeRevenueAddress: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
