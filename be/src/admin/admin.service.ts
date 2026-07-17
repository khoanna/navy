import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';

// Allow ±1 step (±30s) of clock skew between the authenticator app and the server.
authenticator.options = { window: 1 };

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly cfg: NavyConfigService) {}

  async login(email: string, password: string, totp: string) {
    const admin = await this.prisma.admin.findUnique({ where: { email } });
    if (!admin) throw new UnauthorizedException('Invalid credentials');

    const now = Date.now();
    // Time-boxed lockout: only blocks while the window is still active.
    if (admin.lockedUntil && admin.lockedUntil.getTime() > now) {
      throw new ForbiddenException('Account locked, try again later');
    }

    if (!(await argon2.verify(admin.passwordHash, password))) {
      await this.prisma.admin.update({
        where: { id: admin.id },
        data: { failedPasswordCount: admin.failedPasswordCount + 1 },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!authenticator.check(totp, admin.totpSecret)) {
      const nextCount = admin.failedTotpCount + 1;
      if (nextCount >= this.cfg.adminMaxTotpFails) {
        // Reset the counter and lock for the configured window; auto-unlocks after it passes.
        await this.prisma.admin.update({
          where: { id: admin.id },
          data: { failedTotpCount: 0, lockedUntil: new Date(now + this.cfg.adminLockWindowMs) },
        });
      } else {
        await this.prisma.admin.update({
          where: { id: admin.id },
          data: { failedTotpCount: nextCount },
        });
      }
      throw new UnauthorizedException('Invalid TOTP');
    }

    // Replay guard: a valid code whose step was already consumed is rejected.
    const currentStep = Math.floor(now / 1000 / 30);
    if (admin.lastTotpStep != null && currentStep <= admin.lastTotpStep) {
      throw new UnauthorizedException('Invalid TOTP (replay)');
    }

    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { failedTotpCount: 0, failedPasswordCount: 0, lockedUntil: null, lastTotpStep: currentStep },
    });
    return admin;
  }
}
