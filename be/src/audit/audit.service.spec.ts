import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('writes an append-only audit record', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'a1' });
    const prisma = { auditLog: { create } } as any;
    const audit = new AuditService(prisma);
    await audit.record({ actor: 'user:1', action: 'subwallet.sign', target: 'pk', metadata: { ok: true } });
    expect(create).toHaveBeenCalledWith({
      data: { actor: 'user:1', action: 'subwallet.sign', target: 'pk', metadata: { ok: true } },
    });
  });
});
