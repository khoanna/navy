import { ConflictException, NotFoundException } from '@nestjs/common';
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
    return { svc: new OrdersService(prisma, audit, 'https://pay.navy/pay', 100), prisma, order };
  }
  it('creates an order: snapshots fee, derives invoice_id, sets pay url + QR', async () => {
    const { svc, prisma } = make();
    const res = await svc.create('m1', { amount: 1_000_000n, reference: 'INV-1', expiresInSec: 600 });
    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.merchantId).toBe('m1');
    expect(data.feeBps).toBe(100);
    expect(data.onchainInvoiceId).toMatch(/^[0-9a-f]{32}$/);
    expect(data.status).toBe('awaiting_payment');
    expect(res.payUrl).toMatch(/^https:\/\/pay\.navy\/pay\//);
    expect(res.qr).toMatch(/^data:image\/png;base64,/);
  });
  it('rejects a zero amount', async () => {
    const { svc } = make();
    await expect(svc.create('m1', { amount: 0n, reference: 'x' })).rejects.toThrow(/amount/i);
  });
  it('rejects an amount below the on-chain minimum (10_000)', async () => {
    const { svc } = make();
    await expect(svc.create('m1', { amount: 9_999n, reference: 'x' })).rejects.toThrow(/at least 10000/i);
  });
});

describe('OrdersService merchant-scoped', () => {
  function make(merchant: any, orders: any[] = []) {
    const prisma = {
      merchant: { findUnique: jest.fn().mockResolvedValue(merchant) },
      order: {
        create: jest.fn().mockResolvedValue({ id: 'o1', amount: 1000000n, status: 'awaiting_payment', expiresAt: new Date() }),
        findMany: jest.fn().mockResolvedValue(orders),
        findFirst: jest.fn().mockResolvedValue(orders[0] ?? null),
      },
    } as any;
    const audit = { record: jest.fn() } as any;
    return { svc: new OrdersService(prisma, audit, 'https://pay.navy/pay', 100), prisma };
  }
  it('createForMerchant rejects an unapproved merchant with 409', async () => {
    const { svc } = make({ id: 'm1', approvalStatus: 'pending' });
    await expect(svc.createForMerchant('m1', { amount: 1000000n, reference: 'R' })).rejects.toBeInstanceOf(ConflictException);
  });
  it('createForMerchant creates when approved', async () => {
    const { svc, prisma } = make({ id: 'm1', approvalStatus: 'approved' });
    const res = await svc.createForMerchant('m1', { amount: 1000000n, reference: 'R' });
    expect(prisma.order.create).toHaveBeenCalled();
    expect(res.orderId).toBe('o1');
  });
  it('listForMerchant scopes by merchantId and serializes amount to string', async () => {
    const row = { id: 'o1', reference: 'R', amount: 1000000n, status: 'paid', createdAt: new Date(), paidAt: new Date() };
    const { svc, prisma } = make({ id: 'm1', approvalStatus: 'approved' }, [row]);
    const out = await svc.listForMerchant('m1', { take: 50, skip: 0 });
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { merchantId: 'm1' } }));
    expect(out[0].amount).toBe('1000000');
  });
  it('listForMerchant adds a status filter when provided', async () => {
    const { svc, prisma } = make({ id: 'm1', approvalStatus: 'approved' }, []);
    await svc.listForMerchant('m1', { status: 'paid', take: 50, skip: 0 });
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { merchantId: 'm1', status: 'paid' } }));
  });
  it('getForMerchant returns the order serialized when owned', async () => {
    const row = { id: 'o1', merchantId: 'm1', reference: 'R', amount: 1000000n, status: 'awaiting_payment', createdAt: new Date(), paidAt: null, payer: null, txSignature: null };
    const { svc } = make({ id: 'm1', approvalStatus: 'approved' }, [row]);
    const out = await svc.getForMerchant('m1', 'o1');
    expect(out!.amount).toBe('1000000');
  });
  it('getForMerchant throws 404 when not owned/missing', async () => {
    const { svc, prisma } = make({ id: 'm1', approvalStatus: 'approved' }, []);
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(svc.getForMerchant('m1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrdersService.listForPayer', () => {
  it("returns the payer's paid orders, scoped + serialized", async () => {
    const rows = [{ id: 'o1', reference: 'R1', amount: 990000n, status: 'paid', paidAt: new Date(), txSignature: 'sig', merchant: { businessName: 'Acme' } }];
    const prisma = { order: { findMany: jest.fn().mockResolvedValue(rows) } } as any;
    const audit = { record: jest.fn() } as any;
    const svc = new OrdersService(prisma, audit, 'https://pay.navy/pay', 100);
    const out = await svc.listForPayer('PAYER', { take: 50, skip: 0 });
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { payer: 'PAYER', status: 'paid' }, orderBy: { paidAt: 'desc' },
    }));
    expect(out[0]).toEqual(expect.objectContaining({ orderId: 'o1', amount: '990000', merchant: 'Acme', txSignature: 'sig' }));
  });
});
