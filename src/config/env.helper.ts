import * as path from 'path';

if (
  !process.env.NODE_ENV &&
  process.argv.some((arg) => arg.includes('start:dev'))
) {
  process.env.NODE_ENV = 'local';
}

export function getEnvFilePath(): string {
  const env = process.env.NODE_ENV || 'local';

  let fileName = '.env.local';
  if (env === 'production') fileName = '.env.production';
  else if (env === 'stage') fileName = '.env.stage';

  return fileName;
}
