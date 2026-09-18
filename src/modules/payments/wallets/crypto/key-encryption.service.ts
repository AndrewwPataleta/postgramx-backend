import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class KeyEncryptionService {
  constructor(private readonly configService: ConfigService) {}

  encryptSecret(secret: string): string {
    const key = this.getMasterKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [iv, authTag, encrypted]
      .map((part) => part.toString('base64'))
      .join(':');
  }

  decryptSecret(payload: string): string {
    const key = this.getMasterKey();
    const [ivRaw, authTagRaw, ciphertextRaw] = payload.split(':');

    if (!ivRaw || !authTagRaw || !ciphertextRaw) {
      throw new Error('Invalid encrypted payload');
    }

    const iv = Buffer.from(ivRaw, 'base64');
    const authTag = Buffer.from(authTagRaw, 'base64');
    const ciphertext = Buffer.from(ciphertextRaw, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  private getMasterKey(): Buffer {
    const rawKey = this.configService.get<string>('WALLET_MASTER_KEY');
    if (!rawKey) {
      throw new Error('WALLET_MASTER_KEY is not configured');
    }
    const key = Buffer.from(rawKey, 'base64');
    if (key.length !== 32) {
      throw new Error('WALLET_MASTER_KEY must be a 32-byte base64 value');
    }
    return key;
  }
}
