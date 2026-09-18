import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Address, internal, TonClient, WalletContractV4 } from '@ton/ton';
import { Repository } from 'typeorm';
import { EscrowWalletEntity } from '../entities/escrow-wallet.entity';
import { EscrowWalletKeyEntity } from '../entities/escrow-wallet-key.entity';
import { KeyEncryptionService } from '../wallets/crypto/key-encryption.service';

type EscrowWalletSecret = {
  publicKeyHex: string;
  secretKeyHex: string;
  address: string;
};

@Injectable()
export class TonPayoutService {
  private readonly client: TonClient;

  constructor(
    @InjectRepository(EscrowWalletEntity)
    private readonly escrowWalletRepository: Repository<EscrowWalletEntity>,
    @InjectRepository(EscrowWalletKeyEntity)
    private readonly escrowWalletKeyRepository: Repository<EscrowWalletKeyEntity>,
    private readonly keyEncryptionService: KeyEncryptionService,
    private readonly configService: ConfigService,
  ) {
    const endpoint = this.configService.get<string>('TONCENTER_RPC');
    const apiKey = this.configService.get<string>('TONCENTER_API_KEY');
    if (!endpoint) {
      throw new Error('TONCENTER_RPC is not configured');
    }
    this.client = new TonClient({ endpoint, apiKey });
  }

  validateDestinationAddress(destination: string): void {
    Address.parse(destination);
  }

  async sendFromEscrowWallet(options: {
    walletId: string;
    toAddress: string;
    amountNano: bigint;
  }): Promise<void> {
    const wallet = await this.escrowWalletRepository.findOne({
      where: { id: options.walletId },
    });
    if (!wallet) {
      throw new Error('Escrow wallet not found');
    }

    const walletKey = await this.escrowWalletKeyRepository.findOne({
      where: { walletId: wallet.id },
    });
    if (!walletKey) {
      throw new Error('Escrow wallet key not found');
    }

    const decrypted = this.keyEncryptionService.decryptSecret(
      walletKey.encryptedSecret,
    );
    const secret = JSON.parse(decrypted) as EscrowWalletSecret;

    if (!secret.publicKeyHex || !secret.secretKeyHex || !secret.address) {
      throw new Error('Escrow wallet secret is incomplete');
    }

    if (secret.address !== wallet.address) {
      throw new Error('Escrow wallet address mismatch');
    }

    await this.assertWalletReady(wallet.address, options.amountNano);

    const publicKey = Buffer.from(secret.publicKeyHex, 'hex');
    const secretKey = Buffer.from(secret.secretKeyHex, 'hex');

    const contract = this.client.open(
      WalletContractV4.create({ workchain: 0, publicKey }),
    );
    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
      seqno,
      secretKey,
      messages: [
        internal({
          to: Address.parse(options.toAddress),
          value: options.amountNano,
          bounce: false,
        }),
      ],
    });
  }

  private async assertWalletReady(
    address: string,
    amountNano: bigint,
  ): Promise<void> {
    const parsed = Address.parse(address);
    const state = await this.client.getContractState(parsed);
    if (state.state !== 'active') {
      throw new Error('Escrow wallet is not deployed');
    }

    const balance = BigInt(state.balance ?? 0);
    if (balance < amountNano) {
      throw new Error('Escrow wallet balance is insufficient');
    }
  }
}
