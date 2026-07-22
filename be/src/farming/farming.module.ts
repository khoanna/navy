import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { FarmingService } from './farming.service';
import { FarmingController } from './farming.controller';
import { CompoundYieldAdapter } from './compound-yield-adapter';
import { FarmingAgentScheduler, FARM_BOUNDS } from './farming-agent.scheduler';
import { DelegatedFundingService } from './delegated-funding.service';
import { DelegationService } from './delegation.service';
import { FARM_FUNDING_BOUNDS } from './farming.bounds';

@Module({
  imports: [WalletModule],
  controllers: [FarmingController],
  providers: [
    CompoundYieldAdapter, FarmingService, FarmingAgentScheduler,
    { provide: FARM_BOUNDS, useValue: {
      rentBuffer: parseInt(process.env.NAVY_FARM_RENT_BUFFER ?? '2000000', 10),
      minDeposit: parseInt(process.env.NAVY_FARM_MIN_DEPOSIT ?? '10000000', 10),
      maxDeposit: parseInt(process.env.NAVY_FARM_MAX_DEPOSIT ?? '1000000000', 10),
    } },
    DelegatedFundingService, DelegationService,
    { provide: FARM_FUNDING_BOUNDS, useValue: {
      reserve: BigInt(process.env.NAVY_FARM_USER_RESERVE ?? '5000000'),
      fundMin: BigInt(process.env.NAVY_FARM_FUND_MIN ?? '10000000'),
      fundMax: BigInt(process.env.NAVY_FARM_FUND_MAX ?? '1000000000'),
    } },
  ],
  exports: [FarmingService],
})
export class FarmingModule {}
