import { Keypair, PublicKey } from '@solana/web3.js';
import { RegistrarService } from './registrar.service';

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
      program: { methods: { registerMerchant: builder('registerMerchant'), setMerchantActive: builder('setMerchantActive') } },
    } as any,
    calls,
  };
}
const merchant = { id: 'm1', payoutAddress: Keypair.generate().publicKey.toBase58() };

describe('RegistrarService', () => {
  it('registers when the on-chain merchant PDA does not exist', async () => {
    const { chain, calls } = fakeChain(null);
    const sig = await new RegistrarService(chain, Keypair.generate()).ensureRegisteredActive(merchant as any);
    expect(sig).toBe('sig_registerMerchant');
    expect(calls.map((c) => c.name)).toEqual(['registerMerchant']);
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
});
