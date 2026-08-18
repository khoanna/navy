import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { NavyConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { AdminModule } from './admin/admin.module';
import { MerchantModule } from './merchant/merchant.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminMerchantsModule } from './admin-merchants/admin-merchants.module';
import { HealthModule } from './health/health.module';
import { ProductsModule } from './products/products.module';
import { TransferModule } from './transfer/transfer.module';
import { AgentModule } from './agent/agent.module';
import { MarketModule } from './market/market.module';
import { VaultModule } from './vault/vault.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    NavyConfigModule, PrismaModule, CryptoModule, AuditModule, AuthModule,
    UserModule, AdminModule, MerchantModule, PaymentsModule,
    AdminMerchantsModule, HealthModule, ProductsModule,
    TransferModule, AgentModule, MarketModule, VaultModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
