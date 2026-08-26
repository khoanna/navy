/**
 * VaultApyController — public endpoint for vault APY data.
 * No auth required.
 */
import { Controller, Get } from '@nestjs/common';
import { VaultApyService, VaultApysResponse } from './vault-apy.service';

@Controller('vault')
export class VaultApyController {
  constructor(private readonly vaultApyService: VaultApyService) {}

  /**
   * GET /vault/apys
   * Returns current APY and TVL per adapter, plus aggregate.
   * No auth required — public market data.
   */
  @Get('apys')
  async getApys(): Promise<VaultApysResponse> {
    return this.vaultApyService.computeApys();
  }
}
