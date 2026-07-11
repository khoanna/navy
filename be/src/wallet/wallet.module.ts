import { Module } from '@nestjs/common';
import { PrivyService } from './privy.service';
import { SubwalletService } from './subwallet.service';
import { SigningService } from './signing.service';
import { PolicyValidator } from './policy.validator';
import { DelegatedPolicyValidator } from './delegated-policy.validator';

@Module({
  providers: [PrivyService, SubwalletService, SigningService, PolicyValidator, DelegatedPolicyValidator],
  exports: [SubwalletService, SigningService, PrivyService, DelegatedPolicyValidator],
})
export class WalletModule {}
