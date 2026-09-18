import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeesConfigService } from './fees/fees-config.service';
import { FeesConfigEntity } from './entities/fees-config.entity';
import { LiquidityConfigEntity } from './entities/liquidity-config.entity';
import { LiquidityConfigService } from './processing/liquidity-config.service';

@Injectable()
export class PaymentsConfigSeedService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsConfigSeedService.name);

  constructor(
    @InjectRepository(FeesConfigEntity)
    private readonly feesConfigRepository: Repository<FeesConfigEntity>,
    @InjectRepository(LiquidityConfigEntity)
    private readonly liquidityConfigRepository: Repository<LiquidityConfigEntity>,
    private readonly feesConfigService: FeesConfigService,
    private readonly liquidityConfigService: LiquidityConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedFeesConfig();
    await this.seedLiquidityConfig();
  }

  private async seedFeesConfig(): Promise<void> {
    const existing = await this.feesConfigRepository.findOne({
      where: { id: 1 },
    });
    if (existing) {
      return;
    }
    const defaults = this.feesConfigService.buildSeedConfig();
    const entity = this.feesConfigRepository.create({
      id: 1,
      feesEnabled: defaults.feesEnabled,
      payoutServiceFeeMode: defaults.payoutServiceFeeMode,
      payoutServiceFeeFixedNano: defaults.payoutServiceFeeFixedNano,
      payoutServiceFeeBps: defaults.payoutServiceFeeBps,
      payoutServiceFeeMinNano: defaults.payoutServiceFeeMinNano,
      payoutServiceFeeMaxNano: defaults.payoutServiceFeeMaxNano ?? null,
      payoutNetworkFeeMode: defaults.payoutNetworkFeeMode,
      payoutNetworkFeeFixedNano: defaults.payoutNetworkFeeFixedNano,
      payoutNetworkFeeMinNano: defaults.payoutNetworkFeeMinNano,
      payoutNetworkFeeMaxNano: defaults.payoutNetworkFeeMaxNano ?? null,
      payoutMinNetAmountNano: defaults.payoutMinNetAmountNano ?? null,
      feeRevenueStrategy: defaults.feeRevenueStrategy,
      feeRevenueAddress: defaults.feeRevenueAddress ?? null,
    });
    await this.feesConfigRepository.save(entity);
    this.logger.log('Seeded fees configuration defaults.');
  }

  private async seedLiquidityConfig(): Promise<void> {
    const existing = await this.liquidityConfigRepository.findOne({
      where: { id: 1 },
    });
    if (existing) {
      return;
    }
    const defaults = this.liquidityConfigService.buildSeedConfig();
    const entity = this.liquidityConfigRepository.create({
      id: 1,
      sweepMaxGasReserveNano: defaults.sweepMaxGasReserveNano.toString(),
      sweepMinWithdrawNano: defaults.sweepMinWithdrawNano.toString(),
    });
    await this.liquidityConfigRepository.save(entity);
    this.logger.log('Seeded liquidity configuration defaults.');
  }
}
