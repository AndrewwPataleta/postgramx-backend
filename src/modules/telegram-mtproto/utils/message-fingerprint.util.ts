import { createHash } from 'crypto';

export interface MtprotoMessageFingerprintInput {
  text?: string | null;
  mediaUniqueId?: string | null;
  entitiesSignature?: string | null;
}

export const normalizeFingerprintText = (value?: string | null): string =>
  (value ?? '').replace(/\s+/g, ' ').trim();

export const buildMessageFingerprintHash = (
  input: MtprotoMessageFingerprintInput,
): string => {
  const payload = [
    normalizeFingerprintText(input.text),
    input.mediaUniqueId ?? 'none',
    input.entitiesSignature ?? 'none',
  ].join('|');

  return createHash('sha256').update(payload).digest('hex');
};
