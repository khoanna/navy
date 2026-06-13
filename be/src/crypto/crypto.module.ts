import { Global, Module } from '@nestjs/common';
import { NavyConfigService } from '../config/config.service';
import { CIPHER } from './cipher.interface';
import { EnvelopeCipherService } from './cipher.service';

@Global()
@Module({
  providers: [{
    provide: CIPHER,
    inject: [NavyConfigService],
    useFactory: (cfg: NavyConfigService) => new EnvelopeCipherService(cfg.masterKey),
  }],
  exports: [CIPHER],
})
export class CryptoModule {}
