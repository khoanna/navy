import * as argon2 from 'argon2';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { MerchantService } from './merchant.service';
import { ApiKeyService } from './api-key.service';

function prismaMock(merchant: any, opts: { challenge?: any } = {}) {
  return {
    merchant: {
      findUnique: jest.fn().mockResolvedValue(merchant),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...merchant, ...data })),
    },
    merchantApiKey: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'k1', ...data })) },
    payoutChallenge: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'ch1', ...data })),
      findFirst: jest.fn().mockResolvedValue(opts.challenge ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: opts.challenge ? 1 : 0 }),
    },
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

  it('issues a single-use payout challenge bound to the merchant', async () => {
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'pending' });
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub());
    const out = await svc.issuePayoutChallenge('m1');
    expect(prisma.payoutChallenge.create).toHaveBeenCalled();
    const data = prisma.payoutChallenge.create.mock.calls[0][0].data;
    expect(data.merchantId).toBe('m1');
    expect(data.challenge).toContain('m1');
    expect(data.challenge).toContain(data.nonce);
    expect(out.challenge).toBe(data.challenge);
    expect(out.nonce).toBe(data.nonce);
    expect(out.expiresAt).toBeInstanceOf(Date);
  });

  it('registers a payout address only with a valid wallet signature against a live challenge', async () => {
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const message = 'Navy payout authorization\nmerchant: m1\nnonce: abc\nexpires: 2099-01-01T00:00:00.000Z';
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    const challenge = { id: 'ch1', merchantId: 'm1', challenge: message, consumedAt: null, expiresAt: new Date(Date.now() + 60000) };
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'approved' }, { challenge });
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub());
    const out = await svc.setPayoutAddress('m1', address, message, signature);
    expect(prisma.payoutChallenge.updateMany).toHaveBeenCalledWith({
      where: { id: 'ch1', consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
    expect(out.payoutAddress).toBe(address);
  });

  it('rejects a payout when no live challenge matches the signed message', async () => {
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const message = 'Navy payout authorization\nmerchant: m1\nnonce: abc\nexpires: 2099-01-01T00:00:00.000Z';
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'approved' });
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub());
    await expect(svc.setPayoutAddress('m1', address, message, signature)).rejects.toThrow(/No valid payout challenge/);
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('rejects a payout when the challenge was already consumed (replay)', async () => {
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const message = 'Navy payout authorization\nmerchant: m1\nnonce: abc\nexpires: 2099-01-01T00:00:00.000Z';
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    const challenge = { id: 'ch1', merchantId: 'm1', challenge: message, consumedAt: null, expiresAt: new Date(Date.now() + 60000) };
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'approved' }, { challenge });
    // Simulate the atomic consume losing the race: updateMany affects 0 rows.
    prisma.payoutChallenge.updateMany.mockResolvedValue({ count: 0 });
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub());
    await expect(svc.setPayoutAddress('m1', address, message, signature)).rejects.toThrow(/already used/);
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('rejects a payout address with a bad signature', async () => {
    const kp = Keypair.generate();
    const message = 'msg';
    const challenge = { id: 'ch1', merchantId: 'm1', challenge: message, consumedAt: null, expiresAt: new Date(Date.now() + 60000) };
    const svc = new MerchantService(prismaMock({ id: 'm1', approvalStatus: 'approved' }, { challenge }), new ApiKeyService(), cipherStub());
    await expect(
      svc.setPayoutAddress('m1', kp.publicKey.toBase58(), message, bs58.encode(Buffer.alloc(64))),
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
    const message = 'Navy payout authorization\nmerchant: m1\nnonce: xyz\nexpires: 2099-01-01T00:00:00.000Z';
    const signature = bs58enc.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    const challenge = { id: 'ch1', merchantId: 'm1', challenge: message, consumedAt: null, expiresAt: new Date(Date.now() + 60000) };
    const prisma = {
      merchant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'm1', approvalStatus: 'pending' }),
        update: jest.fn().mockResolvedValue({ id: 'm1', payoutAddress: address }),
      },
      payoutChallenge: {
        findFirst: jest.fn().mockResolvedValue(challenge),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
