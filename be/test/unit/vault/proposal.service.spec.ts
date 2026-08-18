import { ProposalService } from '../../../src/vault/proposal.service';

/**
 * Unit tests for ProposalService
 * Tests the two-phase proposal lifecycle: PENDING → APPROVED/REJECTED → EXECUTED
 */
function createMockPrisma() {
  const proposals: Map<string, any> = new Map();
  let idCounter = 0;

  return {
    proposal: {
      create: jest.fn(async ({ data }: any) => {
        const id = `proposal-${++idCounter}`;
        const now = new Date();
        const proposal = {
          id,
          createdAt: now,
          updatedAt: now,
          status: 'PENDING',
          actions: data.actions,
          targetReserve: data.targetReserve,
          estimatedCost: data.estimatedCost ?? 0n,
          evaluation: null,
          signature: null,
          executedAt: null,
          decisionHash: data.decisionHash ?? null,
        };
        proposals.set(id, proposal);
        return proposal;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const p = proposals.get(where.id);
        if (!p) throw new Error(`Proposal not found: ${where.id}`);
        return p;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const p = proposals.get(where.id);
        if (!p) throw new Error(`Proposal not found: ${where.id}`);
        const updated = { ...p, ...data, updatedAt: new Date() };
        proposals.set(where.id, updated);
        return updated;
      }),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        let results = Array.from(proposals.values());
        if (where?.status) {
          results = results.filter((p) => p.status === where.status);
        }
        if (orderBy?.createdAt === 'desc') {
          results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return results;
      }),
    },
    proposals,
  };
}

function createService(prismaMock: ReturnType<typeof createMockPrisma>) {
  return new ProposalService(prismaMock as any);
}

