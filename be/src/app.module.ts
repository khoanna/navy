import { Module } from '@nestjs/common';
import { NavyConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { AdminModule } from './admin/admin.module';
import { MerchantModule } from './merchant/merchant.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    NavyConfigModule, PrismaModule, CryptoModule, AuditModule, AuthModule,
    UserModule, AdminModule, MerchantModule, WalletModule,
  ],
})
export class AppModule {}
