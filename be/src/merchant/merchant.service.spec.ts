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
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'approved' });
    const svc = new MerchantService(prisma, new ApiKeyService());
    const out = await svc.setPayoutAddress('m1', address, message, signature);
    expect(out.payoutAddress).toBe(address);
  });

  it('rejects a payout address with a bad signature', async () => {
    const kp = Keypair.generate();
    const svc = new MerchantService(prismaMock({ id: 'm1', approvalStatus: 'approved' }), new ApiKeyService());
    await expect(
      svc.setPayoutAddress('m1', kp.publicKey.toBase58(), 'msg', bs58.encode(Buffer.alloc(64))),
    ).rejects.toThrow(/signature/);
  });

  it('denies API key issuance for an unapproved (pending) merchant', async () => {
    const prisma = {
      merchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', approvalStatus: 'pending' }) },
      merchantApiKey: { create: jest.fn() },
    } as any;
    const svc = new MerchantService(prisma, new ApiKeyService());
    await expect(svc.issueApiKey('m1')).rejects.toThrow(/not approved/i);
    expect(prisma.merchantApiKey.create).not.toHaveBeenCalled();
  });

  it('denies payout address registration for an unapproved merchant (even with a valid signature)', async () => {
    const { Keypair } = require('@solana/web3.js');
    const nacl = require('tweetnacl');
    const bs58mod = require('bs58');
    const bs58enc = bs58mod.default ?? bs58mod;
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const message = 'Navy payout binding for m1';
    const signature = bs58enc.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    const prisma = {
      merchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', approvalStatus: 'pending' }), update: jest.fn() },
    } as any;
    const svc = new MerchantService(prisma, new ApiKeyService());
    await expect(svc.setPayoutAddress('m1', address, message, signature)).rejects.toThrow(/not approved/i);
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });
});
