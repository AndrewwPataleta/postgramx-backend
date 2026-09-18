import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bot, InlineKeyboard, InputFile, GrammyError, Context } from 'grammy';
import { LabeledPrice } from '@grammyjs/types';
import * as path from 'path';
import * as fs from 'fs';
import { User } from '../auth/entities/user.entity';
import { I18nService } from 'nestjs-i18n';
import { normalizeLanguage } from '../../common/i18n/supported-languages';
import { ConfigService } from '@nestjs/config';
import { ENV } from '../../common/constants';

@Injectable()
export class TelegramService implements OnModuleInit {
  public readonly bot = new Bot(process.env[ENV.BOT_TOKEN] as string);
  private readonly analyticsBot?: Bot;
  private readonly analyticsChatId?: string;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly i18n: I18nService,
    private readonly configService: ConfigService,
  ) {
    this.analyticsChatId = this.configService.get<string>(
      'TELEGRAM_ANALYTICS_CHAT_ID',
    );
    const analyticsToken = this.configService.get<string>(
      'TELEGRAM_ANALYTICS_BOT_TOKEN',
    );

    if (analyticsToken && this.analyticsChatId) {
      this.analyticsBot = new Bot(analyticsToken);
    }
  }

  onModuleInit() {}
}
