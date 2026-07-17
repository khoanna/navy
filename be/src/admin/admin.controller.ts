import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AdminService } from './admin.service';
import { NavyTokenService } from '../auth/navy-token.service';
import { AuditService } from '../audit/audit.service';

class AdminLoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @IsString() @Matches(/^\d{6}$/) totp!: string;
}

@Controller('auth')
export class AdminController {
  constructor(
    private readonly admins: AdminService,
    private readonly tokens: NavyTokenService,
    private readonly audit: AuditService,
  ) {}

  @Post('admin')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async login(@Body() dto: AdminLoginDto) {
    let admin;
    try {
      admin = await this.admins.login(dto.email, dto.password, dto.totp);
    } catch (e) {
      // Classify the failure (bad password / bad totp / locked) for the audit trail —
      // NEVER log the password or the TOTP code.
      const msg = (e as Error).message ?? '';
      let reason: 'locked' | 'bad_totp' | 'bad_password' = 'bad_password';
      if (/locked/i.test(msg)) reason = 'locked';
      else if (/totp/i.test(msg)) reason = 'bad_totp';
      await this.audit.record({
        actor: `admin:${dto.email}`,
        action: 'auth.admin.login.failed',
        target: dto.email,
        metadata: { reason },
      });
      throw e;
    }
    await this.audit.record({ actor: `admin:${admin.id}`, action: 'auth.admin.login' });
    return this.tokens.issue({ subjectId: admin.id, role: 'admin' });
  }
}
