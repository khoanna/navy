import { ethers } from 'ethers';
import { DelegatedFundingService } from './delegated-funding.service';
import { DelegatedPolicyValidator } from '../wallet/delegated-policy.validator';

// Circle USDC (Sepolia) — the unified farming + payment token (evm.usdcAddress).
const USDC = ethers.getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
const SUB = ethers.Wallet.createRandom().address;
const USER = ethers.Wallet.createRandom().address;

function build() {
  const evm = { usdcDomain: { chainId: 11155111 }, usdcAddress: USDC, provider: {} } as any;
  // Happy-path: Privy broadcasts and returns a hash.
  const privy = { sendDelegatedTransaction: jest.fn().mockResolvedValue({ hash: '0xhash' }) } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const bounds = { reserve: 5_000_000n, fundMin: 10_000_000n, fundMax: 1_000_000_000n };
  const svc = new DelegatedFundingService(privy, evm, audit, new DelegatedPolicyValidator(), bounds);
  return { svc, privy, audit };
}

describe('DelegatedFundingService.fundSubwalletFromUser', () => {
  it('builds a bounded USDC transfer to the subwallet, policy-checks, delegated-sends, audits', async () => {
    const { svc, privy, audit } = build();
    const res = await svc.fundSubwalletFromUser({
      userId: 'u1', privyDid: 'did:1', walletId: 'wallet-123',
      userAddress: USER, subwalletPubkey: SUB, amountLamports: 20_000_000n,
    });
    expect(res).toEqual({ txSignature: '0xhash' });
    // The call is a real ERC-20 transfer(subwallet, amount) to Circle USDC.
    const arg = privy.sendDelegatedTransaction.mock.calls[0][0];
    expect(arg).toEqual(expect.objectContaining({ walletId: 'wallet-123', address: USER, to: USDC, chainId: 11155111 }));
    const iface = new ethers.Interface(['function transfer(address to, uint256 value)']);
    const [to, value] = iface.decodeFunctionData('transfer', arg.data);
    expect(ethers.getAddress(to)).toBe(SUB);
    expect(value).toBe(20_000_000n);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'farming.delegated.fund' }));
  });

  it('denies + audits + throws when the amount is out of bounds (defense-in-depth)', async () => {
    const { svc, privy, audit } = build();
    await expect(svc.fundSubwalletFromUser({
      userId: 'u1', privyDid: 'did:1', walletId: 'w', userAddress: USER, subwalletPubkey: SUB,
      amountLamports: 2_000_000_000n,
    })).rejects.toThrow(/out of bounds|denied/i);
    expect(privy.sendDelegatedTransaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'farming.delegated.fund.denied' }));
  });

  it('throws and audits when Privy returns no transaction hash', async () => {
    const { svc, privy, audit } = build();
    privy.sendDelegatedTransaction.mockResolvedValueOnce({ hash: undefined });
    await expect(svc.fundSubwalletFromUser({
      userId: 'u1', privyDid: 'did:1', walletId: 'wallet-123',
      userAddress: USER, subwalletPubkey: SUB, amountLamports: 20_000_000n,
    })).rejects.toThrow(/did not return a transaction hash/);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'farming.delegated.fund.unsigned' }));
  });
});
