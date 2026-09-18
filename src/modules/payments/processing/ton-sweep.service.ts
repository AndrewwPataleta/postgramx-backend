import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Address,
  internal,
  TonClient,
  WalletContractV4,
  WalletContractV5R1,
} from '@ton/ton';
import { Repository, DataSource } from 'typeorm';
import { EscrowWalletEntity } from '../entities/escrow-wallet.entity';
import { EscrowWalletKeyEntity } from '../entities/escrow-wallet-key.entity';
import { KeyEncryptionService } from '../wallets/crypto/key-encryption.service';
import { TonWalletDeploymentService } from '../ton/ton-wallet-deployment.service';
import { LiquidityService } from './liquidity.service';
import { LiquidityConfigService } from './liquidity-config.service';
import { PaymentsProcessingConfigService } from './payments-processing-config.service';
import { TonTransferEntity } from '../entities/ton-transfer.entity';
import { TonTransferStatus } from '../../../common/constants/payments/ton-transfer-status.constants';
import { TonTransferType } from '../../../common/constants/payments/ton-transfer-type.constants';
import {
  SweepFailedError,
  SweepNotWorthItError,
} from './payments-processing.errors';
import { withAdvisoryLock } from './advisory-lock';

type EscrowWalletSecret = {
  mnemonic?: string;
  publicKeyHex: string;
  secretKeyHex: string;
  address: string;
};

