import input from 'input';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import path from 'path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

const MAX_CODE_ATTEMPTS = 3;
const ENV_OPTIONS = ['local', 'stage', 'production'] as const;
type EnvName = (typeof ENV_OPTIONS)[number];

function readEnvArg(): EnvName | undefined {
  const envArgPrefix = '--env=';
  const envArg = process.argv.find((arg) => arg.startsWith(envArgPrefix));
  if (!envArg) {
    return undefined;
  }

  const envName = envArg.slice(envArgPrefix.length).toLowerCase();
  if (!ENV_OPTIONS.includes(envName as EnvName)) {
    throw new Error(
      `Unsupported environment "${envName}". Use one of: ${ENV_OPTIONS.join(', ')}.`,
    );
  }

  return envName as EnvName;
}

async function resolveEnvironment(): Promise<EnvName> {
  const envFromArg = readEnvArg();
  if (envFromArg) {
    return envFromArg;
  }

  const answer = await input.select('Select environment:', ENV_OPTIONS, {
    default: 'local',
  });

  if (!ENV_OPTIONS.includes(answer as EnvName)) {
    throw new Error(`Unknown environment selected: ${answer}`);
  }

  return answer as EnvName;
}

function loadEnvironmentVariables(envName: EnvName): void {
  const envFilePath = path.resolve(process.cwd(), `.env.${envName}`);
  if (!existsSync(envFilePath)) {
    throw new Error(`Environment file not found: ${envFilePath}`);
  }

  const result = loadEnv({ path: envFilePath });
  if (result.error) {
    throw result.error;
  }
}

function requireEnv(name: 'MTPROTO_API_ID' | 'MTPROTO_API_HASH'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function isInvalidCodeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toUpperCase();
  return (
    message.includes('PHONE_CODE_INVALID') || message.includes('CODE_INVALID')
  );
}

async function main() {
  const envName = await resolveEnvironment();
  loadEnvironmentVariables(envName);

  const apiIdValue = requireEnv('MTPROTO_API_ID');
  const apiHash = requireEnv('MTPROTO_API_HASH');

  const apiId = Number(apiIdValue);
  if (Number.isNaN(apiId)) {
    throw new Error('MTPROTO_API_ID must be a valid number.');
  }

  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    console.log('Telegram MTProto session generator\n');
    console.log(`Environment: ${envName}`);
    console.log(
      '1) Enter the phone number in international format (example: +15551234567).',
    );
    console.log('2) Enter the login code received in Telegram.');
    console.log('3) If 2FA is enabled, enter your password when prompted.\n');

    const phoneNumber = await input.text('Phone number: ');

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt += 1) {
      try {
        await client.start({
          phoneNumber: async () => phoneNumber,
          phoneCode: async () => input.text('Login code: '),
          password: async () => input.password('2FA password (if enabled): '),
          onError: (error) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(`Telegram login error: ${errorMessage}`);
          },
        });

        console.log('\nSESSION STRING:');
        console.log(client.session.save());
        console.log(
          '\nSave this string and paste it into your backend config where StringSession is expected.',
        );
        return;
      } catch (error) {
        lastError = error;

        if (isInvalidCodeError(error) && attempt < MAX_CODE_ATTEMPTS) {
          console.error(
            `Invalid login code. Please try again (${attempt}/${MAX_CODE_ATTEMPTS}).`,
          );
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  } finally {
    await client.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to generate Telegram session: ${message}`);
  process.exitCode = 1;
});
