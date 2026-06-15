import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  function make() {
    const order = {
      id: '00112233-4455-6677-8899-aabbccddeeff', merchantId: 'm1', reference: 'INV-1',
      amount: 1_000_000n, feeBps: 100, status: 'awaiting_payment',
      onchainInvoiceId: '00112233445566778899aabbccddeeff', expiresAt: new Date(Date.now() + 600000),
    };
    const prisma = { order: { create: jest.fn().mockResolvedValue(order), findUnique: jest.fn().mockResolvedValue(order) } } as any;
    const audit = { record: jest.fn() } as any;
    return { svc: new OrdersService(prisma, audit, 'navy://pay', 100), prisma, order };
  }
  it('creates an order: snapshots fee, derives invoice_id, sets pay url + QR', async () => {
    const { svc, prisma } = make();
    const res = await svc.create('m1', { amount: 1_000_000n, reference: 'INV-1', expiresInSec: 600 });
    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.merchantId).toBe('m1');
    expect(data.feeBps).toBe(100);
    expect(data.onchainInvoiceId).toMatch(/^[0-9a-f]{32}$/);
    expect(data.status).toBe('awaiting_payment');
    expect(res.payUrl).toMatch(/^navy:\/\/pay\//);
    expect(res.qr).toMatch(/^data:image\/png;base64,/);
  });
  it('rejects a zero amount', async () => {
    const { svc } = make();
    await expect(svc.create('m1', { amount: 0n, reference: 'x' })).rejects.toThrow(/amount/i);
  });
});
