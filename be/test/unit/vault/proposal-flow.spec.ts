/**
 * Proposal Flow Integration Test (Task 10)
 *
 * End-to-end test for the paper-compliant two-phase proposal system:
 *   1. Backend creates an unsigned proposal (PENDING)
 *   2. SRCLA reviews and approves/rejects (APPROVED/REJECTED)
 *   3. If approved, SRCLA signs it (signature added)
 *   4. Keeper executes on-chain (EXECUTED)
 *
 * Implements paper §4: "SRCLA reviews proposals from backend"
 */
import { ProposalService } from '../../../src/vault/proposal.service';
import type { ApproveProposalInput } from '../../../src/vault/proposal.service';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

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
      findMany: jest.fn(async ({ where }: any) => {
        let results = Array.from(proposals.values());
        if (where?.status) {
          results = results.filter((p) => p.status === where.status);
        }
        return results;
      }),
    },
  };
}

function createService(prisma: ReturnType<typeof createMockPrisma>) {
  return new ProposalService(prisma as any);
}

// ─── Valid evaluation helper ───────────────────────────────────────────────────

function validEvaluation(): ApproveProposalInput {
  return {
    valid: true,
    reasons: [],
    policyChecks: {
      admissionPassed: true,
      costGatePassed: true,
      reservePassed: true,
      capsPassed: true,
    },
  };
}

function rejectedEvaluation(): ApproveProposalInput {
  return {
    valid: false,
    reasons: ['Cost gate check failed', 'Reserve policy check failed'],
    policyChecks: {
      admissionPassed: true,
      costGatePassed: false,
      reservePassed: false,
      capsPassed: true,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Proposal Flow (E2E unit)', () => {
  describe('Happy path: full PENDING → APPROVED → signed → EXECUTED lifecycle', () => {
    it('should complete the full proposal flow successfully', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const actions = [
        { kind: 'deploy', adapter: '0x24d4173e6b9734a52c20190a9c5681ef350D8fE2', amount: '1000000', minOut: '0' },
      ];

      // Step 1 — Backend creates proposal
      const proposal = await service.createProposal(actions, 5_000_000n);
      expect(proposal.status).toBe('PENDING');
      expect(proposal.actions).toEqual(actions);
      expect(proposal.signature).toBeNull();

      // Step 2 — SRCLA approves
      const approved = await service.approveProposal(proposal.id, validEvaluation());
      expect(approved.status).toBe('APPROVED');
      expect(JSON.parse(JSON.stringify(approved.evaluation))).toMatchObject({ valid: true });

      // Step 3 — Keeper signs
      const signature = '0xdeadbeef0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001c';
      const signed = await service.signProposal(proposal.id, signature);
      expect(signed.signature).toBe(signature);
      expect(signed.status).toBe('APPROVED');

      // Step 4 — Execute on-chain
      const executed = await service.executeProposal(proposal.id);
      expect(executed.status).toBe('EXECUTED');
      expect(executed.executedAt).not.toBeNull();
    });

    it('should link proposal to a decision hash during creation', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const decisionHash = 'abc123def456';
      const proposal = await service.createProposal([], 0n, decisionHash);

      expect(proposal.decisionHash).toBe(decisionHash);
      expect(proposal.status).toBe('PENDING');
    });
  });

  describe('Rejection path: PENDING → REJECTED', () => {
    it('should reject a proposal when evaluation fails', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      const rejected = await service.approveProposal(proposal.id, rejectedEvaluation());

      expect(rejected.status).toBe('REJECTED');
      const evaluation = JSON.parse(JSON.stringify(rejected.evaluation));
      expect(evaluation.valid).toBe(false);
      expect(evaluation.reasons).toContain('Cost gate check failed');
    });
  });

  describe('Status enforcement', () => {
    it('should not allow approving a non-PENDING proposal', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      await service.approveProposal(proposal.id, validEvaluation());

      // Already APPROVED — second approve should throw
      await expect(service.approveProposal(proposal.id, validEvaluation()))
        .rejects.toThrow(/not pending/i);
    });

    it('should not allow signing a non-APPROVED proposal', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);

      // Still PENDING — signing should throw
      await expect(service.signProposal(proposal.id, '0xsig'))
        .rejects.toThrow(/not approved/i);
    });

    it('should not allow executing without a signature', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      await service.approveProposal(proposal.id, validEvaluation());

      // APPROVED but unsigned — execute should throw
      await expect(service.executeProposal(proposal.id))
        .rejects.toThrow(/no SRCLA signature/i);
    });

    it('should expire a PENDING proposal', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      const expired = await service.expireProposal(proposal.id);

      expect(expired.status).toBe('EXPIRED');
    });

    it('should expire an APPROVED proposal', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([], 0n);
      await service.approveProposal(proposal.id, validEvaluation());

      const expired = await service.expireProposal(proposal.id);
      expect(expired.status).toBe('EXPIRED');
    });
  });

  describe('Query helpers', () => {
    it('should return all pending proposals', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      await service.createProposal([], 0n);
      await service.createProposal([], 0n);

      const pending = await service.getPendingProposals();
      expect(pending).toHaveLength(2);
      expect(pending.every((p) => p.status === 'PENDING')).toBe(true);
    });

    it('should return only approved proposals', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const p1 = await service.createProposal([], 0n);
      await service.createProposal([], 0n); // stays PENDING

      await service.approveProposal(p1.id, validEvaluation());

      const approved = await service.getApprovedProposals();
      expect(approved).toHaveLength(1);
      expect(approved[0]!.status).toBe('APPROVED');
    });

    it('should get a specific proposal by ID', async () => {
      const prisma = createMockPrisma();
      const service = createService(prisma);

      const proposal = await service.createProposal([{ kind: 'harvest' }], 500n);
      const fetched = await service.getProposal(proposal.id);

      expect(fetched.id).toBe(proposal.id);
      expect(fetched.targetReserve).toBe('500');
    });
  });
});
