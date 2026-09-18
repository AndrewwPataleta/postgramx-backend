import { createDecipheriv } from 'crypto';
import { DealStatus } from '../common/constants/deals/deal-status.constants';
import { DealEntity } from '../modules/deals/entities/deal.entity';
import { DealEscrowEntity } from '../modules/deals/entities/deal-escrow.entity';
import { EscrowWalletEntity } from '../modules/payments/entities/escrow-wallet.entity';
import { EscrowWalletKeyEntity } from '../modules/payments/entities/escrow-wallet-key.entity';
import {
  Address,
  internal,
  SendMode,
  TonClient,
  WalletContractV4,
} from '@ton/ton';

type WalletSecret = {
  publicKeyHex: string;
  secretKeyHex: string;
  address: string;
};

type Mode = 'stage' | 'production';

type CliOptions = {
  modes: Mode[];
  singleMode?: Mode;
};

const DEFAULT_MODES: Mode[] = ['stage', 'production'];
const WAIT_AFTER_DEPLOY_MS = 4_000;
const MAX_DEPLOY_CHECKS = 5;
const DEPLOY_GAS_RESERVE_NANO = 50_000_000n;
const SWEEP_GAS_RESERVE_NANO = 50_000_000n;

function parseModes(raw: string | undefined): Mode[] {
  if (!raw) {
    return DEFAULT_MODES;
  }

  const normalized = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item === 'prod' ? 'production' : item));

  const invalid = normalized.filter(
    (item) => item !== 'stage' && item !== 'production',
  );

  if (invalid.length > 0) {
    throw new Error(
      `Unsupported mode(s): ${invalid.join(', ')}. Use stage,production`,
    );
  }

  return Array.from(new Set(normalized)) as Mode[];
}

