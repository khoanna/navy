import { Module } from '@nestjs/common';
import { MerchantService } from './merchant.service';
import { MerchantController } from './merchant.controller';
import { ApiKeyService } from './api-key.service';

@Module({ controllers: [MerchantController], providers: [MerchantService, ApiKeyService] })
export class MerchantModule {}
