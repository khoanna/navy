import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// PrismaModule and EvmModule are both @Global; NAVY_EVM is available without importing.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
