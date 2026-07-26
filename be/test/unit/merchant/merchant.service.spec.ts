import * as argon2 from 'argon2';
import { Wallet } from 'ethers';
import { MerchantService } from '../../../src/merchant/merchant.service';
import { ApiKeyService } from '../../../src/merchant/api-key.service';

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
const registrarStub = () => ({ setPayout: jest.fn().mockResolvedValue('0xtx'), ensureRegisteredActive: jest.fn(), deactivate: jest.fn() } as any);

describe('MerchantService', () => {
  it('logs in with a valid email + password', async () => {
    const merchant = { id: 'm1', email: 'm@x.com', passwordHash: await argon2.hash('pw'), approvalStatus: 'approved' };
    const svc = new MerchantService(prismaMock(merchant), new ApiKeyService(), cipherStub(), registrarStub());
    const result = await svc.login('m@x.com', 'pw');
    expect(result.id).toBe('m1');
  });

  it('issues a single-use payout challenge bound to the merchant', async () => {
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'pending' });
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub(), registrarStub());
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
    const wallet = Wallet.createRandom();
    const address = wallet.address;
    const message = 'Navy payout authorization\nmerchant: m1\nnonce: abc\nexpires: 2099-01-01T00:00:00.000Z';
    const signature = await wallet.signMessage(message);
    const challenge = { id: 'ch1', merchantId: 'm1', challenge: message, consumedAt: null, expiresAt: new Date(Date.now() + 60000) };
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'approved' }, { challenge });
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub(), registrarStub());
    const out = await svc.setPayoutAddress('m1', address, message, signature);
    expect(prisma.payoutChallenge.updateMany).toHaveBeenCalledWith({
      where: { id: 'ch1', consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
    expect(out.payoutAddress).toBe(address);
  });

  it('rejects a payout when no live challenge matches the signed message', async () => {
    const wallet = Wallet.createRandom();
    const address = wallet.address;
    const message = 'Navy payout authorization\nmerchant: m1\nnonce: abc\nexpires: 2099-01-01T00:00:00.000Z';
    const signature = await wallet.signMessage(message);
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'approved' });
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub(), registrarStub());
    await expect(svc.setPayoutAddress('m1', address, message, signature)).rejects.toThrow(/No valid payout challenge/);
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('rejects a payout when the challenge was already consumed (replay)', async () => {
    const wallet = Wallet.createRandom();
    const address = wallet.address;
    const message = 'Navy payout authorization\nmerchant: m1\nnonce: abc\nexpires: 2099-01-01T00:00:00.000Z';
    const signature = await wallet.signMessage(message);
    const challenge = { id: 'ch1', merchantId: 'm1', challenge: message, consumedAt: null, expiresAt: new Date(Date.now() + 60000) };
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'approved' }, { challenge });
    // Simulate the atomic consume losing the race: updateMany affects 0 rows.
    prisma.payoutChallenge.updateMany.mockResolvedValue({ count: 0 });
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub(), registrarStub());
    await expect(svc.setPayoutAddress('m1', address, message, signature)).rejects.toThrow(/already used/);
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('rejects a payout address with a bad signature', async () => {
    const wallet = Wallet.createRandom();
    const message = 'msg';
    const challenge = { id: 'ch1', merchantId: 'm1', challenge: message, consumedAt: null, expiresAt: new Date(Date.now() + 60000) };
    const svc = new MerchantService(prismaMock({ id: 'm1', approvalStatus: 'approved' }, { challenge }), new ApiKeyService(), cipherStub(), registrarStub());
    await expect(
      svc.setPayoutAddress('m1', wallet.address, message, '0x' + '00'.repeat(65)),
    ).rejects.toThrow(/signature/);
  });

  it('rejects a non-EVM payout address before consuming a challenge', async () => {
    const message = 'Navy payout authorization\nmerchant: m1\nnonce: abc\nexpires: 2099-01-01T00:00:00.000Z';
    const challenge = { id: 'ch1', merchantId: 'm1', challenge: message, consumedAt: null, expiresAt: new Date(Date.now() + 60000) };
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'approved' }, { challenge });
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub(), registrarStub());
    await expect(
      svc.setPayoutAddress('m1', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', message, '0x00'),
    ).rejects.toThrow(/EVM address/);
    expect(prisma.payoutChallenge.updateMany).not.toHaveBeenCalled();
  });

  it('denies API key issuance for an unapproved (pending) merchant', async () => {
    const prisma = {
      merchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', approvalStatus: 'pending' }) },
      merchantApiKey: { create: jest.fn() },
    } as any;
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub(), registrarStub());
    await expect(svc.issueApiKey('m1')).rejects.toThrow(/not approved/i);
    expect(prisma.merchantApiKey.create).not.toHaveBeenCalled();
  });

  it('sets the payout address for a pending merchant (payout must precede approval)', async () => {
    // Onboarding order is signup -> set payout -> admin approve. approve() registers the
    // merchant on-chain using the payout ATA, so payout MUST be settable while still pending;
    // requiring approval here would deadlock onboarding.
    const wallet = Wallet.createRandom();
    const address = wallet.address;
    const message = 'Navy payout authorization\nmerchant: m1\nnonce: xyz\nexpires: 2099-01-01T00:00:00.000Z';
    const signature = await wallet.signMessage(message);
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
    const registrar = registrarStub();
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub(), registrar);
    await svc.setPayoutAddress('m1', address, message, signature);
    expect(prisma.merchant.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { payoutAddress: address } });
    // Pending merchant is not yet on-chain, so no sync call.
    expect(registrar.setPayout).not.toHaveBeenCalled();
  });

  it('syncs the on-chain payout when the merchant is already approved', async () => {
    const wallet = Wallet.createRandom();
    const address = wallet.address;
    const message = 'Navy payout authorization\nmerchant: m1\nnonce: sync\nexpires: 2099-01-01T00:00:00.000Z';
    const signature = await wallet.signMessage(message);
    const challenge = { id: 'ch1', merchantId: 'm1', challenge: message, consumedAt: null, expiresAt: new Date(Date.now() + 60000) };
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'approved' }, { challenge });
    const registrar = registrarStub();
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub(), registrar);
    await svc.setPayoutAddress('m1', address, message, signature);
    expect(registrar.setPayout).toHaveBeenCalledWith({ id: 'm1', payoutAddress: address });
  });

  it('still updates the DB when the on-chain payout sync throws (best-effort)', async () => {
    const wallet = Wallet.createRandom();
    const address = wallet.address;
    const message = 'Navy payout authorization\nmerchant: m1\nnonce: fail\nexpires: 2099-01-01T00:00:00.000Z';
    const signature = await wallet.signMessage(message);
    const challenge = { id: 'ch1', merchantId: 'm1', challenge: message, consumedAt: null, expiresAt: new Date(Date.now() + 60000) };
    const prisma = prismaMock({ id: 'm1', approvalStatus: 'approved' }, { challenge });
    const registrar = registrarStub();
    registrar.setPayout.mockRejectedValue(new Error('rpc down'));
    const svc = new MerchantService(prisma, new ApiKeyService(), cipherStub(), registrar);
    const out = await svc.setPayoutAddress('m1', address, message, signature);
    expect(out.payoutAddress).toBe(address);
    expect(prisma.merchant.update).toHaveBeenCalled();
  });

  it('stores the api secret encrypted (envelope) for later HMAC verification', async () => {
    const sealed = { encryptedPrivkey: 'enc', dataKeyWrapped: 'wrap' };
    const cipher = { seal: jest.fn().mockResolvedValue(sealed), open: jest.fn() };
    const create = jest.fn().mockResolvedValue({ id: 'k1' });
    const prisma = { merchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', approvalStatus: 'approved' }) },
                     merchantApiKey: { create } } as any;
    const { ApiKeyService } = require('../../../src/merchant/api-key.service');
    const svc = new MerchantService(prisma, new ApiKeyService(), cipher as any, registrarStub());
    await svc.issueApiKey('m1');
    expect(cipher.seal).toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(data.secretEnc).toBe('enc');
    expect(data.dataKeyWrapped).toBe('wrap');
  });
});
