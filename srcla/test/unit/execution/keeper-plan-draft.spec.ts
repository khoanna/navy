/**
 * Task 14: KeeperExecutor.executePlanDraft.
 *
 * Covers:
 *  - Structural preflight rejections (no RPC, no network) for every field
 *    the vault's submitPlan would revert InvalidPlan on.
 *  - The sanctioned execution gate (assertExecutionAllowed) firing before
 *    ANY preflight check or RPC call, so a blocked pricing guard cannot be
 *    bypassed by an otherwise-valid draft.
 *  - The submit -> execute-actions orchestration, a wedged active plan being
 *    cancelled first, and the plan stopping on the first failed action —
 *    all exercised via an injected mock IPlanExecutor so nothing here opens
 *    a network connection.
 */
import { ethers } from 'ethers';
import { jest } from '@jest/globals';
import { KeeperExecutor } from '../../../src/execution/keeper-executor.js';
import { ActionKindCode, type ExecutionResult, type IPlanExecutor } from '../../../src/execution/executor.js';
import { ExecutionBlockedError } from '../../../src/runtime/decision-driver.js';
import type { PlanDraft } from '../../../src/policy/types.js';

const ALLOWED_GUARD = { placeholderPricesInUse: false, placeholderPriceFields: [] };
const BLOCKED_GUARD = { placeholderPricesInUse: true, placeholderPriceFields: ['ethUsdE8'] };

function draft(over: Partial<PlanDraft['header']> = {}): PlanDraft {
  const header: PlanDraft['header'] = {
    planId: 42n,
    policyVersion: 5n,
    createdAt: 1_000_000n,
    expiresAt: 1_001_800n,
    actionCount: 1n,
    snapshotBlockNumber: 12345n,
    snapshotHash: '0x' + 'ef'.repeat(32),
    decisionHash: '0x' + '99'.repeat(32),
    configurationDigest: '0x' + 'cd'.repeat(32),
    reserve: 1_000_000n,
    minFinalAssets: 9_000_000n,
    maxRecognizedLoss: 5_000n,
    turnoverLimit: 10_000_000n,
    ...over,
  };
  return {
    planId: '0x2a',
    decisionHash: header.decisionHash,
    merkleRoot: '0x' + '01'.repeat(32),
    actions: [
      {
        index: 0,
        kind: ActionKindCode.DEPLOY,
        adapter: '0x' + 'aa'.repeat(20),
        amountBase: 1_000_000n,
        minOutBase: 999_000n,
        dataHash: ethers.ZeroHash,
        proof: [],
      },
    ],
    header,
  };
}

/** Builds a keeper against no real network — the JsonRpcProvider is lazy and never connects unless a preflight/mocked-executor path reaches an RPC call. */
function keeper(
  pricingGuard: { placeholderPricesInUse: boolean; placeholderPriceFields: string[] } = ALLOWED_GUARD,
  executorOverride?: IPlanExecutor
): KeeperExecutor {
  return new KeeperExecutor(
    {
      keeperPrivateKey: '0x' + '11'.repeat(32),
      vaultAddress: '0x' + '22'.repeat(20),
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 8453,
      pricingGuard,
    },
    executorOverride
  );
}

function ok(txHash: string): ExecutionResult {
  return { success: true, txHash };
}
function fail(error: string): ExecutionResult {
  return { success: false, error };
}

