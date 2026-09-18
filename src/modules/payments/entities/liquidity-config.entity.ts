import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'liquidity_config' })
export class LiquidityConfigEntity {
  @PrimaryColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'bigint' })
  sweepMaxGasReserveNano: string;

  @Column({ type: 'bigint' })
  sweepMinWithdrawNano: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
