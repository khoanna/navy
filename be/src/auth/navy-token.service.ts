import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { NavyConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

export type Role = 'user' | 'merchant' | 'admin';
export interface NavyClaims { sub: string; role: Role; walletAddress?: string }
export interface IssueInput { subjectId: string; role: Role; walletAddress?: string }

@Injectable()
export class NavyTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: NavyConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issue(input: IssueInput): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwt.sign(
      { sub: input.subjectId, role: input.role, walletAddress: input.walletAddress },
      { secret: this.cfg.jwtSecret, expiresIn: this.cfg.accessTtl },
    );
    const refreshToken = randomBytes(32).toString('hex');
    await this.prisma.authSession.create({
      data: {
        subjectId: input.subjectId,
        role: input.role,
        refreshTokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + this.cfg.refreshTtl * 1000),
      },
    });
    return { accessToken, refreshToken };
  }

  verifyAccess(token: string): NavyClaims {
    return this.jwt.verify<NavyClaims>(token, { secret: this.cfg.jwtSecret });
  }

  private hash(t: string): string { return createHash('sha256').update(t).digest('hex'); }
}
