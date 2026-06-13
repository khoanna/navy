import { Global, Module } from '@nestjs/common';
import { NavyConfigService } from './config.service';

@Global()
@Module({
  providers: [{ provide: NavyConfigService, useFactory: () => new NavyConfigService(process.env) }],
  exports: [NavyConfigService],
})
export class NavyConfigModule {}
