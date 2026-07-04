import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminController } from './admin.controller';

function make(login: jest.Mock) {
  const audit = { record: jest.fn() };
  const tokens = { issue: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) };
  const ctrl = new AdminController({ login } as any, tokens as any, audit as any);
  return { ctrl, audit, tokens };
}

const dto = { email: 'a@x.com', password: 'pw-secret', totp: '123456' };

describe('AdminController POST /auth/admin', () => {
  it('audits a successful login', async () => {
    const { ctrl, audit } = make(jest.fn().mockResolvedValue({ id: 'ad1' }));
    await ctrl.login(dto);
    expect(audit.record).toHaveBeenCalledWith({ actor: 'admin:ad1', action: 'auth.admin.login' });
  });

  it('audits a bad-password failure with reason', async () => {
    const { ctrl, audit } = make(jest.fn().mockRejectedValue(new UnauthorizedException('Invalid credentials')));
    await expect(ctrl.login(dto)).rejects.toThrow();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.admin.login.failed', target: 'a@x.com', metadata: { reason: 'bad_password' } }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('pw-secret');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('123456');
  });

  it('audits a bad-totp failure with reason', async () => {
    const { ctrl, audit } = make(jest.fn().mockRejectedValue(new UnauthorizedException('Invalid TOTP')));
    await expect(ctrl.login(dto)).rejects.toThrow();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.admin.login.failed', metadata: { reason: 'bad_totp' } }),
    );
  });

  it('audits a locked-account failure with reason', async () => {
    const { ctrl, audit } = make(jest.fn().mockRejectedValue(new ForbiddenException('Account locked, try again later')));
    await expect(ctrl.login(dto)).rejects.toThrow();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.admin.login.failed', metadata: { reason: 'locked' } }),
    );
  });
});
