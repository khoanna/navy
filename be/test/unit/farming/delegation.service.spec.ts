import { ethers } from 'ethers';
import { ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { DelegationService } from '../../../src/farming/delegation.service';

const USER_ADDR = ethers.Wallet.createRandom().address;
const SUB_ADDR = ethers.Wallet.createRandom().address;

function build(authKey?: string) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR, farmDelegationEnabledAt: null, farmDelegationWalletId: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    farmingSubwallet: { findFirst: jest.fn().mockResolvedValue({ id: 's1', pubkey: SUB_ADDR, userId: 'u1' }) },
  } as any;
  const cfg = { privyAuthorizationKey: authKey } as any;
  const privy = { getDelegatedWallet: jest.fn().mockResolvedValue({ walletId: 'wallet-123', address: USER_ADDR }) } as any;
  const funding = { fundSubwalletFromUser: jest.fn().mockResolvedValue({ txSignature: '0xsig' }) } as any;
  const farming = { createSubwallet: jest.fn().mockResolvedValue({ subwalletId: 's1', address: SUB_ADDR }) } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const evm = { provider: {} } as any;
  const bounds = { reserve: 5_000_000n, fundMin: 10_000_000n, fundMax: 1_000_000_000n };
  const svc = new DelegationService(prisma, cfg, privy, funding, farming, audit, evm, bounds);
  const setBalance = (value: bigint) => { (svc as any)._usdc = { balanceOf: jest.fn().mockResolvedValue(value) }; };
  return { svc, prisma, privy, funding, farming, audit, setBalance };
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

  it('enable rejects when the wallet is not delegated (all retries exhausted)', async () => {
    const { svc, privy } = build('k');
    privy.getDelegatedWallet.mockResolvedValue(null);
    await expect(svc.enable('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enable succeeds when getDelegatedWallet returns null then a wallet (retry)', async () => {
    const { svc, privy, prisma } = build('k');
    privy.getDelegatedWallet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ walletId: 'w', address: USER_ADDR });
    const result = await svc.enable('u1');
    expect(result).toEqual({ available: true, enabled: true });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ farmDelegationWalletId: 'w' }),
    }));
  });

  it('fundNow funds the subwallet with the computed amount', async () => {
    const { svc, funding, setBalance } = build('k');
    setBalance(25_000_000n);
    (svc as any).prisma.user.findUnique.mockResolvedValue({ id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR, farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123' });
    (svc as any).prisma.farmingSubwallet.findFirst.mockResolvedValue({ id: 's1', pubkey: SUB_ADDR, userId: 'u1' });
    const res = await svc.fundNow('u1');
    expect(funding.fundSubwalletFromUser).toHaveBeenCalledWith(expect.objectContaining({ amountBase: 20_000_000n, subwalletPubkey: SUB_ADDR }));
    expect(res).toEqual({ txSignature: '0xsig' });
  });

  it('fundNow skips when spare balance is insufficient', async () => {
    const { svc, funding, setBalance } = build('k');
    setBalance(6_000_000n);
    (svc as any).prisma.user.findUnique.mockResolvedValue({ id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR, farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123' });
    (svc as any).prisma.farmingSubwallet.findFirst.mockResolvedValue({ id: 's1', pubkey: SUB_ADDR, userId: 'u1' });
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
    const sw = { id: 's1', pubkey: SUB_ADDR, userId: 'u1' };
    const res = await svc.autoFundSubwallet(sw);
    expect(res).toEqual({ skipped: 'not enabled' });
  });

  it('autoFundSubwallet returns skipped when there is no auth key even if user looks enabled', async () => {
    const { svc } = build(undefined);
    (svc as any).prisma.user.findUnique.mockResolvedValue({
      id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR,
      farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123',
    });
    const sw = { id: 's1', pubkey: SUB_ADDR, userId: 'u1' };
    const res = await svc.autoFundSubwallet(sw);
    expect(res).toEqual({ skipped: 'not enabled' });
  });

  it('autoFundSubwallet calls fundSubwalletFromUser and returns its result when fully enabled', async () => {
    const { svc, funding, setBalance } = build('k');
    setBalance(25_000_000n);
    (svc as any).prisma.user.findUnique.mockResolvedValue({
      id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR,
      farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123',
    });
    const sw = { id: 's1', pubkey: SUB_ADDR, userId: 'u1' };
    const res = await svc.autoFundSubwallet(sw);
    expect(funding.fundSubwalletFromUser).toHaveBeenCalledWith(
      expect.objectContaining({ subwalletPubkey: SUB_ADDR }),
    );
    expect(res).toEqual({ txSignature: '0xsig' });
  });

  it('fundNow clears delegation flags and throws when signing fails and wallet is no longer delegated', async () => {
    const { svc, funding, privy, prisma, setBalance } = build('k');
    setBalance(25_000_000n);
    (svc as any).prisma.user.findUnique.mockResolvedValue({
      id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR,
      farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123',
    });
    (svc as any).prisma.farmingSubwallet.findFirst.mockResolvedValue({ id: 's1', pubkey: SUB_ADDR, userId: 'u1' });
    funding.fundSubwalletFromUser.mockRejectedValueOnce(new Error('Delegated signing did not return a transaction hash'));
    privy.getDelegatedWallet.mockResolvedValueOnce(null);

    await expect(svc.fundNow('u1')).rejects.toThrow(/delegation was revoked/i);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { farmDelegationWalletId: null, farmDelegationEnabledAt: null },
    });
  });

  it('fundNow records farming.delegated.fund.error and rethrows when signing fails but wallet is still delegated', async () => {
    const { svc, funding, privy, audit, setBalance } = build('k');
    setBalance(25_000_000n);
    (svc as any).prisma.user.findUnique.mockResolvedValue({
      id: 'u1', privyDid: 'did:1', primaryWallet: USER_ADDR,
      farmDelegationEnabledAt: new Date(), farmDelegationWalletId: 'wallet-123',
    });
    (svc as any).prisma.farmingSubwallet.findFirst.mockResolvedValue({ id: 's1', pubkey: SUB_ADDR, userId: 'u1' });
    const fundError = new Error('RPC timeout');
    funding.fundSubwalletFromUser.mockRejectedValueOnce(fundError);
    privy.getDelegatedWallet.mockResolvedValueOnce({ walletId: 'wallet-123', address: USER_ADDR });

    await expect(svc.fundNow('u1')).rejects.toThrow('RPC timeout');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'user:u1',
      action: 'farming.delegated.fund.error',
      metadata: expect.objectContaining({ subwallet: SUB_ADDR, error: 'RPC timeout' }),
    }));
  });
});
