import { AdminMerchantsController } from './admin-merchants.controller';

// A raw Prisma merchant row includes the argon2 passwordHash column, which must
// never leave the server. The controller wraps service results in toMerchantDto,
// which strips it. Guard approve/reject specifically (they were once missed).
function rawMerchant(overrides: any = {}) {
  return {
    id: 'm1',
    email: 'm@x.io',
    businessName: 'Biz',
    approvalStatus: 'approved',
    payoutAddress: 'Addr',
    onchainRegisteredAt: new Date(),
    rejectionReason: null,
    createdAt: new Date(),
    passwordHash: '$argon2id$secret',
    ...overrides,
  };
}

describe('AdminMerchantsController secret stripping', () => {
  it('approve response omits passwordHash', async () => {
    const svc = { approve: jest.fn().mockResolvedValue(rawMerchant({ approvalStatus: 'approved' })) } as any;
    const ctrl = new AdminMerchantsController(svc);
    const res: any = await ctrl.approve('m1');
    expect(res).not.toHaveProperty('passwordHash');
    expect(res.approvalStatus).toBe('approved');
  });

  it('reject response omits passwordHash', async () => {
    const svc = { reject: jest.fn().mockResolvedValue(rawMerchant({ approvalStatus: 'rejected', rejectionReason: 'nope' })) } as any;
    const ctrl = new AdminMerchantsController(svc);
    const res: any = await ctrl.reject('m1', { reason: 'nope' });
    expect(res).not.toHaveProperty('passwordHash');
    expect(res.approvalStatus).toBe('rejected');
    expect(res.rejectionReason).toBe('nope');
  });
});
