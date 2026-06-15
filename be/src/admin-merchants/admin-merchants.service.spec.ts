import { BadRequestException, BadGatewayException, NotFoundException } from '@nestjs/common';
import { AdminMerchantsService } from './admin-merchants.service';

function deps(merchant: any) {
  const prisma = {
    merchant: {
      findMany: jest.fn().mockResolvedValue([merchant]),
      findUnique: jest.fn().mockResolvedValue(merchant),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...merchant, ...data })),
    },
  } as any;
  const registrar = { ensureRegisteredActive: jest.fn().mockResolvedValue('sig123'), deactivate: jest.fn().mockResolvedValue('sigoff') };
  const audit = { record: jest.fn() };
  return { svc: new AdminMerchantsService(prisma, registrar as any, audit as any), prisma, registrar, audit };
}

describe('AdminMerchantsService', () => {
  it('lists by status', async () => {
    const { svc, prisma } = deps({ id: 'm1' });
    await svc.list('pending', 10, 0);
    expect(prisma.merchant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { approvalStatus: 'pending' } }));
  });
  it('list all omits the status filter', async () => {
    const { svc, prisma } = deps({ id: 'm1' });
    await svc.list('all', 10, 0);
    expect(prisma.merchant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
  it('rejects approval when payoutAddress is missing', async () => {
    const { svc } = deps({ id: 'm1', payoutAddress: null, approvalStatus: 'pending' });
    await expect(svc.approve('m1')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('approves: registers on-chain then stores status + tx', async () => {
    const { svc, prisma, registrar } = deps({ id: 'm1', payoutAddress: 'PK', approvalStatus: 'pending' });
    const res = await svc.approve('m1');
    expect(registrar.ensureRegisteredActive).toHaveBeenCalled();
    const data = prisma.merchant.update.mock.calls[0][0].data;
    expect(data.approvalStatus).toBe('approved');
    expect(data.onchainRegisterTx).toBe('sig123');
    expect(res.approvalStatus).toBe('approved');
  });
  it('leaves the merchant pending (502) if on-chain registration fails', async () => {
    const { svc, prisma, registrar } = deps({ id: 'm1', payoutAddress: 'PK', approvalStatus: 'pending' });
    registrar.ensureRegisteredActive.mockRejectedValue(new Error('rpc down'));
    await expect(svc.approve('m1')).rejects.toBeInstanceOf(BadGatewayException);
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });
  it('rejects: sets status + reason and deactivates if registered', async () => {
    const { svc, prisma, registrar } = deps({ id: 'm1', approvalStatus: 'approved', onchainRegisteredAt: new Date(), payoutAddress: 'PK' });
    await svc.reject('m1', 'bad docs');
    expect(registrar.deactivate).toHaveBeenCalled();
    const data = prisma.merchant.update.mock.calls[0][0].data;
    expect(data.approvalStatus).toBe('rejected');
    expect(data.rejectionReason).toBe('bad docs');
  });
  it('approve throws 404 for an unknown merchant', async () => {
    const { svc, prisma } = deps(null);
    prisma.merchant.findUnique.mockResolvedValue(null);
    await expect(svc.approve('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
