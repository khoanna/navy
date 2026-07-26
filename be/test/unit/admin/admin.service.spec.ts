import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { AdminService } from '../../../src/admin/admin.service';

const cfg = { adminMaxTotpFails: 3, adminLockWindowMs: 15 * 60 * 1000 } as any;

// Deterministic clock: fix "now" so the TOTP step + lockout windows are stable.
const NOW = 1_700_000_000_000; // ms
const STEP = Math.floor(NOW / 1000 / 30);

function baseAdmin(overrides: any = {}) {
  return {
    id: 'ad1',
    email: 'a@x.com',
    passwordHash: null as any,
    totpSecret: authenticator.generateSecret(),
    failedTotpCount: 0,
    failedPasswordCount: 0,
    lastTotpStep: null,
    lockedUntil: null,
    ...overrides,
  };
}

describe('AdminService.login', () => {
  let nowSpy: jest.SpyInstance;
  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('returns the admin when password + TOTP are valid and records lastTotpStep', async () => {
    const admin = baseAdmin({ passwordHash: await argon2.hash('pw') });
    const update = jest.fn().mockResolvedValue(admin);
    const prisma = { admin: { findUnique: jest.fn().mockResolvedValue(admin), update } } as any;
    const svc = new AdminService(prisma, cfg);
    const result = await svc.login('a@x.com', 'pw', authenticator.generate(admin.totpSecret));
    expect(result.id).toBe('ad1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'ad1' },
      data: { failedTotpCount: 0, failedPasswordCount: 0, lockedUntil: null, lastTotpStep: STEP },
    });
  });

  it('increments failedTotpCount and rejects a bad TOTP', async () => {
    const admin = baseAdmin({ passwordHash: await argon2.hash('pw') });
    const update = jest.fn().mockResolvedValue(admin);
    const prisma = { admin: { findUnique: jest.fn().mockResolvedValue(admin), update } } as any;
    const svc = new AdminService(prisma, cfg);
    await expect(svc.login('a@x.com', 'pw', '000000')).rejects.toThrow(/TOTP/);
    expect(update).toHaveBeenCalledWith({ where: { id: 'ad1' }, data: { failedTotpCount: 1 } });
  });

  it('rejects a replayed TOTP code (currentStep <= lastTotpStep)', async () => {
    const admin = baseAdmin({ passwordHash: await argon2.hash('pw'), lastTotpStep: STEP });
    const update = jest.fn().mockResolvedValue(admin);
    const prisma = { admin: { findUnique: jest.fn().mockResolvedValue(admin), update } } as any;
    const svc = new AdminService(prisma, cfg);
    // A currently-valid code, but the step was already consumed → replay.
    await expect(svc.login('a@x.com', 'pw', authenticator.generate(admin.totpSecret))).rejects.toThrow(/replay|TOTP/i);
  });

  it('accepts a code once then rejects the same code on immediate reuse', async () => {
    // First login on a fresh admin, second login sees lastTotpStep already set to STEP.
    const secret = authenticator.generateSecret();
    const pwHash = await argon2.hash('pw');
    let stored = baseAdmin({ passwordHash: pwHash, totpSecret: secret });
    const update = jest.fn().mockImplementation(({ data }) => {
      stored = { ...stored, ...data };
      return Promise.resolve(stored);
    });
    const prisma = { admin: { findUnique: jest.fn().mockImplementation(() => Promise.resolve(stored)), update } } as any;
    const svc = new AdminService(prisma, cfg);
    const code = authenticator.generate(secret);
    await expect(svc.login('a@x.com', 'pw', code)).resolves.toBeDefined();
    // Same code, same clock → replay rejected.
    await expect(svc.login('a@x.com', 'pw', code)).rejects.toThrow(/replay|TOTP/i);
  });

  it('locks the account time-boxed once failedTotpCount+1 reaches the max', async () => {
    const admin = baseAdmin({ passwordHash: await argon2.hash('pw'), failedTotpCount: cfg.adminMaxTotpFails - 1 });
    const update = jest.fn().mockResolvedValue(admin);
    const prisma = { admin: { findUnique: jest.fn().mockResolvedValue(admin), update } } as any;
    const svc = new AdminService(prisma, cfg);
    await expect(svc.login('a@x.com', 'pw', '000000')).rejects.toThrow(/TOTP/);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'ad1' },
      data: { failedTotpCount: 0, lockedUntil: new Date(NOW + cfg.adminLockWindowMs) },
    });
  });

  it('rejects login while lockedUntil is in the future, even with a valid code', async () => {
    const admin = baseAdmin({
      passwordHash: await argon2.hash('pw'),
      lockedUntil: new Date(NOW + 60_000),
    });
    const prisma = { admin: { findUnique: jest.fn().mockResolvedValue(admin), update: jest.fn() } } as any;
    const svc = new AdminService(prisma, cfg);
    await expect(svc.login('a@x.com', 'pw', authenticator.generate(admin.totpSecret))).rejects.toThrow(/locked/);
  });

  it('allows login once the lockout window has passed', async () => {
    const admin = baseAdmin({
      passwordHash: await argon2.hash('pw'),
      lockedUntil: new Date(NOW - 60_000), // already expired
    });
    const update = jest.fn().mockResolvedValue(admin);
    const prisma = { admin: { findUnique: jest.fn().mockResolvedValue(admin), update } } as any;
    const svc = new AdminService(prisma, cfg);
    const result = await svc.login('a@x.com', 'pw', authenticator.generate(admin.totpSecret));
    expect(result.id).toBe('ad1');
  });

  it('increments failedPasswordCount on a bad password', async () => {
    const admin = baseAdmin({ passwordHash: await argon2.hash('pw') });
    const update = jest.fn().mockResolvedValue(admin);
    const prisma = { admin: { findUnique: jest.fn().mockResolvedValue(admin), update } } as any;
    const svc = new AdminService(prisma, cfg);
    await expect(svc.login('a@x.com', 'wrong', '000000')).rejects.toThrow(/Invalid credentials/);
    expect(update).toHaveBeenCalledWith({ where: { id: 'ad1' }, data: { failedPasswordCount: 1 } });
  });
});