@Injectable()
export class TonSweepService {
  private readonly logger = new Logger('Sweep');
  private readonly client: TonClient;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(EscrowWalletEntity)
    private readonly escrowWalletRepository: Repository<EscrowWalletEntity>,
    @InjectRepository(EscrowWalletKeyEntity)
    private readonly escrowWalletKeyRepository: Repository<EscrowWalletKeyEntity>,
    @InjectRepository(TonTransferEntity)
    private readonly transferRepository: Repository<TonTransferEntity>,
    private readonly keyEncryptionService: KeyEncryptionService,
    private readonly tonWalletDeploymentService: TonWalletDeploymentService,
    private readonly liquidityService: LiquidityService,
    private readonly liquidityConfigService: LiquidityConfigService,
    private readonly config: PaymentsProcessingConfigService,
  ) {
    const endpoint = this.config.toncenterRpc;
    if (!endpoint) {
      throw new Error('TONCENTER_RPC is not configured');
    }
    this.client = new TonClient({
      endpoint,
      apiKey: this.config.toncenterApiKey ?? undefined,
    });
  }

  async sweepDepositToHot(params: {
    dealId: string;
    wallet: EscrowWalletEntity;
    needNano: bigint;
  }): Promise<{ amountNano: bigint; txHash: string | null } | null> {
    return (
      (await withAdvisoryLock(
        this.dataSource,
        `sweep:${params.dealId}`,
        async () => {
          const idempotencyKey = this.buildIdempotencyKey(
            params.dealId,
            params.wallet.id,
            params.needNano,
          );
          const sweepConfig = await this.liquidityConfigService.getConfig();
          try {
            const failedCount = await this.transferRepository.count({
              where: {
                dealId: params.dealId,
                type: TonTransferType.SWEEP_TO_HOT,
                status: TonTransferStatus.FAILED,
              },
            });
            if (failedCount >= this.config.sweepMaxRetries) {
              throw new SweepFailedError('Sweep retry limit reached');
            }

            const existing = await this.transferRepository.findOne({
              where: { idempotencyKey },
            });
            if (existing && existing.status !== TonTransferStatus.FAILED) {
              const amount = BigInt(existing.amountNano);
              return {
                amountNano: amount,
                txHash: existing.txHash ?? null,
              };
            }

            const secret = await this.loadWalletSecret(params.wallet.id);
            if (secret.address !== params.wallet.address) {
              throw new SweepFailedError('Escrow wallet address mismatch');
            }

            const state =
              await this.liquidityService.getDepositWalletBalanceState(
                params.wallet.address,
              );
            const wasDeployed = state.isDeployed;
            let balanceNano = state.balanceNano;
            if (!wasDeployed) {
              const deployed =
                await this.tonWalletDeploymentService.ensureDeployed({
                  publicKeyHex: secret.publicKeyHex,
                  secretKeyHex: secret.secretKeyHex,
                  address: secret.address,
                });
              if (!deployed) {
                throw new SweepFailedError('Escrow wallet deployment failed');
              }
              const refreshed =
                await this.liquidityService.getDepositWalletBalanceState(
                  params.wallet.address,
                );
              balanceNano = refreshed.balanceNano;
            }

            const reserveMultiplier = wasDeployed ? 1n : 2n;
            const gasReserve =
              sweepConfig.sweepMaxGasReserveNano * reserveMultiplier;
            const maxSweepable = balanceNano - gasReserve;
            const sweepable = maxSweepable > 0n ? maxSweepable : 0n;
            const amountNano =
              sweepable < params.needNano ? sweepable : params.needNano;

            if (amountNano < sweepConfig.sweepMinWithdrawNano) {
              throw new SweepNotWorthItError(
                `Sweep amount ${amountNano.toString()} below minimum`,
              );
            }

            this.logger.log(
              `Sweep prepared`,
              JSON.stringify({
                dealId: params.dealId,
                walletId: params.wallet.id,
                fromAddress: params.wallet.address,
                toAddress: this.config.hotWalletAddress,
                amountNano: amountNano.toString(),
                balanceNano: balanceNano.toString(),
                deployed: wasDeployed,
              }),
            );

            const now = new Date();
            const transfer = this.transferRepository.create({
              transactionId: null,
              dealId: params.dealId,
              escrowWalletId: params.wallet.id,
              idempotencyKey,
              type: TonTransferType.SWEEP_TO_HOT,
              status: this.config.payoutDryRun
                ? TonTransferStatus.SIMULATED
                : TonTransferStatus.CREATED,
              network: params.wallet.network,
              fromAddress: params.wallet.address,
              toAddress: this.config.hotWalletAddress ?? '',
              amountNano: amountNano.toString(),
              txHash: null,
              observedAt: now,
              raw: { dryRun: this.config.payoutDryRun },
            });

            if (this.config.payoutDryRun) {
              await this.transferRepository.save(transfer);
              this.logger.log(
                `Dry run sweep recorded for deal ${params.dealId}`,
              );
              return { amountNano, txHash: null };
            }

            const txHash = await this.sendFromEscrowWallet(secret, {
              toAddress: this.config.hotWalletAddress ?? '',
              amountNano,
            });

            transfer.txHash = txHash;
            transfer.status = TonTransferStatus.COMPLETED;
            await this.transferRepository.save(transfer);

            this.logger.log(`Sweep completed for deal ${params.dealId}`);

            return { amountNano, txHash };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            const existing = await this.transferRepository.findOne({
              where: { idempotencyKey },
            });
            if (existing) {
              await this.transferRepository.update(existing.id, {
                status: TonTransferStatus.FAILED,
                errorMessage: message,
                raw: { error: message },
              });
            } else {
              await this.transferRepository.save(
                this.transferRepository.create({
                  transactionId: null,
                  dealId: params.dealId,
                  escrowWalletId: params.wallet.id,
                  idempotencyKey,
                  type: TonTransferType.SWEEP_TO_HOT,
                  status: TonTransferStatus.FAILED,
                  network: params.wallet.network,
                  fromAddress: params.wallet.address,
                  toAddress: this.config.hotWalletAddress ?? '',
                  amountNano: '0',
                  txHash: null,
                  observedAt: new Date(),
                  errorMessage: message,
                  raw: { error: message },
                }),
              );
            }
            throw error;
          }
        },
      )) ?? null
    );
  }

  private async loadWalletSecret(
    walletId: string,
  ): Promise<EscrowWalletSecret> {
    const walletKey = await this.escrowWalletKeyRepository.findOne({
      where: { walletId },
    });
    if (!walletKey) {
      throw new SweepFailedError('Escrow wallet key not found');
    }
    const decrypted = this.keyEncryptionService.decryptSecret(
      walletKey.encryptedSecret,
    );
    return JSON.parse(decrypted) as EscrowWalletSecret;
  }

  private async sendFromEscrowWallet(
    secret: EscrowWalletSecret,
    options: { toAddress: string; amountNano: bigint },
  ): Promise<string | null> {
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
    return null;
  }

  private buildIdempotencyKey(
    dealId: string,
    escrowWalletId: string,
    needNano: bigint,
  ): string {
    return `sweep_to_hot:${dealId}:${escrowWalletId}:${needNano.toString()}`;
  }
}
