import { Module } from '@nestjs/common';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';
import { RebalancerService } from './rebalancer.service';
import { VaultWatcherService } from './vault-watcher.service';

@Module({
  controllers: [VaultController],
  providers: [VaultService, RebalancerService, VaultWatcherService],
  exports: [VaultService],
})
export class VaultModule {}
