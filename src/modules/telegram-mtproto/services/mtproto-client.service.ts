import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { MTPROTO_MONITOR_CONFIG } from '../mtproto-monitor.config';

const gramjs = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Raw } = require('telegram/events');

const TelegramClient = gramjs.TelegramClient;
const Api = gramjs.Api;

type TelegramClientInstance = any;
type GramMessage = any;

export interface MtprotoChannelMessage {
  id: number;
  text: string | null;
  mediaUniqueId: string | null;
  entitiesSignature: string | null;
  views: number | null;
}

@Injectable()
export class MtprotoClientService implements OnModuleInit, OnModuleDestroy {
  private static sharedClient: TelegramClientInstance | null = null;
  private static connectPromise: Promise<void> | null = null;
  private static disconnectPromise: Promise<void> | null = null;
  private static updatesBound = false;

  private readonly logger = new Logger(MtprotoClientService.name);
  private disabledByAuthKeyDuplication = false;

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      await this.withRetry(async () => {
        await this.ensureConnected();
      }, 'ensureConnected(onModuleInit)');
    } catch (error) {
      if (this.isAuthKeyDuplicatedError(error)) {
        await this.handleAuthKeyDuplication();
        return;
      }

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!MtprotoClientService.sharedClient) {
      return;
    }

    if (!MtprotoClientService.disconnectPromise) {
      MtprotoClientService.disconnectPromise = (async () => {
        await MtprotoClientService.sharedClient?.disconnect();
        MtprotoClientService.sharedClient = null;
        MtprotoClientService.connectPromise = null;
        MtprotoClientService.updatesBound = false;
      })().finally(() => {
        MtprotoClientService.disconnectPromise = null;
      });
    }

    await MtprotoClientService.disconnectPromise;
  }

  isEnabled(): boolean {
    return (
      MTPROTO_MONITOR_CONFIG.ENABLED &&
      !this.disabledByAuthKeyDuplication &&
      MTPROTO_MONITOR_CONFIG.PROVIDER === 'mtproto'
    );
  }

  async getChannelMessage(
    peer: string,
    messageId: number,
  ): Promise<MtprotoChannelMessage | null> {
    if (!this.isEnabled()) {
      return null;
    }

    return this.withRetry(async () => {
      const client = await this.getConnectedClient();
      const messages = await client.getMessages(peer, {
        ids: [messageId],
      });

      const message = messages[0];
      if (!message || typeof message.id !== 'number') {
        return null;
      }

      return this.mapMessage(message);
    }, `getChannelMessage(peer=${peer}, messageId=${messageId})`);
  }

  async getPinnedMessage(peer: string): Promise<number | null> {
    if (!this.isEnabled()) {
      return null;
    }

    return this.withRetry(async () => {
      const client = await this.getConnectedClient();
      const channel = await client.getEntity(peer);
      const fullChannel = await client.invoke(
        new Api.channels.GetFullChannel({ channel }),
      );

      return Number(fullChannel.fullChat?.pinnedMsgId ?? 0) || null;
    }, `getPinnedMessage(peer=${peer})`);
  }

  async getChannelHistorySlice(
    peer: string,
    aroundMessageId: number,
  ): Promise<MtprotoChannelMessage[]> {
    if (!this.isEnabled()) {
      return [];
    }

    return this.withRetry(async () => {
      const client = await this.getConnectedClient();
      const ids = Array.from(
        { length: 5 },
        (_, index) => aroundMessageId - 2 + index,
      ).filter((id) => id > 0);

      const messages = await client.getMessages(peer, { ids });
      return messages
        .filter((message: GramMessage) =>
          Boolean(message && typeof message.id === 'number'),
        )
        .sort((a: GramMessage, b: GramMessage) => a.id - b.id)
        .map((message: GramMessage) => this.mapMessage(message));
    }, `getChannelHistorySlice(peer=${peer}, aroundMessageId=${aroundMessageId})`);
  }

  private async getConnectedClient(): Promise<TelegramClientInstance> {
    await this.ensureConnected();

    if (
      !MtprotoClientService.sharedClient ||
      !MtprotoClientService.sharedClient.connected
    ) {
      throw new Error('MTPROTO_CLIENT_NOT_CONNECTED');
    }

    return MtprotoClientService.sharedClient;
  }

  private async ensureConnected(): Promise<void> {
    this.validateConfig();

    if (!MtprotoClientService.sharedClient) {
      MtprotoClientService.sharedClient = new TelegramClient(
        new StringSession(MTPROTO_MONITOR_CONFIG.SESSION),
        MTPROTO_MONITOR_CONFIG.API_ID,
        MTPROTO_MONITOR_CONFIG.API_HASH,
        {
          connectionRetries: 1,
          useWSS: false,
        },
      );
    }

    if (MtprotoClientService.sharedClient.connected) {
      return;
    }

    if (!MtprotoClientService.connectPromise) {
      MtprotoClientService.connectPromise = (async () => {
        await MtprotoClientService.sharedClient?.connect();
        this.bindUpdateListener();
        this.logger.log('MTProto client connected');
      })().finally(() => {
        MtprotoClientService.connectPromise = null;
      });
    }

    await MtprotoClientService.connectPromise;
  }

  private bindUpdateListener(): void {
    if (
      !MtprotoClientService.sharedClient ||
      MtprotoClientService.updatesBound
    ) {
      return;
    }

    MtprotoClientService.sharedClient.addEventHandler((update: any) => {
      if (this.isApiUpdate(update, 'UpdateEditChannelMessage')) {
        this.logger.debug(
          `MTProto update: edited channel message ${update.message.id}`,
        );
      }

      if (this.isApiUpdate(update, 'UpdateDeleteChannelMessages')) {
        this.logger.debug(
          `MTProto update: deleted channel messages ${update.messages.join(',')}`,
        );
      }

      if (this.isApiUpdate(update, 'UpdateChannelPinnedMessage')) {
        this.logger.debug(
          `MTProto update: pinned message changed in channel ${update.channelId}`,
        );
      }
    }, new Raw({}));

    MtprotoClientService.updatesBound = true;
  }

  private isApiUpdate(update: any, updateType: string): boolean {
    const ApiType = Api?.[updateType];
    const canUseInstanceof = typeof ApiType === 'function';

    if (canUseInstanceof && update instanceof ApiType) {
      return true;
    }

    return update?.className === updateType;
  }

  private mapMessage(message: GramMessage): MtprotoChannelMessage {
    return {
      id: message.id,
      text: message.message ?? null,
      mediaUniqueId: this.extractMediaUniqueId(message),
      entitiesSignature: this.extractEntitiesSignature(message),
      views: typeof message.views === 'number' ? message.views : null,
    };
  }

  private extractMediaUniqueId(message: GramMessage): string | null {
    if (message.media?.document?.id) {
      return `document:${message.media.document.id}`;
    }

    if (message.media?.photo?.id) {
      return `photo:${message.media.photo.id}`;
    }

    return null;
  }

  private extractEntitiesSignature(message: GramMessage): string | null {
    if (!message.entities?.length) {
      return null;
    }

    return message.entities
      .map((entity: any) => {
        const type = entity.className;
        const offset = entity.offset ?? 0;
        const length = entity.length ?? 0;
        const extra = entity.url ?? entity.userId ?? '';
        return `${type}:${offset}:${length}:${extra}`;
      })
      .join('|');
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    attempt = 0,
  ): Promise<T> {
    try {
      return await this.withRequestTimeout(operation(), operationName);
    } catch (error) {
      if (this.isAuthKeyDuplicatedError(error)) {
        await this.handleAuthKeyDuplication();
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `MTProto operation failed: ${operationName}, attempt=${attempt + 1}, error=${errorMessage}`,
      );

      if (attempt >= 2) {
        throw error;
      }

      const delayMs = 250 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await this.ensureConnected();
      return this.withRetry(operation, operationName, attempt + 1);
    }
  }

  private async withRequestTimeout<T>(
    promise: Promise<T>,
    operationName: string,
  ): Promise<T> {
    const timeoutMs = MTPROTO_MONITOR_CONFIG.REQUEST_TIMEOUT_MS;

    if (!timeoutMs || timeoutMs <= 0) {
      return promise;
    }

    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new Error(
                `MTPROTO_REQUEST_TIMEOUT: ${operationName} exceeded ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private validateConfig(): void {
    if (!MTPROTO_MONITOR_CONFIG.API_ID) {
      throw new Error('MTPROTO_API_ID_MISSING');
    }

    if (!MTPROTO_MONITOR_CONFIG.API_HASH) {
      throw new Error('MTPROTO_API_HASH_MISSING');
    }

    if (!MTPROTO_MONITOR_CONFIG.SESSION) {
      throw new Error('MTPROTO_SESSION_MISSING');
    }
  }

  private isAuthKeyDuplicatedError(error: unknown): boolean {
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? '');
    return errorMessage.includes('AUTH_KEY_DUPLICATED');
  }

  private async handleAuthKeyDuplication(): Promise<void> {
    if (this.disabledByAuthKeyDuplication) {
      return;
    }

    this.disabledByAuthKeyDuplication = true;
    this.logger.error(
      'MTProto disabled: AUTH_KEY_DUPLICATED. Use a unique MTPROTO_SESSION per running instance and regenerate the session if needed.',
    );
    await this.onModuleDestroy();
  }
}
