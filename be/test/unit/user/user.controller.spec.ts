import { UserController } from '../../../src/user/user.controller';

describe('UserController POST /auth/privy', () => {
  it('verifies the Privy token, upserts the user, returns a Navy JWT', async () => {
    const privy = { verifyAccessToken: jest.fn().mockResolvedValue({ userId: 'did:privy:abc', wallet: 'PK' }) };
    const users = { upsertByDid: jest.fn().mockResolvedValue({ id: 'u1', primaryWallet: 'PK' }) };
    const tokens = { issue: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) };
    const audit = { record: jest.fn() };
    const ctrl = new UserController(privy as any, users as any, tokens as any, audit as any);

    const res = await ctrl.loginWithPrivy({ accessToken: 'privy-token' });

    expect(privy.verifyAccessToken).toHaveBeenCalledWith('privy-token');
    expect(users.upsertByDid).toHaveBeenCalledWith('did:privy:abc', 'PK');
    expect(tokens.issue).toHaveBeenCalledWith({ subjectId: 'u1', role: 'user', walletAddress: 'PK' });
    expect(res).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(audit.record).toHaveBeenCalledWith({ actor: 'user:u1', action: 'auth.user.login' });
  });

  it('rejects an invalid Privy token with 401 and audits the failure (no token in log)', async () => {
    const privy = { verifyAccessToken: jest.fn().mockRejectedValue(new Error('bad')) };
    const audit = { record: jest.fn() };
    const ctrl = new UserController(privy as any, {} as any, {} as any, audit as any);
    await expect(ctrl.loginWithPrivy({ accessToken: 'secret-token' })).rejects.toThrow();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.user.login.failed' }),
    );
    // The access token must never appear in the audit metadata.
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('secret-token');
  });
});
