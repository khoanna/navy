import { Module } from '@nestjs/common';
import { PrivyService } from './privy.service';
import { SubwalletService } from './subwallet.service';
import { SigningService } from './signing.service';
import { PolicyValidator } from './policy.validator';
import { NavyConfigService } from '../config/config.service';

@Module({
  providers: [PrivyService, SubwalletService, SigningService, PolicyValidator, NavyConfigService],
  exports: [SubwalletService, SigningService],
})
export class WalletModule {}
