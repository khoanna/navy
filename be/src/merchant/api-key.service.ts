import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export interface IssuedApiKey { apiKey: string; apiSecret: string; secretHash: string; }

@Injectable()
export class ApiKeyService {
  generate(): IssuedApiKey {
    const apiKey = 'navy_pk_' + randomBytes(16).toString('hex');
    const apiSecret = 'navy_sk_' + randomBytes(32).toString('hex');
    return { apiKey, apiSecret, secretHash: this.hash(apiSecret) };
  }
  sign(secret: string, body: string): string {
    return createHmac('sha256', secret).update(body).digest('hex');
  }
  verify(secret: string, body: string, signature: string): boolean {
    const expected = this.sign(secret, body);
    return this.safeEq(expected, signature);
  }
  matchesHash(secret: string, secretHash: string): boolean {
    return this.safeEq(this.hash(secret), secretHash);
  }
  private hash(s: string): string { return createHash('sha256').update(s).digest('hex'); }
  private safeEq(a: string, b: string): boolean {
    const ba = Buffer.from(a), bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
