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
  getPrices(@Query('ids') ids?: string) {
    const list = (ids ?? 'ethereum').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 25);
    return this.prices.prices(list);
  }

  @Get('token')
  @Throttle({ default: { ttl: 60000, limit: 40 } })
  async getToken(@Query('query') query: string) {
    const info = await this.prices.tokenInfo(query ?? '');
    return info ?? { error: `Couldn't find a token matching "${query ?? ''}"` };
  }

  @Get('top')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  getTop(@Query('limit') limit?: string) {
    return this.prices.topCoins(limit ? parseInt(limit, 10) : 10);
  }
}
