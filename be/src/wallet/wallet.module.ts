import { Module } from '@nestjs/common';
import { PrivyService } from './privy.service';
import { SubwalletService } from './subwallet.service';
import { SigningService } from './signing.service';
import { PolicyValidator } from './policy.validator';

@Module({
  providers: [PrivyService, SubwalletService, SigningService, PolicyValidator],
  exports: [SubwalletService, SigningService],
})
export class WalletModule {}
