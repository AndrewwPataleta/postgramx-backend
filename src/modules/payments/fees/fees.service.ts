import { Injectable, Optional } from '@nestjs/common';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';
import { PayoutErrorCode } from '../../../common/constants/errors/error-codes.constants';
import { PayoutServiceError } from '../payouts/errors/payout-service.error';
import { TonHotWalletService } from '../ton/ton-hot-wallet.service';
import { FeesConfigService } from './fees-config.service';

export type PayoutFeeBreakdown = {
  feesEnabled: boolean;
  serviceFeeMode: string;
  serviceFeeBps: string;
  serviceFeeFixedNano: string;
  serviceFeeMinNano: string;
  serviceFeeMaxNano?: string;
  networkFeeMode: string;
  networkFeeFixedNano: string;
  networkFeeMinNano: string;
  networkFeeMaxNano?: string;
  networkFeeEstimated: boolean;
};

export type PayoutFeeResult = {
  serviceFeeNano: string;
  networkFeeNano: string;
  totalDebitNano: string;
  policyVersion: number;
  breakdown: PayoutFeeBreakdown;
};

@Injectable()
export class FeesService {
  private static readonly POLICY_VERSION = 1;

  constructor(
    private readonly feesConfigService: FeesConfigService,
    @Optional() private readonly tonHotWalletService?: TonHotWalletService,
  ) {}

  async computePayoutFees(options: {
    amountNano: string;
    currency?: CurrencyCode;
    destinationAddress?: string;
  }): Promise<PayoutFeeResult> {
    const config = await this.feesConfigService.getConfig();
    const amount = BigInt(options.amountNano ?? '0');

    if (config.payoutUserReceivesFullAmount) {
      return {
        serviceFeeNano: '0',
        networkFeeNano: '0',
        totalDebitNano: amount.toString(),
        policyVersion: FeesService.POLICY_VERSION,
        breakdown: {
          feesEnabled: false,
          serviceFeeMode: config.payoutServiceFeeMode,
          serviceFeeBps: config.payoutServiceFeeBps,
          serviceFeeFixedNano: config.payoutServiceFeeFixedNano,
          serviceFeeMinNano: config.payoutServiceFeeMinNano,
          serviceFeeMaxNano: config.payoutServiceFeeMaxNano,
          networkFeeMode: config.payoutNetworkFeeMode,
          networkFeeFixedNano: config.payoutNetworkFeeFixedNano,
          networkFeeMinNano: config.payoutNetworkFeeMinNano,
          networkFeeMaxNano: config.payoutNetworkFeeMaxNano,
          networkFeeEstimated: false,
        },
      };
    }

    if (!config.feesEnabled) {
      return {
        serviceFeeNano: '0',
        networkFeeNano: '0',
        totalDebitNano: amount.toString(),
        policyVersion: FeesService.POLICY_VERSION,
        breakdown: {
          feesEnabled: false,
          serviceFeeMode: config.payoutServiceFeeMode,
          serviceFeeBps: config.payoutServiceFeeBps,
          serviceFeeFixedNano: config.payoutServiceFeeFixedNano,
          serviceFeeMinNano: config.payoutServiceFeeMinNano,
          serviceFeeMaxNano: config.payoutServiceFeeMaxNano,
          networkFeeMode: config.payoutNetworkFeeMode,
          networkFeeFixedNano: config.payoutNetworkFeeFixedNano,
          networkFeeMinNano: config.payoutNetworkFeeMinNano,
          networkFeeMaxNano: config.payoutNetworkFeeMaxNano,
          networkFeeEstimated: false,
        },
      };
    }

    const serviceFee = this.computeServiceFeeNano(amount, config);
    const { fee: networkFee, estimated } = await this.computeNetworkFeeNano(
      amount,
      options.destinationAddress,
      config,
    );

    const totalDebit = amount + serviceFee + networkFee;

    return {
      serviceFeeNano: serviceFee.toString(),
      networkFeeNano: networkFee.toString(),
      totalDebitNano: totalDebit.toString(),
      policyVersion: FeesService.POLICY_VERSION,
      breakdown: {
        feesEnabled: true,
        serviceFeeMode: config.payoutServiceFeeMode,
        serviceFeeBps: config.payoutServiceFeeBps,
        serviceFeeFixedNano: config.payoutServiceFeeFixedNano,
        serviceFeeMinNano: config.payoutServiceFeeMinNano,
        serviceFeeMaxNano: config.payoutServiceFeeMaxNano,
        networkFeeMode: config.payoutNetworkFeeMode,
        networkFeeFixedNano: config.payoutNetworkFeeFixedNano,
        networkFeeMinNano: config.payoutNetworkFeeMinNano,
        networkFeeMaxNano: config.payoutNetworkFeeMaxNano,
        networkFeeEstimated: estimated,
      },
    };
  }

