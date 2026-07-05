import { Module } from '@nestjs/common';
import { OnchainModule, NAVY_ONCHAIN, type NavyOnchain } from '../onchain/onchain.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { MerchantOrdersController } from './merchant-orders.controller';
import { UserPaymentsController } from './user-payments.controller';
import { RelayerService } from './relayer.service';
import { ChainWatcherService } from './chain-watcher.service';
import { WebhookService } from './webhook.service';
import { OrderAuthService } from './order-auth.service';
import { OrderAuthGuard } from './order-auth.guard';
import { SecretLookupService } from './secret-lookup.service';
import { ApiKeyService } from '../merchant/api-key.service';
import { MerchantModule } from '../merchant/merchant.module';
import { MerchantChargesService } from '../merchant/merchant-charges.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Module({
  imports: [OnchainModule, MerchantModule],
  controllers: [OrdersController, MerchantOrdersController, UserPaymentsController],
  providers: [
    ApiKeyService,
    OrderAuthService,
    OrderAuthGuard,
    RelayerService,
    WebhookService,
    SecretLookupService,
    {
      provide: OrdersService,
      inject: [PrismaService, AuditService, MerchantChargesService],
      useFactory: (p: PrismaService, a: AuditService, c: MerchantChargesService) =>
        new OrdersService(p, a, process.env.NAVY_PAY_BASE_URL ?? 'https://pay.navy/pay', parseInt(process.env.NAVY_FEE_BPS ?? '100', 10), c),
    },
    {
      provide: ChainWatcherService,
      inject: [PrismaService, WebhookService, SecretLookupService, NAVY_ONCHAIN],
      useFactory: (p: PrismaService, w: WebhookService, s: SecretLookupService, o: NavyOnchain) => new ChainWatcherService(p, w, s, o),
    },
  ],
})
export class PaymentsModule {}
