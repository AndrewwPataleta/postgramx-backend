import { Injectable, Logger } from '@nestjs/common';
import { DealWalletFactory } from '../../ton/wallet.factory';
import { WalletScope } from '../types/wallet-scope.enum';
import { TonWalletDeploymentService } from '../../ton/ton-wallet-deployment.service';

export type WalletGenerationOptions = {
  scope: WalletScope;
  dealId?: string;
  userId?: string;
};

export type GeneratedWallet = {
  address: string;
  metadata?: Record<string, unknown>;
  secret?: string;
};

@Injectable()
export class TonWalletProvider {
  private readonly logger = new Logger(TonWalletProvider.name);

  constructor(
    private readonly dealWalletFactory: DealWalletFactory,
    private readonly tonWalletDeploymentService: TonWalletDeploymentService,
  ) {}

  async generateAddress(
    options: WalletGenerationOptions,
  ): Promise<GeneratedWallet> {
    const wallet = await this.dealWalletFactory.createNewDealWallet();

    return {
      address: wallet.address,
      secret: JSON.stringify({
        scope: options.scope,
        dealId: options.dealId,
        userId: options.userId,
        mnemonic: wallet.mnemonic,
        publicKeyHex: wallet.publicKeyHex,
        secretKeyHex: wallet.secretKeyHex,
        address: wallet.address,
      }),
      metadata: {
        publicKeyHex: wallet.publicKeyHex,
      },
    };
  }
}
