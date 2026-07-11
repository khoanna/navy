import { SystemProgram, Transaction, Keypair } from '@solana/web3.js';
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
  it('returns the delegated solana wallet id + address', async () => {
    const svc = makeService('k');
    (svc as any).client = {
      getUser: jest.fn().mockResolvedValue({
        linkedAccounts: [
          { type: 'email', address: 'a@b.c' },
          { type: 'wallet', chainType: 'solana', delegated: true, id: 'wallet-123', address: 'SoLaddr' },
        ],
      }),
    };
    await expect(svc.getDelegatedWallet('did:1')).resolves.toEqual({ walletId: 'wallet-123', address: 'SoLaddr' });
  });
  it('returns null when no delegated solana wallet exists', async () => {
    const svc = makeService('k');
    (svc as any).client = {
      getUser: jest.fn().mockResolvedValue({
        linkedAccounts: [{ type: 'wallet', chainType: 'solana', delegated: false, id: 'w', address: 'x' }],
      }),
    };
    await expect(svc.getDelegatedWallet('did:1')).resolves.toBeNull();
  });
});

describe('PrivyService.signDelegatedTransaction', () => {
  it('throws when the authorization key is not configured', async () => {
    const svc = makeService(undefined);
    const tx = new Transaction();
    await expect(svc.signDelegatedTransaction({ address: 'x', tx })).rejects.toThrow(/not configured/);
  });
  it('calls walletApi.solana.signTransaction with walletId + idempotencyKey and returns the signed tx', async () => {
    const svc = makeService('k');
    const kp = Keypair.generate();
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
    tx.feePayer = kp.publicKey;
    tx.recentBlockhash = '11111111111111111111111111111111';
    const signMock = jest.fn().mockResolvedValue({ signedTransaction: tx });
    (svc as any).client = { walletApi: { solana: { signTransaction: signMock } } };
    const out = await svc.signDelegatedTransaction({ walletId: 'wallet-123', address: 'x', tx, idempotencyKey: 'idem-1' });
    expect(out).toBe(tx);
    expect(signMock).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'wallet-123', transaction: tx, idempotencyKey: 'idem-1' }));
  });
});
