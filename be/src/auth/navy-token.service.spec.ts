import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NavyTokenService } from './navy-token.service';

const cfg = { jwtSecret: 'k'.repeat(32), accessTtl: 900, refreshTtl: 2592000 } as any;

/** In-memory AuthSession store that mimics the Prisma methods we use. */
function makeStore() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    authSession: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `sid_${++seq}`, revokedAt: null, ...data };
        rows.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          rows.find((r) => {
            if (where.refreshTokenHash && r.refreshTokenHash !== where.refreshTokenHash) return false;
            if (where.id && r.id !== where.id) return false;
            if (where.revokedAt === null && r.revokedAt !== null) return false;
            if (where.expiresAt?.gt && !(r.expiresAt > where.expiresAt.gt)) return false;
            return true;
          }) ?? null
        );
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
  };
}

function makeService() {
  const jwt = new JwtService({ secret: cfg.jwtSecret });
  const prisma = makeStore() as any;
  return { svc: new NavyTokenService(jwt, cfg, prisma), prisma };
}

describe('NavyTokenService', () => {
  it('issues an access token carrying sub/role/wallet and verifies it', async () => {
    const { svc } = makeService();
    const { accessToken } = await svc.issue({ subjectId: 'u1', role: 'user', walletAddress: 'PK' });
    const claims = svc.verifyAccess(accessToken);
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('user');
    expect(claims.walletAddress).toBe('PK');
  });

  it('persists a hashed refresh token (never plaintext)', async () => {
    const { svc, prisma } = makeService();
    const create = prisma.authSession.create;
    const { refreshToken } = await svc.issue({ subjectId: 'm1', role: 'merchant' });
    const stored = create.mock.calls[0][0].data.refreshTokenHash;
    expect(stored).not.toBe(refreshToken);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });

  it('creates the session first and embeds its sid in the access JWT', async () => {
    const { svc, prisma } = makeService();
    const { accessToken } = await svc.issue({ subjectId: 'u1', role: 'user' });
    const claims = svc.verifyAccess(accessToken);
    expect(claims.sid).toBe('sid_1');
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].id).toBe('sid_1');
  });

  it('refresh rotates the refresh token, keeps the same sid, invalidates the old one', async () => {
    const { svc, prisma } = makeService();
    const first = await svc.issue({ subjectId: 'u1', role: 'user', walletAddress: 'PK' });
    const oldHash = prisma.rows[0].refreshTokenHash;

    const rotated = await svc.refresh(first.refreshToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.accessToken).toEqual(expect.any(String));

    // same sid preserved on the new access token
    const claims = svc.verifyAccess(rotated.accessToken);
    expect(claims.sid).toBe('sid_1');

    // the stored hash changed (rotation)
    expect(prisma.rows[0].refreshTokenHash).not.toBe(oldHash);

    // old refresh token no longer works
    await expect(svc.refresh(first.refreshToken)).rejects.toThrow(UnauthorizedException);

    // new refresh token works
    await expect(svc.refresh(rotated.refreshToken)).resolves.toBeDefined();
  });

  it('refresh preserves the walletAddress claim on the rotated access token', async () => {
    const { svc } = makeService();
    const first = await svc.issue({ subjectId: 'u1', role: 'user', walletAddress: 'PK' });
    const rotated = await svc.refresh(first.refreshToken);
    const claims = svc.verifyAccess(rotated.accessToken);
    expect(claims.walletAddress).toBe('PK');
    expect(claims.sid).toBe('sid_1');
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('user');
  });

  it('refresh on an unknown token throws Unauthorized', async () => {
    const { svc } = makeService();
    await expect(svc.refresh('deadbeef')).rejects.toThrow(UnauthorizedException);
  });

  it('refresh on a revoked session throws Unauthorized', async () => {
    const { svc, prisma } = makeService();
    const { refreshToken } = await svc.issue({ subjectId: 'u1', role: 'user' });
    prisma.rows[0].revokedAt = new Date();
    await expect(svc.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
  });

  it('refresh on an expired session throws Unauthorized', async () => {
    const { svc, prisma } = makeService();
    const { refreshToken } = await svc.issue({ subjectId: 'u1', role: 'user' });
    prisma.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
  });

  it('revoke sets revokedAt on the session', async () => {
    const { svc, prisma } = makeService();
    await svc.issue({ subjectId: 'u1', role: 'user' });
    expect(prisma.rows[0].revokedAt).toBeNull();
    await svc.revoke('sid_1');
    expect(prisma.rows[0].revokedAt).toBeInstanceOf(Date);
  });

  it('verifyAccessWithSession returns claims for a live session', async () => {
    const { svc } = makeService();
    const { accessToken } = await svc.issue({ subjectId: 'u1', role: 'user' });
    const claims = await svc.verifyAccessWithSession(accessToken);
    expect(claims.sub).toBe('u1');
    expect(claims.sid).toBe('sid_1');
  });

  it('verifyAccessWithSession rejects a revoked session', async () => {
    const { svc, prisma } = makeService();
    const { accessToken } = await svc.issue({ subjectId: 'u1', role: 'user' });
    prisma.rows[0].revokedAt = new Date();
    await expect(svc.verifyAccessWithSession(accessToken)).rejects.toThrow(UnauthorizedException);
  });

  it('verifyAccessWithSession rejects a token whose session is missing', async () => {
    const { svc, prisma } = makeService();
    const { accessToken } = await svc.issue({ subjectId: 'u1', role: 'user' });
    prisma.rows.length = 0; // session vanished
    await expect(svc.verifyAccessWithSession(accessToken)).rejects.toThrow(UnauthorizedException);
  });
});
