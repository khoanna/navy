import { EnvelopeCipherService } from './cipher.service';

const masterKey = Buffer.alloc(32, 7);

describe('EnvelopeCipherService', () => {
  const cipher = new EnvelopeCipherService(masterKey);

  it('round-trips plaintext through seal/open', async () => {
    const secret = Buffer.from('a-solana-secret-key-bytes');
    const sealed = await cipher.seal(secret);
    expect(sealed.encryptedPrivkey).toEqual(expect.any(String));
    expect(sealed.dataKeyWrapped).toEqual(expect.any(String));
    const opened = await cipher.open(sealed);
    expect(opened.equals(secret)).toBe(true);
  });

  it('produces a different data key per seal (envelope)', async () => {
    const a = await cipher.seal(Buffer.from('x'));
    const b = await cipher.seal(Buffer.from('x'));
    expect(a.dataKeyWrapped).not.toEqual(b.dataKeyWrapped);
    expect(a.encryptedPrivkey).not.toEqual(b.encryptedPrivkey);
  });

  it('fails to open if the ciphertext is tampered (GCM auth)', async () => {
    const sealed = await cipher.seal(Buffer.from('secret'));
    const bad = { ...sealed, encryptedPrivkey: Buffer.from('00'.repeat(40), 'hex').toString('base64') };
    await expect(cipher.open(bad)).rejects.toThrow();
  });
});
