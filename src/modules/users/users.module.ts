import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [UsersController],
})
export class UsersModule {}
