import { PrivyService } from './privy.service';

// Mock the Privy SDK so the constructor never validates the authorization key format.
// Individual tests inject a fake `client` object after construction.
jest.mock('@privy-io/server-auth', () => ({
  PrivyClient: jest.fn().mockImplementation(() => ({})),
}));

function makeService(authKey?: string) {
  const cfg = { privyAppId: 'app', privyAppSecret: 'secret', privyAuthorizationKey: authKey } as any;
  return new PrivyService(cfg);
}

describe('PrivyService.getDelegatedWallet', () => {
  it('returns the delegated ethereum wallet id + address', async () => {
    const svc = makeService('k');
    (svc as any).client = {
      getUser: jest.fn().mockResolvedValue({
        linkedAccounts: [
          { type: 'email', address: 'a@b.c' },
          { type: 'wallet', chainType: 'ethereum', delegated: true, id: 'wallet-123', address: '0xabc' },
        ],
      }),
    };
    await expect(svc.getDelegatedWallet('did:1')).resolves.toEqual({ walletId: 'wallet-123', address: '0xabc' });
  });
  it('returns null when no delegated ethereum wallet exists', async () => {
    const svc = makeService('k');
    (svc as any).client = {
      getUser: jest.fn().mockResolvedValue({
        linkedAccounts: [{ type: 'wallet', chainType: 'ethereum', delegated: false, id: 'w', address: '0x1' }],
      }),
    };
    await expect(svc.getDelegatedWallet('did:1')).resolves.toBeNull();
  });
});

describe('PrivyService.sendDelegatedTransaction', () => {
  it('throws when the authorization key is not configured', async () => {
    const svc = makeService(undefined);
    await expect(svc.sendDelegatedTransaction({ address: '0x1', to: '0x2', chainId: 11155111 }))
      .rejects.toThrow(/not configured/);
  });
  it('calls walletApi.ethereum.sendTransaction with walletId + caip2 + idempotencyKey and returns the hash', async () => {
    const svc = makeService('k');
    const sendMock = jest.fn().mockResolvedValue({ hash: '0xdeadbeef', caip2: 'eip155:11155111' });
    (svc as any).client = { walletApi: { ethereum: { sendTransaction: sendMock } } };
    const out = await svc.sendDelegatedTransaction({
      walletId: 'wallet-123', address: '0x1', to: '0xusdc', data: '0xcalldata', chainId: 11155111, idempotencyKey: 'idem-1',
    });
    expect(out).toEqual({ hash: '0xdeadbeef' });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      walletId: 'wallet-123',
      caip2: 'eip155:11155111',
      idempotencyKey: 'idem-1',
      transaction: expect.objectContaining({ to: '0xusdc', data: '0xcalldata' }),
    }));
  });
});
