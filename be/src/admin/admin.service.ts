import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly cfg: NavyConfigService) {}

  async login(email: string, password: string, totp: string) {
    const admin = await this.prisma.admin.findUnique({ where: { email } });
    if (!admin) throw new UnauthorizedException('Invalid credentials');
    if (admin.failedTotpCount >= this.cfg.adminMaxTotpFails) throw new ForbiddenException('Account locked');
    if (!(await argon2.verify(admin.passwordHash, password))) throw new UnauthorizedException('Invalid credentials');
    if (!authenticator.check(totp, admin.totpSecret)) {
      await this.prisma.admin.update({ where: { id: admin.id }, data: { failedTotpCount: admin.failedTotpCount + 1 } });
      throw new UnauthorizedException('Invalid TOTP');
    }
    if (admin.failedTotpCount > 0) {
      await this.prisma.admin.update({ where: { id: admin.id }, data: { failedTotpCount: 0 } });
    }
    return admin;
  }
}
