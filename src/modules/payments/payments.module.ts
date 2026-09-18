import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealEntity } from '../deals/entities/deal.entity';
import { DealEscrowEntity } from '../deals/entities/deal-escrow.entity';
import { DealsModule } from '../deals/deals.module';
import { EscrowWalletEntity } from './entities/escrow-wallet.entity';
import { EscrowWalletKeyEntity } from './entities/escrow-wallet-key.entity';
import { TonTransferEntity } from './entities/ton-transfer.entity';
import { TransactionEntity } from './entities/transaction.entity';
import { PayoutRequestEntity } from './entities/payout-request.entity';
import { RefundRequestEntity } from './entities/refund-request.entity';
import { UserWalletEntity } from './entities/user-wallet.entity';
import { NotificationLogEntity } from './entities/notification-log.entity';
import { EscrowController } from './escrow/escrow.controller';
import { EscrowService } from './escrow/escrow.service';
import { WalletsModule } from './wallets/wallets.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { TonCenterClient } from './ton/toncenter.client';
import { TonPaymentWatcher } from './ton-payment.watcher';
import { TonPayoutService } from './ton/ton-payout.service';
import { ChannelEntity } from '../channels/entities/channel.entity';
import { ChannelMembershipEntity } from '../channels/entities/channel-membership.entity';
import { DealPublicationEntity } from '../deals/entities/deal-publication.entity';
import { SettlementService } from './settlement/settlement.service';
import { TonHotWalletService } from './ton/ton-hot-wallet.service';
import { UserWalletService } from './wallets/user-wallet.service';
import { TelegramModule } from '../telegram/telegram.module';
import { User } from '../auth/entities/user.entity';
import { FeesConfigEntity } from './entities/fees-config.entity';
import { LiquidityConfigEntity } from './entities/liquidity-config.entity';
import { BalanceController } from './balance/balance.controller';
import { BalanceService } from './balance/balance.service';
import { LedgerService } from './ledger/ledger.service';
import { PayoutsController } from './payouts/payouts.controller';
import { PayoutsService } from './payouts/payouts.service';
import { FeesModule } from './fees/fees.module';
import { AdminAlertsService } from './processing/admin-alerts.service';
import { LiquidityService } from './processing/liquidity.service';
import { TonSweepService } from './processing/ton-sweep.service';
import { ENV } from '../../common/constants';
import { PayoutProcessorService } from './processing/payout-processor.service';
import { PaymentsProcessingConfigService } from './processing/payments-processing-config.service';
import { PayoutExecutionService } from './processing/payout-execution.service';
import { LiquidityConfigService } from './processing/liquidity-config.service';
import { PaymentsConfigSeedService } from './payments-config-seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChannelEntity,
      ChannelMembershipEntity,
      DealEntity,
      DealEscrowEntity,
      DealPublicationEntity,
      EscrowWalletEntity,
      EscrowWalletKeyEntity,
      FeesConfigEntity,
      LiquidityConfigEntity,
      TonTransferEntity,
      TransactionEntity,
      PayoutRequestEntity,
      RefundRequestEntity,
      UserWalletEntity,
      NotificationLogEntity,
      User,
    ]),
    forwardRef(() => DealsModule),
    WalletsModule,
    forwardRef(() => TelegramModule),
    FeesModule,
  ],
  controllers: [
    PaymentsController,
    EscrowController,
    BalanceController,
    PayoutsController,
  ],
  providers: [
    PaymentsService,
    EscrowService,
    BalanceService,
    LedgerService,
    PaymentsProcessingConfigService,
    LiquidityConfigService,
    AdminAlertsService,
    LiquidityService,
    TonSweepService,
    PayoutProcessorService,
    PayoutExecutionService,
    PaymentsConfigSeedService,
    {
      provide: TonCenterClient,
      useFactory: () => {
        return new TonCenterClient({
          endpoint: process.env[ENV.TONCENTER_RPC]!,
          apiKey: process.env[ENV.TONCENTER_API_KEY]!,
        });
      },
    },
    TonPaymentWatcher,
    TonPayoutService,
    TonHotWalletService,
    SettlementService,
    UserWalletService,
    PayoutsService,
  ],
  exports: [
    PaymentsService,
    EscrowService,
    UserWalletService,
    LedgerService,
    PayoutsService,
  ],
})
export class PaymentsModule {}
