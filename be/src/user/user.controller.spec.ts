import { UserController } from './user.controller';

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
  });

  it('rejects an invalid Privy token with 401', async () => {
    const privy = { verifyAccessToken: jest.fn().mockRejectedValue(new Error('bad')) };
    const ctrl = new UserController(privy as any, {} as any, {} as any, { record: jest.fn() } as any);
    await expect(ctrl.loginWithPrivy({ accessToken: 'x' })).rejects.toThrow();
  });
});
