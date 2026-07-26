import { ApiKeyService } from '../../../src/merchant/api-key.service';

describe('ApiKeyService', () => {
  const svc = new ApiKeyService();

  it('issues an api_key and a secret, storing only the secret hash', () => {
    const issued = svc.generate();
    expect(issued.apiKey).toMatch(/^navy_pk_[a-f0-9]{32}$/);
    expect(issued.apiSecret).toMatch(/^navy_sk_[a-f0-9]{64}$/);
    expect(issued.secretHash).not.toContain(issued.apiSecret);
    expect(issued.secretHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifies an HMAC signature over a request body', () => {
    const issued = svc.generate();
    const body = JSON.stringify({ amount: 100, invoice: 'INV-1' });
    const sig = svc.sign(issued.apiSecret, body);
    expect(svc.verify(issued.apiSecret, body, sig)).toBe(true);
    expect(svc.verify(issued.apiSecret, body, 'deadbeef')).toBe(false);
  });

  it('matches a stored secretHash to the issued secret', () => {
    const issued = svc.generate();
    expect(svc.matchesHash(issued.apiSecret, issued.secretHash)).toBe(true);
    expect(svc.matchesHash('navy_sk_' + '0'.repeat(64), issued.secretHash)).toBe(false);
  });
});
