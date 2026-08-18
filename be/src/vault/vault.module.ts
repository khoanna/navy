import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { VaultController } from './vault.controller';
import { VaultController as VaultAdminController } from './vault-admin.controller';
import { VaultService } from './vault.service';
import { SrclaClient } from './srcla-client';
import { VaultEventWatcher } from './vault-event-watcher';
import { ProposalService } from './proposal.service';

@Module({
  imports: [ScheduleModule],
  controllers: [VaultController, VaultAdminController],
  providers: [VaultService, SrclaClient, VaultEventWatcher, ProposalService],
  exports: [VaultService, VaultEventWatcher, ProposalService],
})
export class VaultModule {}
