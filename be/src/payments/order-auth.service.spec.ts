import { OrderAuthService } from './order-auth.service';
import { ApiKeyService } from '../merchant/api-key.service';

describe('OrderAuthService', () => {
  const apiKeys = new ApiKeyService();
  function make(secret: string, merchantId = 'm1') {
    const cipher = { open: jest.fn().mockResolvedValue(Buffer.from(secret, 'utf8')), seal: jest.fn() };
    const prisma = { merchantApiKey: { findUnique: jest.fn().mockResolvedValue({
      apiKey: 'navy_pk_x', merchantId, status: 'active', secretEnc: 'enc', dataKeyWrapped: 'w',
    }) } } as any;
    return new OrderAuthService(prisma, apiKeys as any, cipher as any);
  }
  it('authenticates a request with a valid HMAC and returns the merchant id', async () => {
    const secret = 'navy_sk_' + '0'.repeat(64);
    const body = JSON.stringify({ amount: 100 });
    const sig = apiKeys.sign(secret, body);
    expect(await make(secret).verify('navy_pk_x', body, sig)).toEqual({ merchantId: 'm1' });
  });
  it('rejects a bad signature', async () => {
    await expect(make('navy_sk_' + '0'.repeat(64)).verify('navy_pk_x', '{}', 'deadbeef')).rejects.toThrow();
  });
  it('rejects an unknown / revoked api key', async () => {
    const prisma = { merchantApiKey: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const svc = new OrderAuthService(prisma, apiKeys as any, { open: jest.fn(), seal: jest.fn() } as any);
    await expect(svc.verify('navy_pk_missing', '{}', 'x')).rejects.toThrow();
  });
});
