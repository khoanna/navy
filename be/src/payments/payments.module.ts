import { Module } from '@nestjs/common';
import { OnchainModule } from '../onchain/onchain.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { RelayerService } from './relayer.service';
import { ChainWatcherService } from './chain-watcher.service';
import { WebhookService } from './webhook.service';
import { OrderAuthService } from './order-auth.service';
import { OrderAuthGuard } from './order-auth.guard';
import { SecretLookupService } from './secret-lookup.service';
import { ApiKeyService } from '../merchant/api-key.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Module({
  imports: [OnchainModule],
  controllers: [OrdersController],
  providers: [
    ApiKeyService,
    OrderAuthService,
    OrderAuthGuard,
    RelayerService,
    WebhookService,
    SecretLookupService,
    {
      provide: OrdersService,
      inject: [PrismaService, AuditService],
      useFactory: (p: PrismaService, a: AuditService) =>
        new OrdersService(p, a, process.env.NAVY_PAY_BASE_URL ?? 'navy://pay', parseInt(process.env.NAVY_FEE_BPS ?? '100', 10)),
    },
    {
      provide: ChainWatcherService,
      inject: [PrismaService, WebhookService, SecretLookupService],
      useFactory: (p: PrismaService, w: WebhookService, s: SecretLookupService) => new ChainWatcherService(p, w, s),
    },
  ],
})
export class PaymentsModule {}
