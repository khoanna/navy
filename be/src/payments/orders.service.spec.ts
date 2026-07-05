import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let prisma: any;
  let charges: any;
  let svc: OrdersService;
  beforeEach(() => {
    prisma = {
      merchant: { findUnique: jest.fn() },
      product: { findMany: jest.fn() },
      order: { create: jest.fn(), findUnique: jest.fn() },
    };
    charges = { activeForMerchant: jest.fn() };
    const audit = { record: jest.fn() } as any;
    svc = new OrdersService(prisma, audit, 'https://pay.navy/pay', 100, charges);
  });

  it('creates an order from line items, snapshotting price + applying charges', async () => {
    prisma.merchant.findUnique.mockResolvedValue({ id: 'm1', approvalStatus: 'approved' });
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', merchantId: 'm1', name: 'Tee', unitPrice: 1_000_000n, active: true },
    ]);
    charges.activeForMerchant.mockResolvedValue([{ name: 'VAT', mode: 'percent', value: 1000, active: true }]);
    prisma.order.create.mockResolvedValue({ id: 'o1', reference: 'ORD-XXXXXXXX', amount: 1_100_000n, expiresAt: new Date(), status: 'awaiting_payment' });

    const res = await svc.createForMerchant('m1', { items: [{ productId: 'p1', quantity: 1 }] });

    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.amount).toBe(1_100_000n);
    expect(data.subtotal).toBe(1_000_000n);
    expect(data.reference).toMatch(/^ORD-/);
    expect(data.items.create).toEqual([{ productId: 'p1', name: 'Tee', unitPrice: 1_000_000n, quantity: 1 }]);
    expect(data.charges.create).toEqual([{ name: 'VAT', mode: 'percent', value: 1000, amount: 100_000n }]);
    expect(res.orderId).toBe('o1');
  });

  it('rejects items referencing a product not owned or inactive', async () => {
    prisma.merchant.findUnique.mockResolvedValue({ id: 'm1', approvalStatus: 'approved' });
    prisma.product.findMany.mockResolvedValue([]);
    charges.activeForMerchant.mockResolvedValue([]);
    await expect(svc.createForMerchant('m1', { items: [{ productId: 'p1', quantity: 1 }] })).rejects.toThrow(/product/i);
  });

  it('rejects an empty items list', async () => {
    prisma.merchant.findUnique.mockResolvedValue({ id: 'm1', approvalStatus: 'approved' });
    await expect(svc.createForMerchant('m1', { items: [] })).rejects.toThrow(/at least one/i);
  });

  it('rejects when total is below MIN_INVOICE_AMOUNT', async () => {
    prisma.merchant.findUnique.mockResolvedValue({ id: 'm1', approvalStatus: 'approved' });
    prisma.product.findMany.mockResolvedValue([{ id: 'p1', merchantId: 'm1', name: 'Cheap', unitPrice: 100n, active: true }]);
    charges.activeForMerchant.mockResolvedValue([]);
    await expect(svc.createForMerchant('m1', { items: [{ productId: 'p1', quantity: 1 }] })).rejects.toThrow(/at least/i);
  });
});

describe('OrdersService merchant-scoped', () => {
  function make(merchant: any, orders: any[] = []) {
    const prisma = {
      merchant: { findUnique: jest.fn().mockResolvedValue(merchant) },
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', merchantId: 'm1', name: 'Tee', unitPrice: 1_000_000n, active: true }]) },
      order: {
        create: jest.fn().mockResolvedValue({ id: 'o1', reference: 'ORD-XXXXXXXX', amount: 1000000n, status: 'awaiting_payment', expiresAt: new Date() }),
        findMany: jest.fn().mockResolvedValue(orders),
        findFirst: jest.fn().mockResolvedValue(orders[0] ?? null),
      },
    } as any;
    const charges = { activeForMerchant: jest.fn().mockResolvedValue([]) } as any;
    const audit = { record: jest.fn() } as any;
    return { svc: new OrdersService(prisma, audit, 'https://pay.navy/pay', 100, charges), prisma };
  }
  it('createForMerchant rejects an unapproved merchant with 409', async () => {
    const { svc } = make({ id: 'm1', approvalStatus: 'pending' });
    await expect(svc.createForMerchant('m1', { items: [{ productId: 'p1', quantity: 1 }] })).rejects.toBeInstanceOf(ConflictException);
  });
  it('createForMerchant creates when approved', async () => {
    const { svc, prisma } = make({ id: 'm1', approvalStatus: 'approved' });
    const res = await svc.createForMerchant('m1', { items: [{ productId: 'p1', quantity: 1 }] });
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
    const charges = { activeForMerchant: jest.fn().mockResolvedValue([]) } as any;
    const audit = { record: jest.fn() } as any;
    const svc = new OrdersService(prisma, audit, 'https://pay.navy/pay', 100, charges);
    const out = await svc.listForPayer('PAYER', { take: 50, skip: 0 });
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { payer: 'PAYER', status: 'paid' }, orderBy: { paidAt: 'desc' },
    }));
    expect(out[0]).toEqual(expect.objectContaining({ orderId: 'o1', amount: '990000', merchant: 'Acme', txSignature: 'sig' }));
  });
});
