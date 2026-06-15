import { WebhookService } from './webhook.service';
import { ApiKeyService } from '../merchant/api-key.service';

describe('WebhookService', () => {
  const apiKeys = new ApiKeyService();
  it('signs the body with the merchant secret and posts it', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const prisma = { webhookDelivery: { create: jest.fn().mockResolvedValue({ id: 'w1' }), update: jest.fn() } } as any;
    const svc = new WebhookService(prisma, apiKeys as any, fetchImpl as any);
    await svc.deliver('o1', 'https://merchant/cb', 'navy_sk_secret', { orderId: 'o1', status: 'paid' });
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://merchant/cb');
    expect(apiKeys.verify('navy_sk_secret', opts.body, opts.headers['X-Navy-Signature'])).toBe(true);
  });
  it('marks delivery failed after the final attempt', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const update = jest.fn();
    const prisma = { webhookDelivery: { create: jest.fn().mockResolvedValue({ id: 'w1' }), update } } as any;
    const svc = new WebhookService(prisma, apiKeys as any, fetchImpl as any);
    await svc.deliver('o1', 'https://merchant/cb', 'sk', { status: 'paid' }, { attempts: 2, backoffMs: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
  });
});
