import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { NavyConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

export type Role = 'user' | 'merchant' | 'admin';
export interface NavyClaims { sub: string; role: Role; walletAddress?: string; sid: string }
export interface IssueInput { subjectId: string; role: Role; walletAddress?: string }

@Injectable()
export class NavyTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: NavyConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issue(input: IssueInput): Promise<{ accessToken: string; refreshToken: string }> {
    const refreshToken = randomBytes(32).toString('hex');
    // Create the session first so we can bind the access token to its id (sid).
    const session = await this.prisma.authSession.create({
      data: {
        subjectId: input.subjectId,
        role: input.role,
        refreshTokenHash: this.hash(refreshToken),
        walletAddress: input.walletAddress ?? null,
        expiresAt: new Date(Date.now() + this.cfg.refreshTtl * 1000),
      },
    });
    const accessToken = this.signAccess({
      sub: input.subjectId,
      role: input.role,
      walletAddress: input.walletAddress,
      sid: session.id,
    });
    return { accessToken, refreshToken };
  }

  /** Rotate the refresh token for a live session and mint a fresh access token bound to the SAME sid. */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const session = await this.prisma.authSession.findFirst({
      where: { refreshTokenHash: this.hash(refreshToken), revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!session) throw new UnauthorizedException('Invalid refresh token');

    const newRefreshToken = randomBytes(32).toString('hex');
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: this.hash(newRefreshToken),
        expiresAt: new Date(Date.now() + this.cfg.refreshTtl * 1000),
      },
    });
    const accessToken = this.signAccess({
      sub: session.subjectId,
      role: session.role as Role,
      walletAddress: session.walletAddress ?? undefined,
      sid: session.id,
    });
    return { accessToken, refreshToken: newRefreshToken };
  }

  /** Revoke a session by its id (sid); subsequent access tokens & refreshes are rejected. */
  async revoke(sid: string): Promise<void> {
    await this.prisma.authSession.update({ where: { id: sid }, data: { revokedAt: new Date() } });
  }

  /** Verify the JWT signature only. For internal use where session state is not relevant. */
  verifyAccess(token: string): NavyClaims {
    return this.jwt.verify<NavyClaims>(token, { secret: this.cfg.jwtSecret });
  }

  /** Verify the JWT AND ensure its session still exists and is not revoked. */
  async verifyAccessWithSession(token: string): Promise<NavyClaims> {
    const claims = this.verifyAccess(token);
    const session = await this.prisma.authSession.findUnique({ where: { id: claims.sid } });
    if (!session || session.revokedAt !== null) throw new UnauthorizedException('Session revoked');
    return claims;
  }

  private signAccess(payload: { sub: string; role: Role; walletAddress?: string; sid: string }): string {
    return this.jwt.sign(
      { sub: payload.sub, role: payload.role, walletAddress: payload.walletAddress, sid: payload.sid },
      { secret: this.cfg.jwtSecret, expiresIn: this.cfg.accessTtl },
    );
  }

  private hash(t: string): string { return createHash('sha256').update(t).digest('hex'); }
}
