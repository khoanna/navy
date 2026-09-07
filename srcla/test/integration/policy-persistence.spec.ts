import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const HASH = `test-${Date.now()}`;

afterAll(async () => {
  await prisma.rejectionReason.deleteMany({ where: { decisionHash: HASH } });
  await prisma.stressCalculation.deleteMany({ where: { decisionHash: HASH } });
  await prisma.candidateAllocation.deleteMany({ where: { decisionHash: HASH } });
  await prisma.enumerationResult.deleteMany({ where: { decisionHash: HASH } });
  await prisma.$disconnect();
});

describe('decision provenance persistence', () => {
  it('stores and reads back candidates, stress rows, enumeration and reasons', async () => {
    await prisma.candidateAllocation.create({
      data: { decisionHash: HASH, marketId: 'aa', amountBase: '1000', lowerBoundWad: '5', exitableBps: 10000 },
    });
    await prisma.stressCalculation.create({
      data: { decisionHash: HASH, scenario: 'w50', demandBase: '500', exitsBase: '400', shortfallBase: '100', feasible: false },
    });
    await prisma.enumerationResult.create({
      data: { decisionHash: HASH, enumerated: 120, regretBps: '3', passed: true },
    });
    await prisma.rejectionReason.create({
      data: { decisionHash: HASH, marketId: 'bb', code: 'PAUSED', passed: false, detail: 'market paused' },
    });

    expect(await prisma.candidateAllocation.count({ where: { decisionHash: HASH } })).toBe(1);
    expect((await prisma.enumerationResult.findUnique({ where: { decisionHash: HASH } }))!.regretBps).toBe('3');
    expect((await prisma.stressCalculation.findFirst({ where: { decisionHash: HASH } }))!.feasible).toBe(false);
  });
});
