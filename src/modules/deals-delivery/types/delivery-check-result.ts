export type DeliveryCheckResult =
  | { ok: true; reason?: string; details?: string }
  | { ok: false; reason: string; details?: string };