/** A mock IPlanExecutor recording calls, for asserting orchestration order. */
function mockExecutor(
  overrides: Partial<{
    activePlanId: string;
    cancelPlan: () => Promise<ExecutionResult>;
    submitPlan: () => Promise<ExecutionResult>;
    executeNextActionWithProof: (index: number) => Promise<ExecutionResult>;
  }> = {}
) {
  const calls: string[] = [];
  const executor: IPlanExecutor = {
    getActivePlanId: jest.fn<() => Promise<string>>().mockImplementation(async () => {
      calls.push('getActivePlanId');
      return overrides.activePlanId ?? ethers.ZeroHash;
    }),
    cancelPlan: jest.fn<() => Promise<ExecutionResult>>().mockImplementation(async () => {
      calls.push('cancelPlan');
      return overrides.cancelPlan ? overrides.cancelPlan() : ok('0xcancel');
    }),
    submitPlan: jest.fn<() => Promise<ExecutionResult>>().mockImplementation(async () => {
      calls.push('submitPlan');
      return overrides.submitPlan ? overrides.submitPlan() : ok('0xsubmit');
    }),
    executeNextActionWithProof: jest
      .fn<(proof: string[], action: { index: number }) => Promise<ExecutionResult>>()
      .mockImplementation(async (_proof, action) => {
        calls.push(`execute:${action.index}`);
        return overrides.executeNextActionWithProof
          ? overrides.executeNextActionWithProof(action.index)
          : ok(`0xaction${action.index}`);
      }),
    getConfigurationDigest: jest.fn<() => Promise<string>>().mockResolvedValue(ethers.ZeroHash),
    harvest: jest
      .fn<
        (
          adapter: string,
          token: string,
          maxClaim: bigint,
          routeId: string,
          minOut: bigint,
          deadline: bigint
        ) => Promise<ExecutionResult & { usdcReceived?: bigint }>
      >()
      .mockResolvedValue(ok('0xharvest')),
    emergencyExit: jest.fn<(adapter: string) => Promise<ExecutionResult>>().mockResolvedValue(ok('0xemergency')),
    hasAllocatorRole: jest.fn<(address: string) => Promise<boolean>>().mockResolvedValue(true),
    hasAdminRole: jest.fn<(address: string) => Promise<boolean>>().mockResolvedValue(true),
    getPlanState: jest.fn<() => Promise<{
      activePlanId: string;
      merkleRoot: string;
      nextActionIndex: bigint;
      actionCount: bigint;
      expiresAt: bigint;
    }>>().mockResolvedValue({
      activePlanId: ethers.ZeroHash,
      merkleRoot: ethers.ZeroHash,
      nextActionIndex: 0n,
      actionCount: 0n,
      expiresAt: 0n,
    }),
  };
  return { executor, calls };
}