describe('ProposalService', () => {
  describe('createProposal', () => {
    it('should create a proposal with pending status', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const actions = [
        { kind: 'deploy', adapter: '0x1234567890123456789012345678901234567890', amount: '1000000', minOut: '0' },
      ];
      const targetReserve = 5000000n;

      const proposal = await service.createProposal(actions, targetReserve);

      expect(proposal.status).toBe('PENDING');
      expect(proposal.actions).toEqual(actions);
      expect(proposal.targetReserve).toBe(targetReserve.toString());
      expect(prisma.proposal.create).toHaveBeenCalled();
    });

    it('should link proposal to decision if hash provided', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const decisionHash = 'test-hash-123';
      const proposal = await service.createProposal([], 0n, decisionHash);

      expect(proposal.decisionHash).toBe(decisionHash);
    });

    it('should default estimatedCost to 0n when not provided', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 1000n);

      expect(proposal.estimatedCost).toBe('0');
    });
  });

  describe('getProposal', () => {
    it('should return proposal by id', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const created = await service.createProposal([], 1000n);
      const retrieved = await service.getProposal(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.status).toBe('PENDING');
    });

    it('should throw if proposal not found', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      await expect(service.getProposal('non-existent')).rejects.toThrow();
    });
  });

  describe('approveProposal', () => {
    it('should update status to APPROVED when valid', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);

      const evaluation = {
        valid: true,
        reasons: [],
        policyChecks: {
          admissionPassed: true,
          costGatePassed: true,
          reservePassed: true,
          capsPassed: true,
        },
      };

      const updated = await service.approveProposal(proposal.id, evaluation);

      expect(updated.status).toBe('APPROVED');
      expect(updated.evaluation).toBeTruthy();
    });

    it('should update status to REJECTED when invalid', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);

      const evaluation = {
        valid: false,
        reasons: ['Insufficient reserve'],
        policyChecks: {
          admissionPassed: true,
          costGatePassed: false,
          reservePassed: true,
          capsPassed: true,
        },
      };

      const updated = await service.approveProposal(proposal.id, evaluation);

      expect(updated.status).toBe('REJECTED');
    });

    it('should throw if proposal is not pending', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      await service.approveProposal(proposal.id, {
        valid: true,
        reasons: [],
        policyChecks: {
          admissionPassed: true,
          costGatePassed: true,
          reservePassed: true,
          capsPassed: true,
        },
      });

      await expect(
        service.approveProposal(proposal.id, {
          valid: true,
          reasons: [],
          policyChecks: {
            admissionPassed: true,
            costGatePassed: true,
            reservePassed: true,
            capsPassed: true,
          },
        }),
      ).rejects.toThrow(/not pending/i);
    });
  });

  describe('signProposal', () => {
    it('should add signature to approved proposal', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      await service.approveProposal(proposal.id, {
        valid: true,
        reasons: [],
        policyChecks: {
          admissionPassed: true,
          costGatePassed: true,
          reservePassed: true,
          capsPassed: true,
        },
      });

      const signature = '0xsig1234567890abcdef';
      const updated = await service.signProposal(proposal.id, signature);

      expect(updated.signature).toBe(signature);
    });

    it('should throw if proposal is not approved', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);

      await expect(service.signProposal(proposal.id, '0xsig')).rejects.toThrow(/not approved/i);
    });
  });

  describe('executeProposal', () => {
    it('should mark proposal as executed with signature', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      await service.approveProposal(proposal.id, {
        valid: true,
        reasons: [],
        policyChecks: {
          admissionPassed: true,
          costGatePassed: true,
          reservePassed: true,
          capsPassed: true,
        },
      });
      await service.signProposal(proposal.id, '0xsig');

      const updated = await service.executeProposal(proposal.id);

      expect(updated.status).toBe('EXECUTED');
      expect(updated.executedAt).toBeTruthy();
    });

    it('should throw if proposal has no signature', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      await service.approveProposal(proposal.id, {
        valid: true,
        reasons: [],
        policyChecks: {
          admissionPassed: true,
          costGatePassed: true,
          reservePassed: true,
          capsPassed: true,
        },
      });

      await expect(service.executeProposal(proposal.id)).rejects.toThrow(/no SRCLA signature/i);
    });

    it('should throw if proposal is not approved', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);

      await expect(service.executeProposal(proposal.id)).rejects.toThrow(/not approved/i);
    });
  });

  describe('expireProposal', () => {
    it('should mark pending proposal as expired', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      const updated = await service.expireProposal(proposal.id);

      expect(updated.status).toBe('EXPIRED');
    });

    it('should throw if proposal is already executed', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      await service.approveProposal(proposal.id, {
        valid: true,
        reasons: [],
        policyChecks: {
          admissionPassed: true,
          costGatePassed: true,
          reservePassed: true,
          capsPassed: true,
        },
      });
      await service.signProposal(proposal.id, '0xsig');
      await service.executeProposal(proposal.id);

      await expect(service.expireProposal(proposal.id)).rejects.toThrow(/cannot be expired/i);
    });
  });

  describe('getProposalsByStatus', () => {
    it('should return only proposals with matching status', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      await service.createProposal([], 0n);
      const pending2 = await service.createProposal([], 0n);
      await service.approveProposal(pending2.id, {
        valid: true,
        reasons: [],
        policyChecks: {
          admissionPassed: true,
          costGatePassed: true,
          reservePassed: true,
          capsPassed: true,
        },
      });

      const pending = await service.getProposalsByStatus('PENDING');
      const approved = await service.getProposalsByStatus('APPROVED');

      expect(pending).toHaveLength(1);
      expect(approved).toHaveLength(1);
    });
  });

  describe('getPendingProposals', () => {
    it('should return all pending proposals', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      await service.createProposal([], 0n);
      await service.createProposal([], 0n);

      const pending = await service.getPendingProposals();

      expect(pending).toHaveLength(2);
      pending.forEach((p) => expect(p.status).toBe('PENDING'));
    });
  });

  describe('getApprovedProposals', () => {
    it('should return all approved proposals', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const p1 = await service.createProposal([], 0n);
      const p2 = await service.createProposal([], 0n);
      await service.approveProposal(p1.id, {
        valid: true,
        reasons: [],
        policyChecks: {
          admissionPassed: true,
          costGatePassed: true,
          reservePassed: true,
          capsPassed: true,
        },
      });
      await service.approveProposal(p2.id, {
        valid: true,
        reasons: [],
        policyChecks: {
          admissionPassed: true,
          costGatePassed: true,
          reservePassed: true,
          capsPassed: true,
        },
      });

      const approved = await service.getApprovedProposals();

      expect(approved).toHaveLength(2);
      approved.forEach((p) => expect(p.status).toBe('APPROVED'));
    });
  });

  describe('linkToDecision', () => {
    it('should link proposal to decision hash', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      const decisionHash = '0xdecision123';

      const updated = await service.linkToDecision(proposal.id, decisionHash);

      expect(updated.decisionHash).toBe(decisionHash);
    });

    it('should throw if proposal is not pending', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      await service.approveProposal(proposal.id, {
        valid: true,
        reasons: [],
        policyChecks: {
          admissionPassed: true,
          costGatePassed: true,
          reservePassed: true,
          capsPassed: true,
        },
      });

      await expect(service.linkToDecision(proposal.id, '0xhash')).rejects.toThrow(/Cannot link proposal/i);
    });
  });
});
