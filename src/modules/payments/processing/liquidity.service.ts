import { Injectable, Logger } from '@nestjs/common';
import { Address, TonClient } from '@ton/ton';
import { PaymentsProcessingConfigService } from './payments-processing-config.service';
import { LiquidityConfigService } from './liquidity-config.service';

@Injectable()
export class LiquidityService {
  private readonly logger = new Logger(LiquidityService.name);
  private readonly client: TonClient;

  constructor(
    private readonly config: PaymentsProcessingConfigService,
    private readonly liquidityConfigService: LiquidityConfigService,
  ) {
    const endpoint = this.config.toncenterRpc;
    if (!endpoint) {
      throw new Error('TONCENTER_RPC is not configured');
    }
    const apiKey = this.config.toncenterApiKey ?? undefined;
    this.client = new TonClient({ endpoint, apiKey });
  }

  async getHotBalanceNano(): Promise<bigint> {
    if (!this.config.hotWalletEnabled || !this.config.hotWalletAddress) {
      return 0n;
    }
    const state = await this.client.getContractState(
      Address.parse(this.config.hotWalletAddress),
    );
    return BigInt(state.balance ?? 0);
  }

  async canSpendFromHot(amountNano: bigint): Promise<{
    canSpend: boolean;
    balanceNano: bigint;
    availableNano: bigint;
  }> {
    const balance = await this.getHotBalanceNano();
    const available = balance - this.config.hotWalletMinReserveNano;
    const canSpend = available >= amountNano;
    return { canSpend, balanceNano: balance, availableNano: available };
  }

  async getDepositWalletBalanceState(
    walletAddress: string,
  ): Promise<{ balanceNano: bigint; isDeployed: boolean }> {
    const parsed = Address.parse(walletAddress);
    const state = await this.client.getContractState(parsed);
    const balanceNano = BigInt(state.balance ?? 0);
    const isDeployed = state.state === 'active';
    return { balanceNano, isDeployed };
  }

  async computeMaxSweepableNano(balanceNano: bigint): Promise<bigint> {
    const sweepConfig = await this.liquidityConfigService.getConfig();
    const max = balanceNano - sweepConfig.sweepMaxGasReserveNano;
    return max > 0n ? max : 0n;
  }
}
