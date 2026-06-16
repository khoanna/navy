import { Module } from '@nestjs/common';
import { OnchainModule } from '../onchain/onchain.module';
import { WalletModule } from '../wallet/wallet.module';
import { FarmingService } from './farming.service';
import { FarmingController } from './farming.controller';
import { SaveYieldAdapter } from './save-yield-adapter';
import { FarmingAgentScheduler, FARM_BOUNDS } from './farming-agent.scheduler';

@Module({
  imports: [OnchainModule, WalletModule],
  controllers: [FarmingController],
  providers: [
    SaveYieldAdapter, FarmingService, FarmingAgentScheduler,
    { provide: FARM_BOUNDS, useValue: {
      rentBuffer: parseInt(process.env.NAVY_FARM_RENT_BUFFER ?? '2000000', 10),
      minDeposit: parseInt(process.env.NAVY_FARM_MIN_DEPOSIT ?? '10000000', 10),
      maxDeposit: parseInt(process.env.NAVY_FARM_MAX_DEPOSIT ?? '1000000000', 10),
    } },
  ],
})
export class FarmingModule {}
