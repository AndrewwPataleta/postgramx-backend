import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EscrowWalletEntity } from './escrow-wallet.entity';

@Entity({ name: 'escrow_wallet_keys' })
export class EscrowWalletKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  walletId: string;

  @Column({ type: 'text' })
  encryptedSecret: string;

  @Column({ type: 'int', default: 1 })
  keyVersion: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => EscrowWalletEntity, (wallet) => wallet.key, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'walletId' })
  wallet: EscrowWalletEntity;
}
