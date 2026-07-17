import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';

interface HealthResult {
  status: 'ok' | 'degraded';
  db: boolean;
  rpc: boolean;
}

/**
 * Unauthenticated liveness/readiness probe. NO guards — monitoring must reach it
 * without credentials. Always returns HTTP 200; callers read the body to decide.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NAVY_EVM) private readonly evm: NavyEvm,
  ) {}

  @Get()
  async check(): Promise<HealthResult> {
    const db = await this.checkDb();
    const rpc = await this.checkRpc();
    return { status: db && rpc ? 'ok' : 'degraded', db, rpc };
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRpc(): Promise<boolean> {
    try {
      await this.evm.provider.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }
}
