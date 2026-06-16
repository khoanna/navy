import { Keypair } from '@solana/web3.js';
import { EnvelopeCipherService } from '../crypto/cipher.service';
import { SubwalletService } from './subwallet.service';

const cipher = new EnvelopeCipherService(Buffer.alloc(32, 9));

describe('SubwalletService', () => {
  it('generates a keypair, seals the secret, stores ciphertext (never plaintext)', async () => {
    const created: any = {};
    const prisma = { farmingSubwallet: { create: jest.fn().mockImplementation(({ data }) => {
      Object.assign(created, data); return Promise.resolve({ id: 's1', ...data });
    }) } } as any;
    const audit = { record: jest.fn() } as any;
    const svc = new SubwalletService(prisma, cipher, audit);

    const policy = { allowedProgramIds: ['P'], allowedDestinations: ['OWNER'] };
    const result = await svc.provision('u1', policy);

    expect(result.pubkey).toEqual(expect.any(String));
    expect(created.encryptedPrivkey).toEqual(expect.any(String));
    expect(created.dataKeyWrapped).toEqual(expect.any(String));
    expect(created).not.toHaveProperty('privkey');
    const opened = await cipher.open({ encryptedPrivkey: created.encryptedPrivkey, dataKeyWrapped: created.dataKeyWrapped });
    expect(opened.length).toBe(64);
    expect(Keypair.fromSecretKey(opened).publicKey.toBase58()).toBe(result.pubkey);
  });
});
