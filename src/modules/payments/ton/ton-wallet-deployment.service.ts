import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Address,
  internal,
  SendMode,
  TonClient,
  WalletContractV4,
} from '@ton/ton';

type DeploymentOptions = {
  publicKeyHex: string;
  secretKeyHex: string;
  address: string;
};

@Injectable()
export class TonWalletDeploymentService {
  private readonly client: TonClient;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('TONCENTER_RPC');
    const apiKey = this.configService.get<string>('TONCENTER_API_KEY');
    if (!endpoint) {
      throw new Error('TONCENTER_RPC is not configured');
    }
    this.client = new TonClient({ endpoint, apiKey });
  }

  async ensureDeployed(options: DeploymentOptions): Promise<boolean> {
    const parsed = Address.parse(options.address);
    const state = await this.client.getContractState(parsed);

    if (state.state === 'active') {
      return true;
    }

    const balance = BigInt(state.balance ?? 0);
    if (balance <= 0n) {
      return false;
    }

    const publicKey = Buffer.from(options.publicKeyHex, 'hex');
    const secretKey = Buffer.from(options.secretKeyHex, 'hex');
    const contract = this.client.open(
      WalletContractV4.create({ workchain: 0, publicKey }),
    );

    await contract.sendTransfer({
      seqno: 0,
      secretKey,
      messages: [],
      sendMode: SendMode.PAY_GAS_SEPARATELY,
    });

    return true;
  }

  async getBalance(address: string): Promise<bigint> {
    const parsed = Address.parse(address);
    const state = await this.client.getContractState(parsed);
    return BigInt(state.balance ?? 0);
  }
}