function parseArgs(): CliOptions {
  const modesIndex = process.argv.findIndex(
    (arg) => arg === '--modes' || arg === '-m',
  );
  const singleModeIndex = process.argv.findIndex(
    (arg) => arg === '--single-mode',
  );

  const singleModeRaw =
    singleModeIndex >= 0 ? process.argv[singleModeIndex + 1] : undefined;
  const singleMode = singleModeRaw
    ? (parseModes(singleModeRaw)[0] as Mode)
    : undefined;

  const modes = singleMode
    ? [singleMode]
    : parseModes(modesIndex >= 0 ? process.argv[modesIndex + 1] : undefined);

  return { modes, singleMode };
}

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not configured`);
  }
  return value;
}

function decryptSecret(payload: string): WalletSecret {
  const rawKey = getRequiredEnv('WALLET_MASTER_KEY');
  const key = Buffer.from(rawKey, 'base64');
  if (key.length !== 32) {
    throw new Error('WALLET_MASTER_KEY must be a 32-byte base64 value');
  }

  const [ivRaw, authTagRaw, ciphertextRaw] = payload.split(':');
  if (!ivRaw || !authTagRaw || !ciphertextRaw) {
    throw new Error('Invalid encrypted wallet payload');
  }

  const iv = Buffer.from(ivRaw, 'base64');
  const authTag = Buffer.from(authTagRaw, 'base64');
  const ciphertext = Buffer.from(ciphertextRaw, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');

  return JSON.parse(decrypted) as WalletSecret;
}

function formatNano(value: bigint): string {
  const whole = value / 1_000_000_000n;
  const fractional = value % 1_000_000_000n;
  return `${whole}.${fractional.toString().padStart(9, '0')} TON`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function processMode(mode: Mode): Promise<void> {
  const { AppDataSource } = require('../database/datasource');

  const endpoint = getRequiredEnv('TONCENTER_RPC');
  const apiKey = process.env.TONCENTER_API_KEY;
  const hotWalletAddress = Address.parse(getRequiredEnv('HOT_WALLET_ADDRESS'));

  const client = new TonClient({ endpoint, apiKey });

  await AppDataSource.initialize();

  try {
    const rows = await AppDataSource.getRepository(DealEscrowEntity)
      .createQueryBuilder('escrow')
      .innerJoin(DealEntity, 'deal', 'deal.id = escrow.dealId')
      .innerJoin(
        EscrowWalletEntity,
        'wallet',
        'wallet.id = escrow.depositWalletId',
      )
      .innerJoin(
        EscrowWalletKeyEntity,
        'walletKey',
        'walletKey.walletId = wallet.id',
      )
      .where('deal.status = :status', { status: DealStatus.COMPLETED })
      .andWhere('escrow.depositWalletId IS NOT NULL')
      .select([
        'deal.id as "dealId"',
        'wallet.id as "walletId"',
        'wallet.address as "walletAddress"',
        'walletKey.encryptedSecret as "encryptedSecret"',
      ])
      .orderBy('deal.createdAt', 'ASC')
      .getRawMany();

    const typedRows = rows as Array<{
      dealId: string;
      walletId: string;
      walletAddress: string;
      encryptedSecret: string;
    }>;

    console.log(
      `[${mode}] Found ${typedRows.length} completed deals with wallets`,
    );

    for (const row of typedRows) {
      try {
        const secret = decryptSecret(row.encryptedSecret);
        if (secret.address !== row.walletAddress) {
          console.log(
            `[${mode}] Skip deal=${row.dealId}: wallet address mismatch`,
          );
          continue;
        }

        const publicKey = Buffer.from(secret.publicKeyHex, 'hex');
        const secretKey = Buffer.from(secret.secretKeyHex, 'hex');
        const wallet = WalletContractV4.create({ workchain: 0, publicKey });
        const walletContract = client.open(wallet);

        const initialState = await client.getContractState(wallet.address);
        let balanceNano = BigInt(initialState.balance ?? 0);

        if (balanceNano <= 0n) {
          console.log(
            `[${mode}] Skip deal=${row.dealId}: zero balance on ${row.walletAddress}`,
          );
          continue;
        }

        if (initialState.state !== 'active') {
          if (balanceNano <= DEPLOY_GAS_RESERVE_NANO) {
            console.log(
              `[${mode}] Skip deal=${row.dealId}: balance too low for deploy (${formatNano(balanceNano)})`,
            );
            continue;
          }

          await walletContract.sendTransfer({
            seqno: 0,
            secretKey,
            messages: [],
            sendMode: SendMode.PAY_GAS_SEPARATELY,
          });

          console.log(
            `[${mode}] Deploy tx sent for deal=${row.dealId} wallet=${row.walletAddress}`,
          );

          for (let i = 0; i < MAX_DEPLOY_CHECKS; i += 1) {
            await sleep(WAIT_AFTER_DEPLOY_MS);
            const deployState = await client.getContractState(wallet.address);
            if (deployState.state === 'active') {
              break;
            }
          }
        }

        const activeState = await client.getContractState(wallet.address);
        if (activeState.state !== 'active') {
          console.log(
            `[${mode}] Skip deal=${row.dealId}: wallet is still not active`,
          );
          continue;
        }

        balanceNano = BigInt(activeState.balance ?? 0);
        const amountToSend = balanceNano - SWEEP_GAS_RESERVE_NANO;
        if (amountToSend <= 0n) {
          console.log(
            `[${mode}] Skip deal=${row.dealId}: not enough balance after reserve (${formatNano(balanceNano)})`,
          );
          continue;
        }

        const seqno = await walletContract.getSeqno();
        await walletContract.sendTransfer({
          seqno,
          secretKey,
          messages: [
            internal({
              to: hotWalletAddress,
              value: amountToSend,
              bounce: false,
            }),
          ],
          sendMode: SendMode.PAY_GAS_SEPARATELY,
        });

        console.log(
          `[${mode}] Swept deal=${row.dealId} amount=${formatNano(amountToSend)} from=${row.walletAddress} to=${hotWalletAddress.toString()}`,
        );
      } catch (error) {
        console.error(`[${mode}] Failed to process deal=${row.dealId}:`, error);
      }
    }
  } finally {
    await AppDataSource.destroy();
  }
}

async function run(): Promise<void> {
  const options = parseArgs();

  if (!options.singleMode && options.modes.length > 1) {
    const { spawnSync } = await import('child_process');

    for (const mode of options.modes) {
      const result = spawnSync(
        process.execPath,
        [
          '-r',
          'ts-node/register',
          '-r',
          'tsconfig-paths/register',
          __filename,
          '--single-mode',
          mode,
        ],
        {
          stdio: 'inherit',
          env: { ...process.env, NODE_ENV: mode },
        },
      );

      if (result.status !== 0) {
        throw new Error(`Mode ${mode} failed with exit code ${result.status}`);
      }
    }

    return;
  }

  for (const mode of options.modes) {
    process.env.NODE_ENV = mode;
    await processMode(mode);
  }
}

run().catch((error) => {
  console.error('Failed to sweep completed deals:', error);
  process.exitCode = 1;
});
