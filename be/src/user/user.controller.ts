import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { PrivyService } from '../wallet/privy.service';
import { UserService } from './user.service';
import { NavyTokenService } from '../auth/navy-token.service';
import { AuditService } from '../audit/audit.service';

class PrivyLoginDto { accessToken!: string; }

@Controller('auth')
export class UserController {
  constructor(
    private readonly privy: PrivyService,
    private readonly users: UserService,
    private readonly tokens: NavyTokenService,
    private readonly audit: AuditService,
  ) {}

  @Post('privy')
  async loginWithPrivy(@Body() dto: PrivyLoginDto) {
    let verified;
    try { verified = await this.privy.verifyAccessToken(dto.accessToken); }
    catch { throw new UnauthorizedException('Invalid Privy token'); }
    const user = await this.users.upsertByDid(verified.userId, verified.wallet);
    await this.audit.record({ actor: `user:${user.id}`, action: 'auth.privy.login' });
    return this.tokens.issue({ subjectId: user.id, role: 'user', walletAddress: user.primaryWallet ?? undefined });
  }
}
