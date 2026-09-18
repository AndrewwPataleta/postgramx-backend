export function addNano(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

export function subNano(a: string, b: string): string {
  const result = BigInt(a) - BigInt(b);
  return (result > 0n ? result : 0n).toString();
}

export function gteNano(a: string, b: string): boolean {
  return BigInt(a) >= BigInt(b);
}

export function formatTon(nano: string, precision = 3): string {
  const nanoValue = BigInt(nano);
  const base = 1_000_000_000n;
  const whole = nanoValue / base;
  const fraction = nanoValue % base;

  if (precision <= 0) {
    return whole.toString();
  }

  const precisionBig = BigInt(precision);
  const divisor = 10n ** (9n - precisionBig);
  const fractionTruncated = fraction / divisor;
  const fractionStr = fractionTruncated.toString().padStart(precision, '0');

  if (fractionTruncated === 0n) {
    return whole.toString();
  }

  return `${whole.toString()}.${fractionStr}`;
}
