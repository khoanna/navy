import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { PrivyService } from '../wallet/privy.service';
import { UserService } from './user.service';
import { NavyTokenService } from '../auth/navy-token.service';
import { AuditService } from '../audit/audit.service';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsString } from 'class-validator';

class PrivyLoginDto {
  @IsString() @IsNotEmpty() accessToken!: string;
}

@Controller('auth')
export class UserController {
  constructor(
    private readonly privy: PrivyService,
    private readonly users: UserService,
    private readonly tokens: NavyTokenService,
    private readonly audit: AuditService,
  ) {}

  @Post('privy')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async loginWithPrivy(@Body() dto: PrivyLoginDto) {
    let verified;
    try { verified = await this.privy.verifyAccessToken(dto.accessToken); }
    catch {
      // Audit the failed login. Never log the access token.
      await this.audit.record({ actor: 'user:unknown', action: 'auth.user.login.failed', metadata: { reason: 'invalid_privy_token' } });
      throw new UnauthorizedException('Invalid Privy token');
    }
    const user = await this.users.upsertByDid(verified.userId, verified.wallet);
    await this.audit.record({ actor: `user:${user.id}`, action: 'auth.user.login' });
    return this.tokens.issue({ subjectId: user.id, role: 'user', walletAddress: user.primaryWallet ?? undefined });
  }
}
