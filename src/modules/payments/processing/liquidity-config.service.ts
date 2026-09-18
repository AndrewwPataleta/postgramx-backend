import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { LiquidityConfigEntity } from '../entities/liquidity-config.entity';

export type LiquidityConfig = {
  sweepMaxGasReserveNano: bigint;
  sweepMinWithdrawNano: bigint;
};

@Injectable()
export class LiquidityConfigService {
  constructor(
    @InjectRepository(LiquidityConfigEntity)
    private readonly liquidityConfigRepository: Repository<LiquidityConfigEntity>,
    private readonly configService: ConfigService,
  ) {}

  async getConfig(): Promise<LiquidityConfig> {
    const stored = await this.liquidityConfigRepository.findOne({
      where: { id: 1 },
    });
    const defaults = this.buildSeedConfig();
    const fallbackMaxGas = defaults.sweepMaxGasReserveNano;
    const fallbackMinWithdraw = defaults.sweepMinWithdrawNano;

    if (!stored) {
      return {
        sweepMaxGasReserveNano: fallbackMaxGas,
        sweepMinWithdrawNano: fallbackMinWithdraw,
      };
    }

    return {
      sweepMaxGasReserveNano: stored.sweepMaxGasReserveNano
        ? BigInt(stored.sweepMaxGasReserveNano)
        : fallbackMaxGas,
      sweepMinWithdrawNano: stored.sweepMinWithdrawNano
        ? BigInt(stored.sweepMinWithdrawNano)
        : fallbackMinWithdraw,
    };
  }

  buildSeedConfig(): LiquidityConfig {
    return {
      sweepMaxGasReserveNano: this.getBigInt(
        'SWEEP_MAX_GAS_RESERVE_NANO',
        50_000_000n,
      ),
      sweepMinWithdrawNano: this.getBigInt(
        'SWEEP_MIN_WITHDRAW_NANO',
        20_000_000n,
      ),
    };
  }

  private getBigInt(key: string, fallback: bigint): bigint {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }
    try {
      const parsed = BigInt(raw);
      if (parsed < 0n) {
        return fallback;
      }
      return parsed;
    } catch {
      return fallback;
    }
  }
}
