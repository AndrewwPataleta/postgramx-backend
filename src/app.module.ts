import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { AuthMiddleware } from './modules/auth/middleware/auth.middleware';
import { RequestResponseLoggerMiddleware } from './common/middleware/request-response-logger.middleware';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppI18nModule } from './modules/i18n/app-i18n.module';
import { getEnvFilePath } from './config/env.helper';
import { CacheModule, CacheInterceptor } from '@nestjs/cache-manager';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheInvalidationSubscriber } from './database/cache-invalidation.subscriber';
import { ChannelsModule } from './modules/channels/channels.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { DealsModule } from './modules/deals/deals.module';
import { ListingsModule } from './modules/listings/listings.module';
import { TelegramBotModule } from './modules/telegram-bot/telegram-bot.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { DealDeliveryMonitorModule } from './modules/deals-delivery/deals-delivery.module';
import { UsersModule } from './modules/users/users.module';
import { PostAnalyticsModule } from './modules/post-analytics/post-analytics.module';
import { MtprotoMonitorModule } from './modules/telegram-mtproto/mtproto-monitor.module';
import { buildTypeOrmOptions, typeOrmEntities } from './config/typeorm.config';

@Module({
  imports: [
    CacheModule.register({ ttl: 60, isGlobal: true }),
    AppI18nModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePath(),
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
    }),
    TypeOrmModule.forFeature(typeOrmEntities),
    AuthModule,
    HealthModule,
    ChannelsModule,
    MarketplaceModule,
    DealsModule,
    ListingsModule,
    PaymentsModule,
    UsersModule,
    PostAnalyticsModule,
    TelegramBotModule,
    DealDeliveryMonitorModule,
    MtprotoMonitorModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    CacheInvalidationSubscriber,
    { provide: APP_INTERCEPTOR, useClass: CacheInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestResponseLoggerMiddleware).forRoutes('*');
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
