import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeesConfigEntity } from '../entities/fees-config.entity';

export type FeeMode = 'FIXED' | 'BPS';
export type NetworkFeeMode = 'FIXED' | 'ESTIMATE';
export type FeeRevenueStrategy = 'LEDGER_ONLY' | 'LEDGER_AND_TRANSFER';

export type FeesConfig = {
  feesEnabled: boolean;
  payoutUserReceivesFullAmount: boolean;
  payoutServiceFeeMode: FeeMode;
  payoutServiceFeeFixedNano: string;
  payoutServiceFeeBps: string;
  payoutServiceFeeMinNano: string;
  payoutServiceFeeMaxNano?: string;
  payoutNetworkFeeMode: NetworkFeeMode;
  payoutNetworkFeeFixedNano: string;
  payoutNetworkFeeMinNano: string;
  payoutNetworkFeeMaxNano?: string;
  payoutMinNetAmountNano?: string;
  feeRevenueStrategy: FeeRevenueStrategy;
  feeRevenueAddress?: string;
};

@Injectable()
export class FeesConfigService {
  constructor(
    @InjectRepository(FeesConfigEntity)
    private readonly feesConfigRepository: Repository<FeesConfigEntity>,
    private readonly configService: ConfigService,
  ) {}

  async getConfig(): Promise<FeesConfig> {
    const stored = await this.feesConfigRepository.findOne({
      where: { id: 1 },
    });
    if (!stored) {
      return this.buildFromEnv();
    }
    const fallback = this.buildFromEnv();

    return {
      feesEnabled: stored.feesEnabled ?? fallback.feesEnabled,
      payoutUserReceivesFullAmount: fallback.payoutUserReceivesFullAmount,
      payoutServiceFeeMode: this.readEnumValue<FeeMode>(
        stored.payoutServiceFeeMode ?? fallback.payoutServiceFeeMode,
        ['FIXED', 'BPS'],
        fallback.payoutServiceFeeMode,
      ),
      payoutServiceFeeFixedNano:
        stored.payoutServiceFeeFixedNano ?? fallback.payoutServiceFeeFixedNano,
      payoutServiceFeeBps:
        stored.payoutServiceFeeBps ?? fallback.payoutServiceFeeBps,
      payoutServiceFeeMinNano:
        stored.payoutServiceFeeMinNano ?? fallback.payoutServiceFeeMinNano,
      payoutServiceFeeMaxNano:
        stored.payoutServiceFeeMaxNano ?? fallback.payoutServiceFeeMaxNano,
      payoutNetworkFeeMode: this.readEnumValue<NetworkFeeMode>(
        stored.payoutNetworkFeeMode ?? fallback.payoutNetworkFeeMode,
        ['FIXED', 'ESTIMATE'],
        fallback.payoutNetworkFeeMode,
      ),
      payoutNetworkFeeFixedNano:
        stored.payoutNetworkFeeFixedNano ?? fallback.payoutNetworkFeeFixedNano,
      payoutNetworkFeeMinNano:
        stored.payoutNetworkFeeMinNano ?? fallback.payoutNetworkFeeMinNano,
      payoutNetworkFeeMaxNano:
        stored.payoutNetworkFeeMaxNano ?? fallback.payoutNetworkFeeMaxNano,
      payoutMinNetAmountNano:
        stored.payoutMinNetAmountNano ?? fallback.payoutMinNetAmountNano,
      feeRevenueStrategy: this.readEnumValue<FeeRevenueStrategy>(
        stored.feeRevenueStrategy ?? fallback.feeRevenueStrategy,
        ['LEDGER_ONLY', 'LEDGER_AND_TRANSFER'],
        fallback.feeRevenueStrategy,
      ),
      feeRevenueAddress: stored.feeRevenueAddress ?? fallback.feeRevenueAddress,
    };
  }

  buildSeedConfig(): FeesConfig {
    return {
      feesEnabled: this.readBoolean('FEES_ENABLED', false),
      payoutUserReceivesFullAmount: this.readBoolean(
        'PAYOUT_USER_RECEIVES_FULL_AMOUNT',
        true,
      ),
      payoutServiceFeeMode: this.readEnum<FeeMode>(
        'PAYOUT_SERVICE_FEE_MODE',
        ['FIXED', 'BPS'],
        'BPS',
      ),
      payoutServiceFeeFixedNano: this.readNano(
        'PAYOUT_SERVICE_FEE_FIXED_NANO',
        '0',
      ),
      payoutServiceFeeBps: this.readNano('PAYOUT_SERVICE_FEE_BPS', '50'),
      payoutServiceFeeMinNano: this.readNano(
        'PAYOUT_SERVICE_FEE_MIN_NANO',
        '0',
      ),
      payoutServiceFeeMaxNano: this.readOptionalNano(
        'PAYOUT_SERVICE_FEE_MAX_NANO',
      ),
      payoutNetworkFeeMode: this.readEnum<NetworkFeeMode>(
        'PAYOUT_NETWORK_FEE_MODE',
        ['FIXED', 'ESTIMATE'],
        'FIXED',
      ),
      payoutNetworkFeeFixedNano: this.readNano(
        'PAYOUT_NETWORK_FEE_FIXED_NANO',
        '5000000',
      ),
      payoutNetworkFeeMinNano: this.readNano(
        'PAYOUT_NETWORK_FEE_MIN_NANO',
        '0',
      ),
      payoutNetworkFeeMaxNano: this.readOptionalNano(
        'PAYOUT_NETWORK_FEE_MAX_NANO',
      ),
      payoutMinNetAmountNano: this.readOptionalNano(
        'PAYOUT_MIN_NET_AMOUNT_NANO',
      ),
      feeRevenueStrategy: this.readEnum<FeeRevenueStrategy>(
        'FEE_REVENUE_STRATEGY',
        ['LEDGER_ONLY', 'LEDGER_AND_TRANSFER'],
        'LEDGER_ONLY',
      ),
      feeRevenueAddress: this.readOptionalString('FEE_REVENUE_ADDRESS'),
    };
  }

  private buildFromEnv(): FeesConfig {
    return this.buildSeedConfig();
  }

  private readBoolean(key: string, fallback: boolean): boolean {
    const value = this.configService.get<string>(key);
    if (value === undefined) {
      return fallback;
    }
    return value.toLowerCase() === 'true';
  }

  private readEnum<T extends string>(
    key: string,
    allowed: T[],
    fallback: T,
  ): T {
    const value = this.configService.get<string>(key);
    if (!value) {
      return fallback;
    }
    return allowed.includes(value as T) ? (value as T) : fallback;
  }

  private readEnumValue<T extends string>(
    value: string,
    allowed: T[],
    fallback: T,
  ): T {
    if (!value) {
      return fallback;
    }
    return allowed.includes(value as T) ? (value as T) : fallback;
  }

  private readNano(key: string, fallback: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      return fallback;
    }
    if (!/^\d+$/.test(value)) {
      throw new Error(`${key} must be a numeric string`);
    }
    return value;
  }

  private readOptionalNano(key: string): string | undefined {
    const value = this.configService.get<string>(key);
    if (!value) {
      return undefined;
    }
    if (!/^\d+$/.test(value)) {
      throw new Error(`${key} must be a numeric string`);
    }
    return value;
  }

  private readOptionalString(key: string): string | undefined {
    const value = this.configService.get<string>(key);
    if (!value) {
      return undefined;
    }
    return value;
  }
}