  async validatePayout(options: {
    amountNano: string;
    withdrawableNano: string;
    currency?: CurrencyCode;
    destinationAddress?: string;
  }): Promise<PayoutFeeResult> {
    const amount = BigInt(options.amountNano ?? '0');
    if (amount <= 0n) {
      throw new PayoutServiceError(PayoutErrorCode.INVALID_AMOUNT);
    }

    const config = await this.feesConfigService.getConfig();
    if (!config.payoutUserReceivesFullAmount) {
      const minNet = config.payoutMinNetAmountNano
        ? BigInt(config.payoutMinNetAmountNano)
        : null;
      if (minNet !== null && amount < minNet) {
        throw new PayoutServiceError(PayoutErrorCode.INVALID_AMOUNT);
      }
    }

    const fees = await this.computePayoutFees({
      amountNano: options.amountNano,
      currency: options.currency,
      destinationAddress: options.destinationAddress,
    });

    if (BigInt(fees.totalDebitNano) > BigInt(options.withdrawableNano)) {
      throw new PayoutServiceError(PayoutErrorCode.INSUFFICIENT_BALANCE, {
        availableNano: options.withdrawableNano,
        requiredNano: fees.totalDebitNano,
      });
    }

    return fees;
  }

  async payoutReceivesFullAmount(): Promise<boolean> {
    const config = await this.feesConfigService.getConfig();
    return config.payoutUserReceivesFullAmount;
  }

  private computeServiceFeeNano(
    amount: bigint,
    config: Awaited<ReturnType<FeesConfigService['getConfig']>>,
  ): bigint {
    if (amount <= 0n) {
      return 0n;
    }
    let fee: bigint;
    if (config.payoutServiceFeeMode === 'FIXED') {
      fee = BigInt(config.payoutServiceFeeFixedNano);
    } else {
      const bps = BigInt(config.payoutServiceFeeBps);
      fee = this.ceilDiv(amount * bps, 10000n);
    }

    fee = this.applyMinMax(
      fee,
      config.payoutServiceFeeMinNano,
      config.payoutServiceFeeMaxNano,
    );
    return fee;
  }

  private async computeNetworkFeeNano(
    amount: bigint,
    destinationAddress: string | undefined,
    config: Awaited<ReturnType<FeesConfigService['getConfig']>>,
  ): Promise<{ fee: bigint; estimated: boolean }> {
    let fee = BigInt(config.payoutNetworkFeeFixedNano);
    let estimated = false;

    if (config.payoutNetworkFeeMode === 'ESTIMATE') {
      const estimator = (this.tonHotWalletService as any)
        ?.estimateTransferFee as
        | ((to: string, amount: bigint) => Promise<bigint>)
        | undefined;
      if (estimator && destinationAddress) {
        try {
          fee = await estimator(destinationAddress, amount);
          estimated = true;
        } catch {
          fee = BigInt(config.payoutNetworkFeeFixedNano);
        }
      }
    }

    fee = this.applyMinMax(
      fee,
      config.payoutNetworkFeeMinNano,
      config.payoutNetworkFeeMaxNano,
    );
    return { fee, estimated };
  }

  private applyMinMax(
    value: bigint,
    minNano?: string,
    maxNano?: string,
  ): bigint {
    let result = value;
    if (minNano !== undefined) {
      const min = BigInt(minNano);
      if (result < min) {
        result = min;
      }
    }
    if (maxNano !== undefined) {
      const max = BigInt(maxNano);
      if (result > max) {
        result = max;
      }
    }
    return result;
  }

  private ceilDiv(numerator: bigint, denominator: bigint): bigint {
    if (numerator === 0n) {
      return 0n;
    }
    return (numerator + denominator - 1n) / denominator;
  }
}