describe('KeeperExecutor.executePlanDraft', () => {
  describe('preflight (no RPC, no network)', () => {
    it('refuses a draft whose snapshot hash is zero', async () => {
      const r = await keeper().executePlanDraft(draft({ snapshotHash: ethers.ZeroHash }));
      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/snapshotHash/i);
    });

    it('refuses a draft whose decision hash is zero', async () => {
      const r = await keeper().executePlanDraft(draft({ decisionHash: ethers.ZeroHash }));
      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/decisionHash/i);
    });

    it('refuses a draft whose actionCount disagrees with the action list', async () => {
      const r = await keeper().executePlanDraft(draft({ actionCount: 5n }));
      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/actionCount/i);
    });

    it('refuses a draft that has already expired at the given origin', async () => {
      const r = await keeper().executePlanDraft(draft({ expiresAt: 1n }));
      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/expire/i);
    });

    it('refuses a draft whose planId is zero', async () => {
      const r = await keeper().executePlanDraft(draft({ planId: 0n }));
      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/planId/i);
    });

    it('reports every violated field at once rather than stopping at the first', async () => {
      const r = await keeper().executePlanDraft(
        draft({ snapshotHash: ethers.ZeroHash, decisionHash: ethers.ZeroHash, actionCount: 9n })
      );
      expect(r.success).toBe(false);
      expect(r.errors.length).toBeGreaterThanOrEqual(3);
      expect(r.errors.join(' ')).toMatch(/snapshotHash/i);
      expect(r.errors.join(' ')).toMatch(/decisionHash/i);
      expect(r.errors.join(' ')).toMatch(/actionCount/i);
    });

    it('does not touch the executor at all when preflight fails', async () => {
      const { executor, calls } = mockExecutor();
      await keeper(ALLOWED_GUARD, executor).executePlanDraft(draft({ snapshotHash: ethers.ZeroHash }));
      expect(calls).toEqual([]);
    });
  });

  describe('the sanctioned execution gate', () => {
    it('throws ExecutionBlockedError for an otherwise-valid draft when placeholder prices are in use', async () => {
      await expect(keeper(BLOCKED_GUARD).executePlanDraft(draft())).rejects.toThrow(ExecutionBlockedError);
    });

    it('throws ExecutionBlockedError before any preflight check runs, even for a malformed draft', async () => {
      // If the guard fired after preflight, this malformed draft would
      // surface a returned {success:false} with a snapshotHash message
      // instead of a rejected ExecutionBlockedError -- asserting the throw
      // proves the guard is checked first, unconditionally.
      await expect(
        keeper(BLOCKED_GUARD).executePlanDraft(draft({ snapshotHash: ethers.ZeroHash }))
      ).rejects.toThrow(ExecutionBlockedError);
    });

    it('never reaches the executor when the guard blocks execution', async () => {
      const { executor, calls } = mockExecutor();
      await expect(keeper(BLOCKED_GUARD, executor).executePlanDraft(draft())).rejects.toThrow(ExecutionBlockedError);
      expect(calls).toEqual([]);
    });

    it('names the placeholder fields in the thrown error', async () => {
      try {
        await keeper(BLOCKED_GUARD).executePlanDraft(draft());
        throw new Error('expected executePlanDraft to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ExecutionBlockedError);
        expect((error as ExecutionBlockedError).placeholderPriceFields).toEqual(['ethUsdE8']);
      }
    });

    it('does not throw when the guard allows execution and the draft is valid', async () => {
      const { executor } = mockExecutor();
      const r = await keeper(ALLOWED_GUARD, executor).executePlanDraft(draft());
      expect(r.success).toBe(true);
    });
  });

  describe('orchestration (injected mock executor, no network)', () => {
    it('submits the plan then executes each action in order', async () => {
      const { executor, calls } = mockExecutor();
      const d = draft({ actionCount: 2n });
      d.actions = [
        { ...d.actions[0]!, index: 0 },
        { ...d.actions[0]!, index: 1 },
      ];
      const r = await keeper(ALLOWED_GUARD, executor).executePlanDraft(d);

      expect(r.success).toBe(true);
      expect(r.txHashes).toEqual(['0xsubmit', '0xaction0', '0xaction1']);
      expect(calls).toEqual(['getActivePlanId', 'submitPlan', 'execute:0', 'execute:1']);
    });

    it('cancels a wedged active plan before submitting a new one', async () => {
      const { executor, calls } = mockExecutor({ activePlanId: '0x' + 'bb'.repeat(32) });
      const r = await keeper(ALLOWED_GUARD, executor).executePlanDraft(draft());

      expect(r.success).toBe(true);
      expect(calls).toEqual(['getActivePlanId', 'cancelPlan', 'submitPlan', 'execute:0']);
    });

    it('does not cancel anything when there is no active plan', async () => {
      const { executor, calls } = mockExecutor({ activePlanId: ethers.ZeroHash });
      await keeper(ALLOWED_GUARD, executor).executePlanDraft(draft());
      expect(calls).not.toContain('cancelPlan');
    });

    it('fails without submitting when cancelling the stale plan fails', async () => {
      const { executor, calls } = mockExecutor({
        activePlanId: '0x' + 'bb'.repeat(32),
        cancelPlan: async () => fail('cancel reverted'),
      });
      const r = await keeper(ALLOWED_GUARD, executor).executePlanDraft(draft());

      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/stale plan/i);
      expect(r.errors.join(' ')).toMatch(/cancel reverted/);
      expect(calls).toEqual(['getActivePlanId', 'cancelPlan']);
      expect(calls).not.toContain('submitPlan');
    });

    it('surfaces a failed submitPlan and never executes any action', async () => {
      const { executor, calls } = mockExecutor({ submitPlan: async () => fail('InvalidPlan') });
      const r = await keeper(ALLOWED_GUARD, executor).executePlanDraft(draft());

      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/submitPlan failed/i);
      expect(r.txHashes).toEqual([]);
      expect(calls.some((c) => c.startsWith('execute:'))).toBe(false);
    });

    it('stops the plan at the first failed action, per §9.5, leaving later actions unexecuted', async () => {
      const { executor, calls } = mockExecutor({
        executeNextActionWithProof: async (index) => (index === 0 ? fail('divest reverted') : ok('0xnever')),
      });
      const d = draft({ actionCount: 2n });
      d.actions = [
        { ...d.actions[0]!, index: 0, kind: ActionKindCode.DIVEST },
        { ...d.actions[0]!, index: 1, kind: ActionKindCode.DEPLOY },
      ];
      const r = await keeper(ALLOWED_GUARD, executor).executePlanDraft(d);

      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/action 0/);
      expect(calls).toEqual(['getActivePlanId', 'submitPlan', 'execute:0']);
      expect(calls).not.toContain('execute:1');
    });

    it('returns the plan id on both success and failure', async () => {
      const { executor: okExecutor } = mockExecutor();
      const success = await keeper(ALLOWED_GUARD, okExecutor).executePlanDraft(draft());
      expect(success.planId).toBe('0x2a');

      const { executor: failExecutor } = mockExecutor({
        executeNextActionWithProof: async () => fail('boom'),
      });
      const failure = await keeper(ALLOWED_GUARD, failExecutor).executePlanDraft(draft());
      expect(failure.planId).toBe('0x2a');
    });
  });
});
