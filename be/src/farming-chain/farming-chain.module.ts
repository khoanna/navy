import { Module, Global } from '@nestjs/common';
import { FarmingChainService } from './farming-chain.service';

@Global()
@Module({
  providers: [FarmingChainService],
  exports: [FarmingChainService],
})
export class FarmingChainModule {}
