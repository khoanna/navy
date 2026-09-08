import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { VaultController } from './vault.controller';
import { VaultController as VaultAdminController } from './vault-admin.controller';
import { VaultService } from './vault.service';
import { SrclaClient } from './srcla-client';
import { VaultEventWatcher } from './vault-event-watcher';
import { ProposalService } from './proposal.service';
import { VaultApyService } from './vault-apy.service';
import { VaultApyController } from './vault-apy.controller';

@Module({
  imports: [ScheduleModule],
  controllers: [
    VaultController,
    VaultAdminController,
    VaultApyController,
  ],
  providers: [VaultService, SrclaClient, VaultEventWatcher, ProposalService, VaultApyService],
  exports: [VaultService, VaultEventWatcher, ProposalService, VaultApyService],
})
export class VaultModule {}
