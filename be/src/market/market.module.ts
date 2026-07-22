import { Module } from '@nestjs/common';
import { MarketController } from './market.controller';
import { PriceService } from './price.service';

@Module({
  controllers: [MarketController],
  providers: [PriceService],
  exports: [PriceService],
})
export class MarketModule {}
