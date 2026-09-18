import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';
import { EscrowWalletKeyEntity } from './escrow-wallet-key.entity';

@Entity({ name: 'escrow_wallets' })
@Index('UQ_escrow_wallets_address_network', ['address', 'network'], {
  unique: true,
})
export class EscrowWalletEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  address: string;

  @Column({
    type: 'enum',
    enum: CurrencyCode,
    enumName: 'escrow_wallets_network_enum',
    default: CurrencyCode.TON,
  })
  network: CurrencyCode;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => EscrowWalletKeyEntity, (key) => key.wallet)
  key: EscrowWalletKeyEntity;
}
