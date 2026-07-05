import { MerchantChargesService } from './merchant-charges.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const prisma = {
  merchantCharge: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
} as any;

describe('MerchantChargesService', () => {
  let svc: MerchantChargesService;
  beforeEach(() => { jest.clearAllMocks(); svc = new MerchantChargesService(prisma); });

  it('creates a percent charge', async () => {
    prisma.merchantCharge.create.mockResolvedValue({ id: 'c1', name: 'VAT', mode: 'percent', value: 1000, active: true, sortOrder: 0 });
    const r = await svc.create('m1', { name: 'VAT', mode: 'percent', value: 1000 });
    expect(prisma.merchantCharge.create).toHaveBeenCalledWith({ data: { merchantId: 'm1', name: 'VAT', mode: 'percent', value: 1000, sortOrder: 0 } });
    expect(r.value).toBe(1000);
  });

  it('rejects an invalid mode', async () => {
    await expect(svc.create('m1', { name: 'x', mode: 'bogus' as any, value: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a percent value over 10000 bps', async () => {
    await expect(svc.create('m1', { name: 'x', mode: 'percent', value: 10001 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a negative value', async () => {
    await expect(svc.create('m1', { name: 'x', mode: 'fixed', value: -1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects update of a charge not owned', async () => {
    prisma.merchantCharge.findFirst.mockResolvedValue(null);
    await expect(svc.update('m1', 'cX', { name: 'y' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
