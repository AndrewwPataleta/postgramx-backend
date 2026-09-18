import { Injectable } from '@nestjs/common';
import { ChannelEntity } from '../../channels/entities/channel.entity';
import { MTPROTO_MONITOR_CONFIG } from '../mtproto-monitor.config';

interface CachedPeer {
  expiresAt: number;
  peer: string;
}

@Injectable()
export class MtprotoPeerResolverService {
  private readonly cache = new Map<string, CachedPeer>();

  async resolveChannelPeer(channel: ChannelEntity): Promise<string | null> {
    const cacheKey = channel.id;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.peer;
    }

    const candidate = this.getPeerCandidate(channel);
    if (candidate === null) {
      return null;
    }

    this.cache.set(cacheKey, {
      peer: candidate,
      expiresAt:
        Date.now() + MTPROTO_MONITOR_CONFIG.PEER_CACHE_MINUTES * 60 * 1000,
    });

    return candidate;
  }

  private getPeerCandidate(channel: ChannelEntity): string | null {
    const normalizedUsername = this.normalizeUsername(channel.username);
    const normalizedChatId = this.normalizeChannelChatId(
      channel.telegramChatId,
    );

    if (normalizedUsername) {
      return normalizedUsername;
    }

    if (normalizedChatId) {
      return normalizedChatId;
    }

    return null;
  }

  private normalizeUsername(username?: string | null): string | null {
    if (!username) {
      return null;
    }

    const trimmed = username.trim();
    if (!trimmed) {
      return null;
    }

    const withoutPrefix = trimmed.replace(/^@+/, '');
    if (!withoutPrefix) {
      return null;
    }

    return `@${withoutPrefix}`;
  }

  private normalizeChannelChatId(chatId?: string | null): string | null {
    if (!chatId) {
      return null;
    }

    const trimmed = String(chatId).trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith('-100')) {
      return trimmed;
    }

    return null;
  }
}
