import { EnvelopeCipherService } from '../../../src/crypto/cipher.service';

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

  it('rejects a 32-byte != master key', () => {
    expect(() => new EnvelopeCipherService(Buffer.alloc(16, 1))).toThrow(/32 bytes/);
  });

  it('fails to open if the wrapped data key is tampered (wrap-layer auth)', async () => {
    const sealed = await cipher.seal(Buffer.from('secret'));
    const bad = { ...sealed, dataKeyWrapped: Buffer.from('00'.repeat(40), 'hex').toString('base64') };
    await expect(cipher.open(bad)).rejects.toThrow();
  });

  it('fails to open under a different master key', async () => {
    const sealed = await cipher.seal(Buffer.from('secret'));
    const other = new EnvelopeCipherService(Buffer.alloc(32, 99));
    await expect(other.open(sealed)).rejects.toThrow();
  });

  it('rejects a malformed (too short) blob', async () => {
    const bad = { encryptedPrivkey: Buffer.from('00', 'hex').toString('base64'),
                  dataKeyWrapped: (await cipher.seal(Buffer.from('x'))).dataKeyWrapped };
    await expect(cipher.open(bad)).rejects.toThrow();
  });
});
