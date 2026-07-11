import { ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { DelegationService } from './delegation.service';

function build(authKey?: string) {
  // Use valid base58 public key strings so new PublicKey(...) doesn't throw
  const USER_ADDR = '11111111111111111111111111111111'; // system program — valid 32-byte pubkey
  const SUB_ADDR  = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf8Ss623VQ5DA'; // token program — valid 32-byte pubkey
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR, farmDelegationEnabledAt: null, farmDelegationWalletId: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    farmingSubwallet: { findFirst: jest.fn().mockResolvedValue({ id: 's1', pubkey: SUB_ADDR, userId: 'u1' }) },
  } as any;
  const cfg = { privyAuthorizationKey: authKey } as any;
  const privy = { getDelegatedWallet: jest.fn().mockResolvedValue({ walletId: 'wallet-123', address: USER_ADDR }) } as any;
  const funding = { fundSubwalletFromUser: jest.fn().mockResolvedValue({ txSignature: 'sig-1' }) } as any;
  const farming = { createSubwallet: jest.fn().mockResolvedValue({ subwalletId: 's1', address: 'SubAddr' }) } as any;
  const chain = { connection: { getBalance: jest.fn().mockResolvedValue(25_000_000) } } as any;
  const bounds = { reserve: 5_000_000n, fundMin: 10_000_000n, fundMax: 1_000_000_000n };
  const svc = new DelegationService(prisma, cfg, privy, funding, farming, chain, bounds);
  return { svc, prisma, privy, funding, farming };
}

describe('DelegationService', () => {
  it('status reports available=false when no auth key', async () => {
    const { svc } = build(undefined);
    await expect(svc.status('u1')).resolves.toEqual({ available: false, enabled: false });
  });

  it('enable throws ServiceUnavailable without an auth key', async () => {
    const { svc } = build(undefined);
    await expect(svc.enable('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('enable stores the walletId + timestamp when the wallet is delegated', async () => {
    const { svc, prisma } = build('k');
    await svc.enable('u1');
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({ farmDelegationWalletId: 'wallet-123' }),
    }));
  });

  it('enable rejects when the wallet is not delegated', async () => {
    const { svc, privy } = build('k');
    privy.getDelegatedWallet.mockResolvedValueOnce(null);
    await expect(svc.enable('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fundNow funds the subwallet with the computed amount', async () => {
    const { svc, funding } = build('k');
    const USER_ADDR = '11111111111111111111111111111111';
    const SUB_ADDR  = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf8Ss623VQ5DA';
    (svc as any).prisma.user.findUnique.mockResolvedValue({ id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR, farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123' });
    (svc as any).prisma.farmingSubwallet.findFirst.mockResolvedValue({ id: 's1', pubkey: SUB_ADDR, userId: 'u1' });
    const res = await svc.fundNow('u1');
    expect(funding.fundSubwalletFromUser).toHaveBeenCalledWith(expect.objectContaining({ amountLamports: 20_000_000n, subwalletPubkey: SUB_ADDR }));
    expect(res).toEqual({ txSignature: 'sig-1' });
  });

  it('fundNow skips when spare balance is insufficient', async () => {
    const { svc, funding } = build('k');
    const USER_ADDR = '11111111111111111111111111111111';
    const SUB_ADDR  = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf8Ss623VQ5DA';
    (svc as any).prisma.user.findUnique.mockResolvedValue({ id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR, farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123' });
    (svc as any).prisma.farmingSubwallet.findFirst.mockResolvedValue({ id: 's1', pubkey: SUB_ADDR, userId: 'u1' });
    (svc as any).chain.connection.getBalance.mockResolvedValue(6_000_000);
    const res = await svc.fundNow('u1');
    expect(funding.fundSubwalletFromUser).not.toHaveBeenCalled();
    expect(res).toEqual({ skipped: 'insufficient balance' });
  });

  it('fundNow throws ServiceUnavailableException when built without an auth key', async () => {
    const { svc } = build(undefined);
    await expect(svc.fundNow('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('autoFundSubwallet returns skipped when user delegation is not enabled', async () => {
    const { svc } = build('k');
    // default mock has farmDelegationEnabledAt: null
    const sw = { id: 's1', pubkey: '11111111111111111111111111111111', userId: 'u1' };
    const res = await svc.autoFundSubwallet(sw);
    expect(res).toEqual({ skipped: 'not enabled' });
  });

  it('autoFundSubwallet returns skipped when there is no auth key even if user looks enabled', async () => {
    const { svc } = build(undefined);
    const USER_ADDR = '11111111111111111111111111111111';
    (svc as any).prisma.user.findUnique.mockResolvedValue({
      id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR,
      farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123',
    });
    const sw = { id: 's1', pubkey: '11111111111111111111111111111111', userId: 'u1' };
    const res = await svc.autoFundSubwallet(sw);
    expect(res).toEqual({ skipped: 'not enabled' });
  });

  it('autoFundSubwallet calls fundSubwalletFromUser and returns its result when fully enabled', async () => {
    const { svc, funding } = build('k');
    const USER_ADDR = '11111111111111111111111111111111';
    (svc as any).prisma.user.findUnique.mockResolvedValue({
      id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR,
      farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123',
    });
    const sw = { id: 's1', pubkey: '11111111111111111111111111111111', userId: 'u1' };
    const res = await svc.autoFundSubwallet(sw);
    expect(funding.fundSubwalletFromUser).toHaveBeenCalledWith(
      expect.objectContaining({ subwalletPubkey: '11111111111111111111111111111111' }),
    );
    expect(res).toEqual({ txSignature: 'sig-1' });
  });
});
