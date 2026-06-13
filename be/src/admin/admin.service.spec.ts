import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { AdminService } from './admin.service';

const cfg = { adminMaxTotpFails: 3 } as any;

describe('AdminService.login', () => {
  it('returns the admin when password + TOTP are valid', async () => {
    const totpSecret = authenticator.generateSecret();
    const admin = {
      id: 'ad1', email: 'a@x.com',
      passwordHash: await argon2.hash('pw'), totpSecret, failedTotpCount: 0,
    };
    const prisma = {
      admin: { findUnique: jest.fn().mockResolvedValue(admin), update: jest.fn().mockResolvedValue(admin) },
    } as any;
    const svc = new AdminService(prisma, cfg);
    const result = await svc.login('a@x.com', 'pw', authenticator.generate(totpSecret));
    expect(result.id).toBe('ad1');
  });

  it('increments failedTotpCount and rejects a bad TOTP', async () => {
    const admin = {
      id: 'ad1', email: 'a@x.com',
      passwordHash: await argon2.hash('pw'), totpSecret: authenticator.generateSecret(), failedTotpCount: 0,
    };
    const update = jest.fn().mockResolvedValue(admin);
    const prisma = { admin: { findUnique: jest.fn().mockResolvedValue(admin), update } } as any;
    const svc = new AdminService(prisma, cfg);
    await expect(svc.login('a@x.com', 'pw', '000000')).rejects.toThrow(/TOTP/);
    expect(update).toHaveBeenCalledWith({ where: { id: 'ad1' }, data: { failedTotpCount: 1 } });
  });

  it('locks the account once failedTotpCount reaches the max', async () => {
    const admin = {
      id: 'ad1', email: 'a@x.com',
      passwordHash: await argon2.hash('pw'), totpSecret: authenticator.generateSecret(), failedTotpCount: 3,
    };
    const prisma = { admin: { findUnique: jest.fn().mockResolvedValue(admin), update: jest.fn() } } as any;
    const svc = new AdminService(prisma, cfg);
    await expect(svc.login('a@x.com', 'pw', '000000')).rejects.toThrow(/locked/);
  });
});
