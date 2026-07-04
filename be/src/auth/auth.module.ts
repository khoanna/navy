import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NavyConfigService } from '../config/config.service';
import { NavyTokenService } from './navy-token.service';
import { JwtGuard } from './jwt.guard';
import { RolesGuard } from './roles.guard';
import { AuthController } from './auth.controller';

@Global()
@Module({
  imports: [JwtModule.registerAsync({
    inject: [NavyConfigService],
    useFactory: (cfg: NavyConfigService) => ({ secret: cfg.jwtSecret }),
  })],
  controllers: [AuthController],
  providers: [NavyTokenService, JwtGuard, RolesGuard],
  exports: [NavyTokenService, JwtGuard, RolesGuard],
})
export class AuthModule {}
