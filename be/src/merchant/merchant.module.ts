import { Module } from '@nestjs/common';
import { EvmModule, NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { EvmRegistrarService } from '../evm/evm-registrar.service';
import { MerchantService } from './merchant.service';
import { MerchantController } from './merchant.controller';
import { ApiKeyService } from './api-key.service';
import { MerchantStatsService } from './merchant-stats.service';
import { MerchantChargesService } from './merchant-charges.service';
import { MerchantChargesController } from './merchant-charges.controller';

@Module({
  imports: [EvmModule],
  controllers: [MerchantController, MerchantChargesController],
  providers: [
    {
      provide: EvmRegistrarService,
      inject: [NAVY_EVM],
      useFactory: (chain: NavyEvm) => new EvmRegistrarService(chain),
    },
    MerchantService,
    ApiKeyService,
    MerchantStatsService,
    MerchantChargesService,
  ],
  exports: [MerchantChargesService],
})
export class MerchantModule {}
