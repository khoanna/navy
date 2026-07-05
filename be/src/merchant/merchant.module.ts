import { Module } from '@nestjs/common';
import { MerchantService } from './merchant.service';
import { MerchantController } from './merchant.controller';
import { ApiKeyService } from './api-key.service';
import { MerchantStatsService } from './merchant-stats.service';

@Module({ controllers: [MerchantController], providers: [MerchantService, ApiKeyService, MerchantStatsService] })
export class MerchantModule {}
