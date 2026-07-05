import { Module } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import { OnchainModule, NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { RegistrarService } from '../onchain/registrar.service';
import { AdminMerchantsService } from './admin-merchants.service';
import { AdminMerchantsController } from './admin-merchants.controller';
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsController } from './admin-stats.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

function parseRegistrar(): Keypair {
  const raw = (process.env.NAVY_ADMIN_SECRET as string).trim();
  if (raw.startsWith('[')) {
    const bytes = Uint8Array.from(JSON.parse(raw));
    try { return Keypair.fromSecretKey(bytes); } catch { return Keypair.fromSeed(bytes.slice(0, 32)); }
  }
  const bs58 = require('bs58');
  return Keypair.fromSecretKey(bs58.decode(raw));
}

@Module({
  imports: [OnchainModule],
  controllers: [AdminMerchantsController, AdminStatsController],
  providers: [
    AdminStatsService,
    {
      provide: RegistrarService,
      inject: [NAVY_ONCHAIN],
      useFactory: (chain: NavyOnchain) => new RegistrarService(chain, parseRegistrar()),
    },
    {
      provide: AdminMerchantsService,
      inject: [PrismaService, RegistrarService, AuditService],
      useFactory: (p: PrismaService, r: RegistrarService, a: AuditService) => new AdminMerchantsService(p, r, a),
    },
  ],
})
export class AdminMerchantsModule {}
