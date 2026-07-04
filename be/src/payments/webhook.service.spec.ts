import { WebhookService } from './webhook.service';
import { ApiKeyService } from '../merchant/api-key.service';

describe('WebhookService', () => {
  const apiKeys = new ApiKeyService();

  it('signs timestamp+body, sets idempotency/timestamp headers, and marks delivered on 200', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const update = jest.fn();
    const prisma = { webhookDelivery: { create: jest.fn().mockResolvedValue({ id: 'w1' }), update } } as any;
    const svc = new WebhookService(prisma, apiKeys as any, fetchImpl as any);

    await svc.deliver('o1', 'https://merchant/cb', 'navy_sk_secret', { orderId: 'o1', status: 'paid' });

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://merchant/cb');

    // Timestamp header present and matches an idempotency built from orderId + row id.
    const ts = opts.headers['X-Navy-Timestamp'];
    expect(ts).toMatch(/^\d+$/);
    expect(opts.headers['X-Navy-Idempotency']).toBe('o1.w1');

    // Signature is over `${timestamp}.${body}` (replay-resistant), not the bare body.
    const signed = `${ts}.${opts.body}`;
    expect(apiKeys.verify('navy_sk_secret', signed, opts.headers['X-Navy-Signature'])).toBe(true);
    expect(apiKeys.verify('navy_sk_secret', opts.body, opts.headers['X-Navy-Signature'])).toBe(false);

    // Ledger: created pending, then marked delivered.
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({ data: { orderId: 'o1', url: 'https://merchant/cb', status: 'pending' } });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: expect.objectContaining({ status: 'delivered', deliveredAt: expect.any(Date) }),
    });
  });

  it('retries and marks delivery failed after the final attempt', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const update = jest.fn();
    const prisma = { webhookDelivery: { create: jest.fn().mockResolvedValue({ id: 'w1' }), update } } as any;
    const svc = new WebhookService(prisma, apiKeys as any, fetchImpl as any);

    const ok = await svc.deliver('o1', 'https://merchant/cb', 'sk', { status: 'paid' }, { attempts: 3, backoffs: [0, 0] });

    expect(ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed', attempts: 3, lastError: 'HTTP 500' }) }),
    );
  });
});
