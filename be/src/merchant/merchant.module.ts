import { Module } from '@nestjs/common';
import { MerchantService } from './merchant.service';
import { MerchantController } from './merchant.controller';
import { ApiKeyService } from './api-key.service';
import { MerchantStatsService } from './merchant-stats.service';
import { MerchantChargesService } from './merchant-charges.service';
import { MerchantChargesController } from './merchant-charges.controller';

@Module({
  controllers: [MerchantController, MerchantChargesController],
  providers: [MerchantService, ApiKeyService, MerchantStatsService, MerchantChargesService],
  exports: [MerchantChargesService],
})
export class MerchantModule {}
