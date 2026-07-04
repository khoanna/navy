import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { OnchainModule } from '../onchain/onchain.module';

// PrismaModule is global; NAVY_ONCHAIN is exported by OnchainModule (also @Global,
// but import it explicitly for clarity).
@Module({
  imports: [OnchainModule],
  controllers: [HealthController],
})
export class HealthModule {}
