export function getEnvString(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return '';
  }
  return value;
}

export function getEnvNumber(key: string, defaultValue: number): number {
  const rawValue = process.env[key];
  if (rawValue === undefined || rawValue === '') {
    return defaultValue;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function getEnvBigInt(key: string, defaultValue: bigint): bigint {
  const rawValue = process.env[key];
  if (rawValue === undefined || rawValue === '') {
    return defaultValue;
  }

  try {
    return BigInt(rawValue);
  } catch {
    return defaultValue;
  }
}
