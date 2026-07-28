import { Module } from '@nestjs/common';
import { PrivyService } from './privy.service';

@Module({
  providers: [PrivyService],
  exports: [PrivyService],
})
export class WalletModule {}
