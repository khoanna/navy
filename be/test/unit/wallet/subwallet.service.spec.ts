import { ethers } from 'ethers';
import { EnvelopeCipherService } from '../../../src/crypto/cipher.service';
import { SubwalletService } from '../../../src/wallet/subwallet.service';

const cipher = new EnvelopeCipherService(Buffer.alloc(32, 9));

describe('SubwalletService', () => {
  it('generates an EVM keypair, seals the secret, stores ciphertext (never plaintext)', async () => {
    const created: any = {};
    const prisma = { farmingSubwallet: { create: jest.fn().mockImplementation(({ data }) => {
      Object.assign(created, data); return Promise.resolve({ id: 's1', ...data });
    }) } } as any;
    const audit = { record: jest.fn() } as any;
    const svc = new SubwalletService(prisma, cipher, audit);

    const policy = { allowedProgramIds: ['P'], allowedDestinations: ['OWNER'] };
    const result = await svc.provision('u1', policy);

    // pubkey is a checksummed EVM address.
    expect(ethers.isAddress(result.pubkey)).toBe(true);
    expect(created.encryptedPrivkey).toEqual(expect.any(String));
    expect(created.dataKeyWrapped).toEqual(expect.any(String));
    expect(created).not.toHaveProperty('privkey');
    // The sealed key round-trips to a 32-byte secp256k1 private key that derives the address.
    const opened = await cipher.open({ encryptedPrivkey: created.encryptedPrivkey, dataKeyWrapped: created.dataKeyWrapped });
    expect(opened.length).toBe(32);
    const wallet = new ethers.Wallet('0x' + Buffer.from(opened).toString('hex'));
    expect(wallet.address).toBe(result.pubkey);
  });
});
