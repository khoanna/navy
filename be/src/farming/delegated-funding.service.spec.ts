import { Keypair, PublicKey } from '@solana/web3.js';
import { DelegatedFundingService } from './delegated-funding.service';
import { DelegatedPolicyValidator } from '../wallet/delegated-policy.validator';

const FAKE_SIG = Buffer.alloc(64, 1);

function build() {
  const relayer = Keypair.generate();
  const sub = Keypair.generate().publicKey.toBase58();
  const userKeypair = Keypair.generate();
  const userAddr = userKeypair.publicKey.toBase58();
  const chain = {
    relayer,
    connection: {
      getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: '11111111111111111111111111111111' }),
      sendRawTransaction: jest.fn().mockResolvedValue('sig-123'),
      confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
    },
  } as any;
  // Happy-path mock: add a fake user signature to the tx so the assertion passes.
  const privy = {
    signDelegatedTransaction: jest.fn(async ({ tx, address }) => {
      tx.addSignature(new PublicKey(address), FAKE_SIG);
      return tx;
    }),
  } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const bounds = { reserve: 5_000_000n, fundMin: 10_000_000n, fundMax: 1_000_000_000n };
  const svc = new DelegatedFundingService(privy, chain, audit, new DelegatedPolicyValidator(), bounds);
  return { svc, privy, audit, chain, sub, userAddr };
}

describe('DelegatedFundingService.fundSubwalletFromUser', () => {
  it('builds a bounded transfer to the subwallet, policy-checks, delegated-signs, submits, audits', async () => {
    const { svc, privy, audit, chain, sub, userAddr } = build();
    const res = await svc.fundSubwalletFromUser({
      userId: 'u1', privyDid: 'did:1', walletId: 'wallet-123',
      userAddress: userAddr, subwalletPubkey: sub, amountLamports: 20_000_000n,
    });
    expect(res).toEqual({ txSignature: 'sig-123' });
    expect(privy.signDelegatedTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: 'wallet-123', address: userAddr }),
    );
    expect(chain.connection.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'farming.delegated.fund' }));
  });

  it('denies + audits + throws when the amount is out of bounds (defense-in-depth)', async () => {
    const { svc, privy, audit, sub, userAddr } = build();
    await expect(svc.fundSubwalletFromUser({
      userId: 'u1', privyDid: 'did:1', walletId: 'w', userAddress: userAddr, subwalletPubkey: sub,
      amountLamports: 2_000_000_000n,
    })).rejects.toThrow(/out of bounds|denied/i);
    expect(privy.signDelegatedTransaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'farming.delegated.fund.denied' }));
  });

  it('throws and audits when Privy returns tx without the user signature', async () => {
    const { svc, privy, audit, chain, sub, userAddr } = build();
    // Override: return the tx without adding the user signature
    privy.signDelegatedTransaction.mockImplementationOnce(async ({ tx }) => tx);
    await expect(svc.fundSubwalletFromUser({
      userId: 'u1', privyDid: 'did:1', walletId: 'wallet-123',
      userAddress: userAddr, subwalletPubkey: sub, amountLamports: 20_000_000n,
    })).rejects.toThrow(/did not return a user signature/);
    expect(chain.connection.sendRawTransaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'farming.delegated.fund.unsigned' }));
  });
});
