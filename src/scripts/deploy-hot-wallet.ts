import dotenv from 'dotenv';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { SendMode, TonClient, WalletContractV4 } from '@ton/ton';

const resolveMode = (): string => {
  const modeArgIndex = process.argv.findIndex(
    (arg) => arg === '--mode' || arg === '-m',
  );
  const modeArg =
    modeArgIndex >= 0 ? process.argv[modeArgIndex + 1] : undefined;
  const mode = (modeArg ?? process.env.NODE_ENV ?? 'local').toLowerCase();

  if (mode === 'prod') {
    return 'production';
  }

  if (mode === 'local' || mode === 'stage' || mode === 'production') {
    return mode;
  }

  throw new Error(`Unsupported mode "${mode}". Use local, stage, or prod.`);
};

const mode = resolveMode();
dotenv.config({ path: `.env.${mode}`, override: true });

const requiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not configured`);
  }
  return value;
};

const formatNano = (value: bigint): string => {
  const whole = value / 1_000_000_000n;
  const fractional = value % 1_000_000_000n;
  return `${whole}.${fractional.toString().padStart(9, '0')} TON`;
};

const deployHotWallet = async (): Promise<void> => {
  const endpoint = requiredEnv('TONCENTER_RPC');
  const apiKey = process.env.TONCENTER_API_KEY;
  const mnemonic = requiredEnv('HOT_WALLET_MNEMONIC')
    .split(/[\s,]+/)
    .filter(Boolean);

  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const address = wallet.address.toString();

  const client = new TonClient({ endpoint, apiKey });
  const contract = client.open(wallet);
  const state = await client.getContractState(wallet.address);
  const balance = BigInt(state.balance ?? 0);

  console.log('HOT WALLET ADDRESS:');
  console.log(address);
  console.log(`BALANCE: ${formatNano(balance)}`);
  console.log(`STATE: ${state.state}`);

  if (state.state === 'active') {
    console.log('Hot wallet already deployed.');
    return;
  }

  if (balance <= 0n) {
    console.error('Hot wallet has zero balance. Top up the address and retry.');
    process.exitCode = 1;
    return;
  }

  await contract.sendTransfer({
    seqno: 0,
    secretKey: keyPair.secretKey,
    messages: [],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });

  console.log(
    'Deployment transfer sent. Check the wallet state after confirmation.',
  );
};

deployHotWallet().catch((error) => {
  console.error('Failed to deploy hot wallet:', error);
  process.exitCode = 1;
});
