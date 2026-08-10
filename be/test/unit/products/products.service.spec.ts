import { ProductsService } from '../../../src/products/products.service';
import { NotFoundException } from '@nestjs/common';

const prisma = {
  product: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
} as any;

describe('ProductsService', () => {
  let svc: ProductsService;
  beforeEach(() => { jest.clearAllMocks(); svc = new ProductsService(prisma); });

  it('creates a product scoped to the merchant, serializing BigInt price', async () => {
    prisma.product.create.mockResolvedValue({ id: 'p1', merchantId: 'm1', name: 'Tee', sku: 'T', unitPrice: 1_000_000n, active: true });
    const r = await svc.create('m1', { name: 'Tee', sku: 'T', unitPrice: 1_000_000n, imageUrl: '', imagePublicId: '' });
    expect(prisma.product.create).toHaveBeenCalledWith({ data: { merchantId: 'm1', name: 'Tee', sku: 'T', unitPrice: 1_000_000n } });
    expect(r.unitPrice).toBe('1000000');
  });

  it('lists a merchant\'s products', async () => {
    prisma.product.findMany.mockResolvedValue([{ id: 'p1', merchantId: 'm1', name: 'Tee', sku: null, unitPrice: 1_000_000n, active: true }]);
    const r = await svc.listForMerchant('m1');
    expect(prisma.product.findMany).toHaveBeenCalledWith({ where: { merchantId: 'm1' }, orderBy: { createdAt: 'desc' } });
    expect(r[0].unitPrice).toBe('1000000');
  });

  it('rejects update of a product not owned by the merchant', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(svc.update('m1', 'pX', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('archives via update active=false', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', merchantId: 'm1' });
    prisma.product.update.mockResolvedValue({ id: 'p1', merchantId: 'm1', name: 'Tee', sku: null, unitPrice: 1_000_000n, active: false });
    const r = await svc.archive('m1', 'p1');
    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { active: false } });
    expect(r.active).toBe(false);
  });
});
