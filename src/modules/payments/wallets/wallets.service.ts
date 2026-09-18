import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { EscrowWalletEntity } from '../entities/escrow-wallet.entity';
import { EscrowWalletKeyEntity } from '../entities/escrow-wallet-key.entity';
import { TonWalletProvider } from './providers/ton-wallet.provider';
import { KeyEncryptionService } from './crypto/key-encryption.service';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';
import { WalletScope } from './types/wallet-scope.enum';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(EscrowWalletEntity)
    private readonly escrowWalletRepository: Repository<EscrowWalletEntity>,
    @InjectRepository(EscrowWalletKeyEntity)
    private readonly escrowWalletKeyRepository: Repository<EscrowWalletKeyEntity>,
    private readonly tonWalletProvider: TonWalletProvider,
    private readonly keyEncryptionService: KeyEncryptionService,
  ) {}

  async createEscrowWallet(
    dealId: string,
    manager?: EntityManager,
  ): Promise<EscrowWalletEntity> {
    const walletRepository = manager
      ? manager.getRepository(EscrowWalletEntity)
      : this.escrowWalletRepository;
    const keyRepository = manager
      ? manager.getRepository(EscrowWalletKeyEntity)
      : this.escrowWalletKeyRepository;

    const generated = await this.tonWalletProvider.generateAddress({
      scope: WalletScope.DEAL,
      dealId,
    });

    const existingWallet = await walletRepository.findOne({
      where: {
        address: generated.address,
        network: CurrencyCode.TON,
      },
    });

    if (existingWallet) {
      await this.ensureWalletKey(
        existingWallet.id,
        generated.secret,
        keyRepository,
      );
      return existingWallet;
    }

    try {
      const wallet = walletRepository.create({
        address: generated.address,
        network: CurrencyCode.TON,
      });
      const savedWallet = await walletRepository.save(wallet);
      await this.ensureWalletKey(
        savedWallet.id,
        generated.secret,
        keyRepository,
      );
      return savedWallet;
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        error.message.includes('UQ_escrow_wallets_address_network')
      ) {
        const conflictedWallet = await walletRepository.findOneOrFail({
          where: {
            address: generated.address,
            network: CurrencyCode.TON,
          },
        });
        await this.ensureWalletKey(
          conflictedWallet.id,
          generated.secret,
          keyRepository,
        );
        return conflictedWallet;
      }

      throw error;
    }
  }

  private async ensureWalletKey(
    walletId: string,
    secret: string | undefined,
    keyRepository: Repository<EscrowWalletKeyEntity>,
  ): Promise<void> {
    if (!secret) {
      return;
    }

    const existingKey = await keyRepository.findOne({
      where: { walletId },
    });

    if (existingKey) {
      return;
    }

    const encryptedSecret = this.keyEncryptionService.encryptSecret(secret);
    const walletKey = keyRepository.create({
      walletId,
      encryptedSecret,
      keyVersion: 1,
    });
    await keyRepository.save(walletKey);
  }
}
