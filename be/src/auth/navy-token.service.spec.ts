import { JwtService } from '@nestjs/jwt';
import { NavyTokenService } from './navy-token.service';

const cfg = { jwtSecret: 'k'.repeat(32), accessTtl: 900, refreshTtl: 2592000 } as any;

function makeService() {
  const jwt = new JwtService({ secret: cfg.jwtSecret });
  const prisma = { authSession: { create: jest.fn().mockResolvedValue({}) } } as any;
  return new NavyTokenService(jwt, cfg, prisma);
}

describe('NavyTokenService', () => {
  it('issues an access token carrying sub/role/wallet and verifies it', async () => {
    const svc = makeService();
    const { accessToken } = await svc.issue({ subjectId: 'u1', role: 'user', walletAddress: 'PK' });
    const claims = svc.verifyAccess(accessToken);
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('user');
    expect(claims.walletAddress).toBe('PK');
  });

  it('persists a hashed refresh token (never plaintext)', async () => {
    const svc = makeService();
    const create = (svc as any).prisma.authSession.create;
    const { refreshToken } = await svc.issue({ subjectId: 'm1', role: 'merchant' });
    const stored = create.mock.calls[0][0].data.refreshTokenHash;
    expect(stored).not.toBe(refreshToken);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });
});
