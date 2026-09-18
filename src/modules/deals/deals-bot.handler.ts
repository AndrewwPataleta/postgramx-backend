import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { DealsService } from './deals.service';
import { DealCreativeType } from './types/deal-creative-type.enum';
import { DealsDeepLinkService } from './deals-deep-link.service';
import { TelegramMessengerService } from '../telegram/telegram-messenger.service';

type PendingCreativePayload = {
  traceId: string;
  telegramUserId: string;
  type: DealCreativeType;
  text: string | null;
  caption: string | null;
  mediaFileId: string | null;
  rawPayload: Record<string, unknown>;
  createdAt: number;
};

type PendingChangeRequestPayload = {
  dealId: string;
  requestType: 'creative' | 'schedule';
  createdAt: number;
};

const getStartPayload = (context: Context): string | undefined => {
  if (!('startPayload' in context)) {
    return undefined;
  }

  const value = (context as { startPayload?: unknown }).startPayload;
  return typeof value === 'string' ? value : undefined;
};

const getTelegramUserId = (context: Context): string => {
  const fromId = (context as { from?: { id?: number } }).from?.id;
  return String(fromId ?? '');
};

const getChatId = (context: Context): string => {
  const chatId = (context as { chat?: { id?: number } }).chat?.id;
  return String(chatId ?? '');
};

const CHANGE_REQUEST_MARKERS = {
  creative: /#creative_change_request:([0-9a-f-]{36})/i,
  schedule: /#schedule_change_request:([0-9a-f-]{36})/i,
};

const extractChangeRequest = (
  text: string,
): { dealId: string; requestType: 'creative' | 'schedule' } | null => {
  const creativeMatch = text.match(CHANGE_REQUEST_MARKERS.creative);
  if (creativeMatch?.[1]) {
    return { dealId: creativeMatch[1], requestType: 'creative' };
  }

  const scheduleMatch = text.match(CHANGE_REQUEST_MARKERS.schedule);
  if (scheduleMatch?.[1]) {
    return { dealId: scheduleMatch[1], requestType: 'schedule' };
  }

  return null;
};

@Injectable()
export class DealsBotHandler {
  private readonly logger = new Logger(DealsBotHandler.name);
  private readonly pendingCreativeMessages = new Map<
    string,
    PendingCreativePayload
  >();
  private readonly pendingChangeRequests = new Map<
    string,
    PendingChangeRequestPayload
  >();
  private readonly pendingCreativeTtlMs = 15 * 60 * 1000;
  private readonly pendingChangeRequestTtlMs = 15 * 60 * 1000;

  constructor(
    @Inject(forwardRef(() => DealsService))
    private readonly dealsService: DealsService,
    private readonly dealsDeepLinkService: DealsDeepLinkService,
    @Inject(forwardRef(() => TelegramMessengerService))
    private readonly telegramMessengerService: TelegramMessengerService,
  ) {}

  async handleStart(context: Context): Promise<boolean> {
    const payload = getStartPayload(context)?.trim();
    if (!payload?.startsWith('deal_')) {
      return false;
    }

    const dealId = payload.replace('deal_', '').trim();
    if (!dealId) {
      await this.telegramMessengerService.sendText(
        getTelegramUserId(context),
        'telegram.errors.invalid_deal_link',
      );
      return true;
    }

    await this.telegramMessengerService.sendText(
      getTelegramUserId(context),
      'telegram.deal.creative_ready',
      { dealId: dealId.slice(0, 8) },
    );
    return true;
  }

