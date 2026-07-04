import { Keypair, PublicKey } from '@solana/web3.js';
import { RegistrarService } from './registrar.service';
import { merchantIdFromUuid } from './payments-client';

function fakeChain(accountInfo: unknown) {
  const calls: any[] = [];
  const builder = (name: string) => (...args: any[]) => {
    calls.push({ name, args });
    return { accounts: () => ({ signers: () => ({ rpc: async () => `sig_${name}` }) }) };
  };
  return {
    chain: {
      programId: new PublicKey('5Y8xeLpLx2BWHHAZkYMfFQjsRPF2H7sUwmrVP9zjc7az'),
      usdcMint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
      connection: { getAccountInfo: async () => accountInfo },
      program: {
        methods: {
          registerMerchant: builder('registerMerchant'),
          setMerchantActive: builder('setMerchantActive'),
          setMerchantPayout: builder('setMerchantPayout'),
        },
      },
    } as any,
    calls,
  };
}
const merchant = { id: '00112233-4455-6677-8899-aabbccddeeff', payoutAddress: Keypair.generate().publicKey.toBase58() };

describe('RegistrarService', () => {
  it('registers when the on-chain merchant PDA does not exist, passing the 16-byte merchant_id + payout', async () => {
    const { chain, calls } = fakeChain(null);
    const sig = await new RegistrarService(chain, Keypair.generate()).ensureRegisteredActive(merchant as any);
    expect(sig).toBe('sig_registerMerchant');
    expect(calls.map((c) => c.name)).toEqual(['registerMerchant']);
    const [merchantId, payout] = calls[0].args;
    expect(merchantId).toEqual(merchantIdFromUuid(merchant.id));
    expect(merchantId).toHaveLength(16);
    expect(payout).toBeInstanceOf(PublicKey);
  });
  it('reactivates when the on-chain merchant PDA already exists', async () => {
    const { chain, calls } = fakeChain({ data: Buffer.alloc(1) });
    const sig = await new RegistrarService(chain, Keypair.generate()).ensureRegisteredActive(merchant as any);
    expect(sig).toBe('sig_setMerchantActive');
    expect(calls[0].name).toBe('setMerchantActive');
    expect(calls[0].args[0]).toBe(true);
  });
  it('deactivate calls set_merchant_active(false)', async () => {
    const { chain, calls } = fakeChain({ data: Buffer.alloc(1) });
    const sig = await new RegistrarService(chain, Keypair.generate()).deactivate(merchant as any);
    expect(sig).toBe('sig_setMerchantActive');
    expect(calls[0].args[0]).toBe(false);
  });
  it('setPayout calls set_merchant_payout(newPayout)', async () => {
    const { chain, calls } = fakeChain({ data: Buffer.alloc(1) });
    const sig = await new RegistrarService(chain, Keypair.generate()).setPayout(merchant as any);
    expect(sig).toBe('sig_setMerchantPayout');
    expect(calls[0].name).toBe('setMerchantPayout');
    expect(calls[0].args[0]).toBeInstanceOf(PublicKey);
  });
});
