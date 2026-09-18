import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserWalletEntity } from '../entities/user-wallet.entity';
import { TonHotWalletService } from '../ton/ton-hot-wallet.service';

@Injectable()
export class UserWalletService {
  constructor(
    @InjectRepository(UserWalletEntity)
    private readonly userWalletRepository: Repository<UserWalletEntity>,
    private readonly tonHotWalletService: TonHotWalletService,
  ) {}

  async getWallet(userId: string): Promise<UserWalletEntity | null> {
    return this.userWalletRepository.findOne({
      where: { userId, isActive: true },
    });
  }

  async setWallet(
    userId: string,
    tonAddress: string,
  ): Promise<UserWalletEntity> {
    this.tonHotWalletService.validateDestinationAddress(tonAddress);

    const existing = await this.userWalletRepository.findOne({
      where: { userId },
    });

    if (existing) {
      existing.tonAddress = tonAddress;
      existing.isActive = true;
      return this.userWalletRepository.save(existing);
    }

    const created = this.userWalletRepository.create({
      userId,
      tonAddress,
      isActive: true,
    });

    return this.userWalletRepository.save(created);
  }
}
