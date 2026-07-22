import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentToolsService } from './agent-tools.service';
import { ConversationService } from './conversation.service';
import { PaymentsModule } from '../payments/payments.module';
import { FarmingModule } from '../farming/farming.module';
import { TransferModule } from '../transfer/transfer.module';
import { UserModule } from '../user/user.module';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [PaymentsModule, FarmingModule, TransferModule, UserModule, MarketModule],
  controllers: [AgentController],
  providers: [AgentService, AgentToolsService, ConversationService],
})
export class AgentModule {}
