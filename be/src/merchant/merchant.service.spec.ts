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

const cipherStub = () => ({ seal: jest.fn().mockResolvedValue({ encryptedPrivkey: 'e', dataKeyWrapped: 'w' }), open: jest.fn() } as any);

describe('MerchantService', () => {
  it('logs in with a valid email + password', async () => {
    const merchant = { id: 'm1', email: 'm@x.com', passwordHash: await argon2.hash('pw'), approvalStatus: 'approved' };
    const svc = new MerchantService(prismaMock(merchant), new ApiKeyService(), cipherStub());
    const result = await svc.login('m@x.com', 'pw');
    expect(result.id).toBe('m1');
  });

  it('registers a payout address only with a valid wallet signature', async () => {
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const message = 'Navy payout binding for m1';
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'approved' });
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub());
    const out = await svc.setPayoutAddress('m1', address, message, signature);
    expect(out.payoutAddress).toBe(address);
  });

  it('rejects a payout address with a bad signature', async () => {
    const kp = Keypair.generate();
    const svc = new MerchantService(prismaMock({ id: 'm1', approvalStatus: 'approved' }), new ApiKeyService(), cipherStub());
    await expect(
      svc.setPayoutAddress('m1', kp.publicKey.toBase58(), 'msg', bs58.encode(Buffer.alloc(64))),
    ).rejects.toThrow(/signature/);
  });

  it('denies API key issuance for an unapproved (pending) merchant', async () => {
    const prisma = {
      merchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', approvalStatus: 'pending' }) },
      merchantApiKey: { create: jest.fn() },
    } as any;
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub());
    await expect(svc.issueApiKey('m1')).rejects.toThrow(/not approved/i);
    expect(prisma.merchantApiKey.create).not.toHaveBeenCalled();
  });

  it('sets the payout address for a pending merchant (payout must precede approval)', async () => {
    // Onboarding order is signup -> set payout -> admin approve. approve() registers the
    // merchant on-chain using the payout ATA, so payout MUST be settable while still pending;
    // requiring approval here would deadlock onboarding.
    const { Keypair } = require('@solana/web3.js');
    const nacl = require('tweetnacl');
    const bs58mod = require('bs58');
    const bs58enc = bs58mod.default ?? bs58mod;
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const message = 'Navy payout binding for m1';
    const signature = bs58enc.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    const prisma = {
      merchant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'm1', approvalStatus: 'pending' }),
        update: jest.fn().mockResolvedValue({ id: 'm1', payoutAddress: address }),
      },
    } as any;
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub());
    await svc.setPayoutAddress('m1', address, message, signature);
    expect(prisma.merchant.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { payoutAddress: address } });
  });

  it('stores the api secret encrypted (envelope) for later HMAC verification', async () => {
    const sealed = { encryptedPrivkey: 'enc', dataKeyWrapped: 'wrap' };
    const cipher = { seal: jest.fn().mockResolvedValue(sealed), open: jest.fn() };
    const create = jest.fn().mockResolvedValue({ id: 'k1' });
    const prisma = { merchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', approvalStatus: 'approved' }) },
                     merchantApiKey: { create } } as any;
    const { ApiKeyService } = require('./api-key.service');
    const svc = new MerchantService(prisma, new ApiKeyService(), cipher as any);
    await svc.issueApiKey('m1');
    expect(cipher.seal).toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(data.secretEnc).toBe('enc');
    expect(data.dataKeyWrapped).toBe('wrap');
  });
});
