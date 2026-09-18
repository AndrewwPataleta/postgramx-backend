export function buildIdempotencyKey(prefix: string, value: string): string {
  return `${prefix}${value}`;
}
