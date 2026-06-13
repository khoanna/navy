import * as argon2 from 'argon2';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { MerchantService } from './merchant.service';
import { ApiKeyService } from './api-key.service';

function prismaMock(merchant: any) {
  return {
    merchant: {
      findUnique: jest.fn().mockResolvedValue(merchant),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...merchant, ...data })),
    },
    merchantApiKey: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'k1', ...data })) },
  } as any;
}

describe('MerchantService', () => {
  it('logs in with a valid email + password', async () => {
    const merchant = { id: 'm1', email: 'm@x.com', passwordHash: await argon2.hash('pw'), approvalStatus: 'approved' };
    const svc = new MerchantService(prismaMock(merchant), new ApiKeyService());
    const result = await svc.login('m@x.com', 'pw');
    expect(result.id).toBe('m1');
  });

  it('registers a payout address only with a valid wallet signature', async () => {
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const message = 'Navy payout binding for m1';
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    const prisma = prismaMock({ id: 'm1' });
    const svc = new MerchantService(prisma, new ApiKeyService());
    const out = await svc.setPayoutAddress('m1', address, message, signature);
    expect(out.payoutAddress).toBe(address);
  });

  it('rejects a payout address with a bad signature', async () => {
    const kp = Keypair.generate();
    const svc = new MerchantService(prismaMock({ id: 'm1' }), new ApiKeyService());
    await expect(
      svc.setPayoutAddress('m1', kp.publicKey.toBase58(), 'msg', bs58.encode(Buffer.alloc(64))),
    ).rejects.toThrow(/signature/);
  });
});
