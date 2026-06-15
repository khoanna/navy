import { ChainWatcherService } from './chain-watcher.service';

describe('ChainWatcherService', () => {
  it('marks a confirming order paid and fires the webhook', async () => {
    const order = { id: 'o1', merchantId: 'm1', status: 'confirming', txSignature: 'sig', callbackUrl: 'https://cb', amount: 1000000n, feeBps: 100, reference: 'R1' };
    const update = jest.fn().mockResolvedValue({ ...order, status: 'paid', amount: 1000000n, feeBps: 100, reference: 'R1', paidAt: new Date() });
    const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order), update } } as any;
    const webhooks = { deliver: jest.fn().mockResolvedValue(true) } as any;
    const secrets = { secretForMerchant: jest.fn().mockResolvedValue('sk') } as any;
    const svc = new ChainWatcherService(prisma, webhooks, secrets);

    await svc.markPaid('o1', { payer: 'PK', signature: 'sig' });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o1' }, data: expect.objectContaining({ status: 'paid', payer: 'PK' }) }));
    expect(webhooks.deliver).toHaveBeenCalledWith('o1', 'https://cb', 'sk', expect.objectContaining({ status: 'paid', orderId: 'o1' }));
  });

  it('is idempotent: a paid order is not re-processed', async () => {
    const prisma = { order: { findUnique: jest.fn().mockResolvedValue({ id: 'o1', status: 'paid' }), update: jest.fn() } } as any;
    const webhooks = { deliver: jest.fn() } as any;
    const svc = new ChainWatcherService(prisma, webhooks, { secretForMerchant: jest.fn() } as any);
    await svc.markPaid('o1', { payer: 'PK', signature: 'sig' });
    expect(webhooks.deliver).not.toHaveBeenCalled();
  });

  it('expires an awaiting order past its deadline', async () => {
    const past = new Date(Date.now() - 1000);
    const update = jest.fn();
    const prisma = { order: { findMany: jest.fn().mockResolvedValue([{ id: 'o2', status: 'awaiting_payment', expiresAt: past }]), update } } as any;
    const svc = new ChainWatcherService(prisma, { deliver: jest.fn() } as any, { secretForMerchant: jest.fn() } as any);
    await svc.expireStale();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o2' }, data: { status: 'expired' } }));
  });
});