  async handleCreativeMessage(context: Context): Promise<boolean> {
    const message = context.message as
      | {
          text?: string;
          caption?: string;
          message_id: number;
          photo?: Array<{ file_id: string; file_unique_id: string }>;
          video?: { file_id: string; file_unique_id: string };
          reply_to_message?: { text?: string; caption?: string };
          forward_from?: { id?: number };
          forward_from_chat?: { id?: number };
          forward_from_message_id?: number;
          forward_sender_name?: string;
          forward_signature?: string;
          forward_date?: number;
        }
      | undefined;

    if (!message) {
      await this.telegramMessengerService.sendText(
        getTelegramUserId(context),
        'telegram.deal.creative.unsupported_format',
      );
      return true;
    }

    const telegramUserId = getTelegramUserId(context);
    const messageId = message.message_id;
    const traceId = `${telegramUserId}:${messageId}`;
    const text = message.text ?? null;
    const caption = message.caption ?? null;
    const hasText = Boolean(text);
    const hasPhoto = Boolean(message.photo?.length);
    const hasVideo = Boolean(message.video);
    let type: DealCreativeType | null = null;
    let mediaFileId: string | null = null;
    let replyKey: string = 'telegram.deal.creative.save_failed';
    let replyArgs: Record<string, any> | undefined;
    let replyMiniAppUrl: string | null = null;

    this.logger.log('DealsBot creative message received', {
      traceId,
      telegramId: telegramUserId,
      messageId,
      hasText,
      hasPhoto,
      hasVideo,
    });

    if (message.photo && message.photo.length > 0) {
      const largest = message.photo[message.photo.length - 1];
      type = DealCreativeType.IMAGE;
      mediaFileId = largest.file_id;
    }
    if (message.video) {
      type = DealCreativeType.VIDEO;
      mediaFileId = message.video.file_id;
    }
    if (!type && text) {
      type = DealCreativeType.TEXT;
    }

    try {
      if (!type) {
        replyKey = 'telegram.deal.creative.unsupported_format';
        this.logger.warn('DealsBot unsupported creative format', {
          traceId,
          telegramId: telegramUserId,
        });
      } else if (
        (type === DealCreativeType.IMAGE || type === DealCreativeType.VIDEO) &&
        !caption
      ) {
        replyKey = 'telegram.deal.creative.missing_caption';
        this.logger.warn('DealsBot creative missing caption', {
          traceId,
          telegramId: telegramUserId,
          type,
        });
      } else {
        const creativePayload = {
          traceId,
          telegramUserId,
          type,
          text,
          caption,
          mediaFileId,
          rawPayload: {
            chatId: getChatId(context),
            messageId,
            text,
            caption,
            photoFileIds: message.photo?.map((item) => item.file_id),
            videoFileId: message.video?.file_id,
            forwardFromId: message.forward_from?.id,
            forwardFromChatId: message.forward_from_chat?.id,
            forwardFromMessageId: message.forward_from_message_id,
            forwardSenderName: message.forward_sender_name,
            forwardSignature: message.forward_signature,
            forwardDate: message.forward_date,
          },
        };
        const result =
          await this.dealsService.handleCreativeMessage(creativePayload);

        replyKey = result.messageKey ?? replyKey;
        replyArgs = result.messageArgs;

        if (result.requiresDealSelection && result.dealOptions?.length) {
          this.pendingCreativeMessages.set(telegramUserId, {
            ...creativePayload,
            createdAt: Date.now(),
          });
          await this.telegramMessengerService.sendInlineKeyboard(
            telegramUserId,
            replyKey,
            replyArgs,
            result.dealOptions.map((deal) => [
              {
                textKey: 'telegram.deal.creative.select_deal_button',
                textArgs: { dealId: deal.id.slice(0, 8) },
                callbackData: `select_creative:${deal.id}`,
              },
            ]),
          );
          return true;
        }

        if (result.success && result.dealId) {
          replyMiniAppUrl = this.dealsDeepLinkService.buildDealLink(
            result.dealId,
          );
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('DealsBot creative handling failed', {
        traceId,
        telegramId: telegramUserId,
        errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    if (replyKey) {
      if (replyMiniAppUrl) {
        await this.telegramMessengerService.sendInlineKeyboard(
          telegramUserId,
          replyKey,
          replyArgs,
          [
            [
              {
                textKey: 'telegram.common.open_mini_app',
                url: replyMiniAppUrl,
              },
            ],
          ],
        );
        return true;
      }

      await this.telegramMessengerService.sendText(
        telegramUserId,
        replyKey,
        replyArgs,
      );
    }

    return true;
  }

  async handleCreativeDealSelectionCallback(
    context: Context,
    dealId: string,
  ): Promise<boolean> {
    const telegramUserId = getTelegramUserId(context);
    const pending = this.pendingCreativeMessages.get(telegramUserId);
    if (!pending) {
      await context.answerCbQuery();
      await this.telegramMessengerService.sendText(
        telegramUserId,
        'telegram.deal.creative.selection_expired',
      );
      return true;
    }

    if (Date.now() - pending.createdAt > this.pendingCreativeTtlMs) {
      this.pendingCreativeMessages.delete(telegramUserId);
      await context.answerCbQuery();
      await this.telegramMessengerService.sendText(
        telegramUserId,
        'telegram.deal.creative.selection_expired',
      );
      return true;
    }

    this.pendingCreativeMessages.delete(telegramUserId);
    const result = await this.dealsService.handleCreativeMessage({
      traceId: pending.traceId,
      telegramUserId,
      type: pending.type,
      text: pending.text,
      caption: pending.caption,
      mediaFileId: pending.mediaFileId,
      rawPayload: pending.rawPayload,
      dealId,
    });

    await context.answerCbQuery();

    let replyMiniAppUrl: string | null = null;
    if (result.success && result.dealId) {
      replyMiniAppUrl = this.dealsDeepLinkService.buildDealLink(result.dealId);
    }

    if (replyMiniAppUrl) {
      await this.telegramMessengerService.sendInlineKeyboard(
        telegramUserId,
        result.messageKey ?? 'telegram.common.error',
        result.messageArgs,
        [[{ textKey: 'telegram.common.open_mini_app', url: replyMiniAppUrl }]],
      );
      return true;
    }

    await this.telegramMessengerService.sendText(
      telegramUserId,
      result.messageKey ?? 'telegram.common.error',
      result.messageArgs,
    );

    return true;
  }

  async handleAdminRequestChangesReply(context: Context): Promise<boolean> {
    const message = context.message as
      | {
          text?: string;
          reply_to_message?: { text?: string; caption?: string };
        }
      | undefined;

    if (!message) {
      return false;
    }

    const replyText =
      message.reply_to_message?.text ?? message.reply_to_message?.caption ?? '';
    if (!replyText) {
      return false;
    }

    const telegramUserId = getTelegramUserId(context);
    let request = extractChangeRequest(replyText);

    if (!request) {
      const pendingRequest = this.pendingChangeRequests.get(telegramUserId);
      if (!pendingRequest) {
        return false;
      }

      if (
        Date.now() - pendingRequest.createdAt >
        this.pendingChangeRequestTtlMs
      ) {
        this.pendingChangeRequests.delete(telegramUserId);
        return false;
      }

      request = {
        dealId: pendingRequest.dealId,
        requestType: pendingRequest.requestType,
      };
    }

    const comment = message.text?.trim() ?? '';
    const result = await this.dealsService.handleAdminRequestChangesReply({
      telegramUserId,
      dealId: request.dealId,
      comment,
      requestType: request.requestType,
    });

    if (!result.handled) {
      return false;
    }

    if (result.messageKey) {
      await this.telegramMessengerService.sendText(
        telegramUserId,
        result.messageKey,
        result.messageArgs,
      );
    }

    this.pendingChangeRequests.delete(telegramUserId);

    return true;
  }

  async handleCreativeApproveCallback(
    context: Context,
    dealId: string,
  ): Promise<boolean> {
    const telegramUserId = getTelegramUserId(context);
    const result = await this.dealsService.handleCreativeApprovalFromTelegram({
      telegramUserId,
      dealId,
    });

    if (!result.handled) {
      return false;
    }

    await context.answerCbQuery();

    if (result.messageKey) {
      await this.telegramMessengerService.sendText(
        telegramUserId,
        result.messageKey,
        result.messageArgs,
      );
    }

    return true;
  }

  async handleCreativeRequestChangesCallback(
    context: Context,
    dealId: string,
  ): Promise<boolean> {
    const telegramUserId = getTelegramUserId(context);
    const result =
      await this.dealsService.handleCreativeRequestChangesFromTelegram({
        telegramUserId,
        dealId,
      });

    if (!result.handled) {
      return false;
    }

    await context.answerCbQuery();

    if (result.messageKey) {
      await this.telegramMessengerService.sendText(
        telegramUserId,
        result.messageKey,
        result.messageArgs,
      );
      this.pendingChangeRequests.set(telegramUserId, {
        dealId,
        requestType: 'creative',
        createdAt: Date.now(),
      });
    }

    return true;
  }

  async handleCreativeRejectCallback(
    context: Context,
    dealId: string,
  ): Promise<boolean> {
    const telegramUserId = getTelegramUserId(context);
    const result = await this.dealsService.handleCreativeRejectFromTelegram({
      telegramUserId,
      dealId,
    });

    if (!result.handled) {
      return false;
    }

    await context.answerCbQuery();

    if (result.messageKey) {
      await this.telegramMessengerService.sendText(
        telegramUserId,
        result.messageKey,
        result.messageArgs,
      );
    }

    return true;
  }

  async handleScheduleApproveCallback(
    context: Context,
    dealId: string,
  ): Promise<boolean> {
    const result = await this.dealsService.handleScheduleApprovalFromTelegram({
      telegramUserId: getTelegramUserId(context),
      dealId,
    });

    if (!result.handled) {
      return false;
    }
    await context.answerCbQuery();

    return true;
  }

  async handleScheduleRequestChangesCallback(
    context: Context,
    dealId: string,
  ): Promise<boolean> {
    const telegramUserId = getTelegramUserId(context);
    const result =
      await this.dealsService.handleScheduleRequestChangesFromTelegram({
        telegramUserId,
        dealId,
      });

    if (!result.handled) {
      return false;
    }

    await context.answerCbQuery();

    if (result.messageKey) {
      await this.telegramMessengerService.sendText(
        telegramUserId,
        result.messageKey,
        result.messageArgs,
      );
      this.pendingChangeRequests.set(telegramUserId, {
        dealId,
        requestType: 'schedule',
        createdAt: Date.now(),
      });
    }

    return true;
  }

  async handleScheduleRejectCallback(
    context: Context,
    dealId: string,
  ): Promise<boolean> {
    const telegramUserId = getTelegramUserId(context);
    const result = await this.dealsService.handleScheduleRejectFromTelegram({
      telegramUserId,
      dealId,
    });

    if (!result.handled) {
      return false;
    }

    await context.answerCbQuery();

    if (result.messageKey) {
      await this.telegramMessengerService.sendText(
        telegramUserId,
        result.messageKey,
        result.messageArgs,
      );
    }

    return true;
  }
}
