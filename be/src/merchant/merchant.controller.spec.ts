import { UnauthorizedException } from '@nestjs/common';
import { MerchantController } from './merchant.controller';

describe('MerchantController POST /auth/merchant', () => {
  it('audits a successful login', async () => {
    const merchants = { login: jest.fn().mockResolvedValue({ id: 'm1' }) };
    const tokens = { issue: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) };
    const audit = { record: jest.fn() };
    const ctrl = new MerchantController(merchants as any, tokens as any, audit as any);

    const res = await ctrl.login({ email: 'm@x.com', password: 'pw-secret' });

    expect(res).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(audit.record).toHaveBeenCalledWith({ actor: 'merchant:m1', action: 'auth.merchant.login' });
  });

  it('audits a failed login with the email as target and no password', async () => {
    const merchants = { login: jest.fn().mockRejectedValue(new UnauthorizedException('Invalid credentials')) };
    const audit = { record: jest.fn() };
    const ctrl = new MerchantController(merchants as any, {} as any, audit as any);

    await expect(ctrl.login({ email: 'm@x.com', password: 'pw-secret' })).rejects.toThrow();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.merchant.login.failed', target: 'm@x.com' }),
    );
    // The password must never appear in the audit metadata.
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('pw-secret');
  });
});
