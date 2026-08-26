import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { VaultController } from './vault.controller';
import { VaultController as VaultAdminController } from './vault-admin.controller';
import { VaultService } from './vault.service';
import { SrclaClient } from './srcla-client';
import { VaultEventWatcher } from './vault-event-watcher';
import { ProposalService } from './proposal.service';
import { VaultDepositService } from './vault-deposit.service';
import { VaultDepositController, VaultRedeemController } from './vault-deposit.controller';

@Module({
  imports: [ScheduleModule],
  controllers: [VaultController, VaultAdminController, VaultDepositController, VaultRedeemController],
  providers: [VaultService, SrclaClient, VaultEventWatcher, ProposalService, VaultDepositService],
  exports: [VaultService, VaultEventWatcher, ProposalService, VaultDepositService],
})
export class VaultModule {}
