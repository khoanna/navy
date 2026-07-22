import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PriceService } from './price.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('market')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class MarketController {
  constructor(private readonly prices: PriceService) {}

  @Get('prices')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  async getPrices(@Query('ids') ids?: string) {
    const list = (ids ?? 'ethereum').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
    try { return await this.prices.prices(list); }
    catch { return {}; } // app treats an empty price map as "prices unavailable" and hides USD
  }

  @Get('token')
  @Throttle({ default: { ttl: 60000, limit: 40 } })
  async getToken(@Query('query') query: string) {
    try {
      const info = await this.prices.tokenInfo(query ?? '');
      return info ?? { error: `Couldn't find a token matching "${query ?? ''}"` };
    } catch { return { error: 'Prices are unavailable right now. Please try again shortly.' }; }
  }

  @Get('top')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async getTop(@Query('limit') limit?: string) {
    try { return await this.prices.topCoins(limit ? parseInt(limit, 10) : 10); }
    catch { return { error: 'Prices are unavailable right now. Please try again shortly.' }; }
  }
}
