import { Module } from '@nestjs/common';
import { EvmModule, NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { EvmRegistrarService } from '../evm/evm-registrar.service';
import { AdminMerchantsService } from './admin-merchants.service';
import { AdminMerchantsController } from './admin-merchants.controller';
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsController } from './admin-stats.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Module({
  imports: [EvmModule],
  controllers: [AdminMerchantsController, AdminStatsController],
  providers: [
    AdminStatsService,
    {
      provide: EvmRegistrarService,
      inject: [NAVY_EVM],
      useFactory: (chain: NavyEvm) => new EvmRegistrarService(chain),
    },
    {
      provide: AdminMerchantsService,
      inject: [PrismaService, EvmRegistrarService, AuditService],
      useFactory: (p: PrismaService, r: EvmRegistrarService, a: AuditService) => new AdminMerchantsService(p, r, a),
    },
  ],
})
export class AdminMerchantsModule {}
