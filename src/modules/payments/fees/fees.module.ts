import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeesConfigEntity } from '../entities/fees-config.entity';
import { FeesConfigService } from './fees-config.service';
import { FeesService } from './fees.service';

@Module({
  imports: [TypeOrmModule.forFeature([FeesConfigEntity])],
  providers: [FeesConfigService, FeesService],
  exports: [FeesConfigService, FeesService],
})
export class FeesModule {}
