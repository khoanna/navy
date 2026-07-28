import { Module } from '@nestjs/common';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';
import { RebalancerService } from './rebalancer.service';

@Module({
  controllers: [VaultController],
  providers: [VaultService, RebalancerService],
  exports: [VaultService],
})
export class VaultModule {}
