import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';

function ctxWith(token: string): ExecutionContext {
  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('JwtGuard (session-checked)', () => {
  it('accepts a valid token whose session is live and attaches claims', async () => {
    const claims = { sub: 'u1', role: 'user', sid: 'sid_1' };
    const tokens = { verifyAccessWithSession: jest.fn().mockResolvedValue(claims) } as any;
    const guard = new JwtGuard(tokens);
    const ctx = ctxWith('good');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.switchToHttp().getRequest().user).toEqual(claims);
  });

  it('rejects a valid token whose session was revoked', async () => {
    const tokens = {
      verifyAccessWithSession: jest.fn().mockRejectedValue(new UnauthorizedException('revoked')),
    } as any;
    const guard = new JwtGuard(tokens);
    await expect(guard.canActivate(ctxWith('revoked'))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a malformed/invalid token', async () => {
    const tokens = {
      verifyAccessWithSession: jest.fn().mockRejectedValue(new Error('bad jwt')),
    } as any;
    const guard = new JwtGuard(tokens);
    await expect(guard.canActivate(ctxWith('junk'))).rejects.toThrow(UnauthorizedException);
  });
});
