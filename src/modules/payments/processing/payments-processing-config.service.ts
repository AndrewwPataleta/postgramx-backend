import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type AdminAlertLevel = 'info' | 'warn' | 'error';

@Injectable()
export class PaymentsProcessingConfigService {
  private readonly logger = new Logger('PaymentsProcessingConfig');

  readonly adminAlertsEnabled: boolean;
  readonly adminAlertsChatId: string | null;
  readonly adminAlertsThreadId: number | null;
  readonly adminAlertsMinLevel: AdminAlertLevel;

  readonly hotWalletEnabled: boolean;
  readonly hotWalletAddress: string | null;
  readonly hotWalletMnemonic: string | null;
  readonly hotWalletMinReserveNano: bigint;
  readonly hotWalletLowLiquidityThresholdNano: bigint;

  readonly payoutCronEverySeconds: number;
  readonly payoutBatchLimit: number;
  readonly payoutDryRun: boolean;

  readonly sweepFallbackEnabled: boolean;
  readonly sweepMaxGasReserveNano: bigint;
  readonly sweepMinWithdrawNano: bigint;
  readonly sweepOnlyForThisDeal: boolean;
  readonly sweepMaxRetries: number;

  readonly toncenterRpc: string | null;
  readonly toncenterApiKey: string | null;

  constructor(private readonly configService: ConfigService) {
    this.adminAlertsEnabled = this.getBoolean('ADMIN_ALERTS_ENABLED', false);
    this.adminAlertsChatId =
      this.configService.get<string>('ADMIN_ALERTS_CHAT_ID') ?? null;
    this.adminAlertsThreadId = this.getOptionalNumber('ADMIN_ALERTS_THREAD_ID');
    this.adminAlertsMinLevel = this.getLevel('ADMIN_ALERTS_MIN_LEVEL', 'warn');

    this.hotWalletEnabled = this.getBoolean('HOT_WALLET_ENABLED', true);
    this.hotWalletAddress =
      this.configService.get<string>('HOT_WALLET_ADDRESS') ?? null;
    this.hotWalletMnemonic =
      this.configService.get<string>('HOT_WALLET_MNEMONIC') ?? null;
    this.hotWalletMinReserveNano = this.getBigInt(
      'HOT_WALLET_MIN_RESERVE_NANO',
      200_000_000n,
    );
    this.hotWalletLowLiquidityThresholdNano = this.getBigInt(
      'HOT_WALLET_LOW_LIQUIDITY_THRESHOLD_NANO',
      0n,
    );

    this.payoutCronEverySeconds = this.getNumber(
      'PAYOUT_CRON_EVERY_SECONDS',
      60,
    );
    this.payoutBatchLimit = this.getNumber('PAYOUT_BATCH_LIMIT', 20);
    this.payoutDryRun = this.getBoolean('PAYOUT_DRY_RUN', false);

    this.sweepFallbackEnabled = this.getBoolean(
      'SWEEP_FALLBACK_ENABLED',
      false,
    );
    this.sweepMaxGasReserveNano = this.getBigInt(
      'SWEEP_MAX_GAS_RESERVE_NANO',
      50_000_000n,
    );
    this.sweepMinWithdrawNano = this.getBigInt(
      'SWEEP_MIN_WITHDRAW_NANO',
      20_000_000n,
    );
    this.sweepOnlyForThisDeal = this.getBoolean(
      'SWEEP_ONLY_FOR_THIS_DEAL',
      true,
    );
    this.sweepMaxRetries = this.getNumber('SWEEP_MAX_RETRIES', 3);

    this.toncenterRpc = this.configService.get<string>('TONCENTER_RPC') ?? null;
    this.toncenterApiKey =
      this.configService.get<string>('TONCENTER_API_KEY') ?? null;

    this.validate();
    this.logLoaded();
  }

  private validate(): void {
    if (this.adminAlertsEnabled && !this.adminAlertsChatId) {
      throw new Error(
        'ADMIN_ALERTS_CHAT_ID is required when ADMIN_ALERTS_ENABLED is true',
      );
    }

    if (this.hotWalletEnabled) {
      if (!this.hotWalletAddress) {
        throw new Error('HOT_WALLET_ADDRESS is required when enabled');
      }
      if (!this.hotWalletMnemonic) {
        throw new Error('HOT_WALLET_MNEMONIC is required when enabled');
      }
    }

    if (!this.toncenterRpc) {
      throw new Error('TONCENTER_RPC is required for TON operations');
    }

    if (this.sweepFallbackEnabled) {
      const masterKey = this.configService.get<string>('WALLET_MASTER_KEY');
      if (!masterKey) {
        throw new Error(
          'WALLET_MASTER_KEY is required when sweep fallback is enabled',
        );
      }
      if (!this.hotWalletEnabled) {
        throw new Error(
          'HOT_WALLET_ENABLED must be true when sweep fallback is enabled',
        );
      }
    }
  }

  private logLoaded(): void {
    this.logger.log(
      [
        'Payments processing config loaded',
        `adminAlertsEnabled=${this.adminAlertsEnabled}`,
        `hotWalletEnabled=${this.hotWalletEnabled}`,
        `payoutCronEverySeconds=${this.payoutCronEverySeconds}`,
        `payoutBatchLimit=${this.payoutBatchLimit}`,
        `sweepFallbackEnabled=${this.sweepFallbackEnabled}`,
        `payoutDryRun=${this.payoutDryRun}`,
      ].join(' | '),
    );
  }

  private getBoolean(key: string, fallback: boolean): boolean {
    const raw = this.configService.get<string>(key);
    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }
    return ['true', '1', 'yes', 'y'].includes(raw.toLowerCase());
  }

  private getNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private getOptionalNumber(key: string): number | null {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
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

  private getLevel(key: string, fallback: AdminAlertLevel): AdminAlertLevel {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }
    if (raw === 'info' || raw === 'warn' || raw === 'error') {
      return raw;
    }
    return fallback;
  }
}
