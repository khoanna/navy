import { Module } from '@nestjs/common';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';
import { SrclaClient } from './srcla-client';
import { FarmingChainModule } from '../farming-chain/farming-chain.module';

@Module({
  imports: [FarmingChainModule],
  controllers: [VaultController],
  providers: [VaultService, SrclaClient],
  exports: [VaultService],
})
export class VaultModule {}
