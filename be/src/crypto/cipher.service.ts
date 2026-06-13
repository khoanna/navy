import { Injectable } from '@nestjs/common';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { Cipher, SealedSecret } from './cipher.interface';

// Format per blob: base64( iv(12) || tag(16) || ciphertext )
function enc(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function dec(key: Buffer, blob: string): Buffer {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

@Injectable()
export class EnvelopeCipherService implements Cipher {
  constructor(private readonly masterKey: Buffer) {}

  async seal(plaintext: Buffer): Promise<SealedSecret> {
    const dataKey = randomBytes(32);
    const encryptedPrivkey = enc(dataKey, plaintext);
    const dataKeyWrapped = enc(this.masterKey, dataKey);
    return { encryptedPrivkey, dataKeyWrapped };
  }

  async open(sealed: SealedSecret): Promise<Buffer> {
    const dataKey = dec(this.masterKey, sealed.dataKeyWrapped);
    return dec(dataKey, sealed.encryptedPrivkey);
  }
}
