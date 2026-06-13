import { Body, Controller, Post } from '@nestjs/common';
import { AdminService } from './admin.service';
import { NavyTokenService } from '../auth/navy-token.service';
import { AuditService } from '../audit/audit.service';

class AdminLoginDto { email!: string; password!: string; totp!: string; }

@Controller('auth')
export class AdminController {
  constructor(
    private readonly admins: AdminService,
    private readonly tokens: NavyTokenService,
    private readonly audit: AuditService,
  ) {}

  @Post('admin')
  async login(@Body() dto: AdminLoginDto) {
    const admin = await this.admins.login(dto.email, dto.password, dto.totp);
    await this.audit.record({ actor: `admin:${admin.id}`, action: 'auth.admin.login' });
    return this.tokens.issue({ subjectId: admin.id, role: 'admin' });
  }
}
