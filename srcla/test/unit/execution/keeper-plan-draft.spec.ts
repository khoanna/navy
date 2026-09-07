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
 *  - Task 15 review, Finding 1: the per-action loop now routes through
 *    runSubmissionLoop's §10.3 discipline. The "submission loop wiring"
 *    describe block below proves each stage (verifyChain, simulate, submit,
 *    reconcile) actually gates later actions, and that the injected
 *    executionLock is acquired/released around the whole call — asserting
 *    directly on that mock, not just on the returned KeeperExecutionResult.
 */
import { ethers } from 'ethers';
import { jest } from '@jest/globals';
import { KeeperExecutor, type KeeperExecutionLock } from '../../../src/execution/keeper-executor.js';
import { ActionKindCode, type ExecutionResult, type IPlanExecutor } from '../../../src/execution/executor.js';
import { ExecutionBlockedError } from '../../../src/runtime/decision-driver.js';
import type { PlanDraft } from '../../../src/policy/types.js';

/** Matches draft()'s header.configurationDigest default below, so the wired-in verifyChain step (which compares live vs. plan configurationDigest) passes by default in tests that don't care about it. */
const DEFAULT_CONFIG_DIGEST = '0x' + 'cd'.repeat(32);

const ALLOWED_GUARD = { placeholderPricesInUse: false, placeholderPriceFields: [] };
const BLOCKED_GUARD = { placeholderPricesInUse: true, placeholderPriceFields: ['ethUsdE8'] };

/** Real wall-clock "now", in seconds -- Task 14 review Finding 2 added a live expiresAt/createdAt-vs-now preflight check, so fixture headers must be realistic relative to it, not fixed early-epoch values. */
const NOW = BigInt(Math.floor(Date.now() / 1000));

function draft(over: Partial<PlanDraft['header']> = {}): PlanDraft {
  const header: PlanDraft['header'] = {
    planId: 42n,
    policyVersion: 5n,
    createdAt: NOW - 100n,
    expiresAt: NOW + 1_800n,
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

/** A working, non-instrumented executionLock for tests that don't care about lock behavior — see mockExecutionLock() below for one that records calls. */
function workingLock(): KeeperExecutionLock {
  return {
    acquireLock: async () => true,
    persistIntent: async () => {},
    releaseLock: async () => {},
  };
}

/** Builds a keeper against no real network — the JsonRpcProvider is lazy and never connects unless a preflight/mocked-executor path reaches an RPC call. */
function keeper(
  pricingGuard: { placeholderPricesInUse: boolean; placeholderPriceFields: string[] } = ALLOWED_GUARD,
  executorOverride?: IPlanExecutor,
  executionLock: KeeperExecutionLock = workingLock()
): KeeperExecutor {
  return new KeeperExecutor(
    {
      keeperPrivateKey: '0x' + '11'.repeat(32),
      vaultAddress: '0x' + '22'.repeat(20),
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 8453,
      pricingGuard,
      executionLock,
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

/**
 * A mock KeeperExecutionLock recording every call (with its planId/index
 * arguments) so a test can assert directly on acquire/persist/release —
 * Task 15 review, Finding 1's "assert on the injected deps" requirement.
 */
function mockExecutionLock() {
  const calls: string[] = [];
  const lock: KeeperExecutionLock = {
    acquireLock: jest.fn<(planId: string) => Promise<boolean>>().mockImplementation(async (planId) => {
      calls.push(`lock:${planId}`);
      return true;
    }),
    persistIntent: jest.fn<(planId: string, index: number) => Promise<void>>().mockImplementation(async (planId, index) => {
      calls.push(`persist:${planId}:${index}`);
    }),
    releaseLock: jest.fn<(planId: string) => Promise<void>>().mockImplementation(async (planId) => {
      calls.push(`unlock:${planId}`);
    }),
  };
  return { lock, calls };
}

/**
 * A mock IPlanExecutor recording calls, for asserting orchestration order.
 *
 * Whole-branch review, Critical 2: an earlier revision of this mock kept a
 * `nextActionIndex` that only ever incremented on a successful
 * executeNextActionWithProof, with a docstring claiming it "mirrors the
 * vault's real plan cursor". It did not: NavyVaultSRCLA.executeNextActionWithProof
 * (contract/src/NavyVaultSRCLA.sol) calls `_clearActivePlan()` when the
 * plan's LAST action completes, which `delete`s BOTH activePlanId and
 * activePlanNextActionIndex — the real on-chain cursor goes back to 0 on
 * completion, it does not keep counting up. Because the old mock always
 * counted up, every "successful plan" test was green over a reconcile
 * implementation that would fail 100% of the time against the real vault.
 *
 * This mock now tracks `planActionCount` (defaulting to 1, matching the
 * single-action `draft()` fixture) and, when the action that completes the
 * plan succeeds, resets `nextActionIndex` to 0 and reports `activePlanId`
 * as cleared (ethers.ZeroHash) — exactly what `_clearActivePlan()` produces
 * — instead of pretending the cursor just keeps advancing.
 */
function mockExecutor(
  overrides: Partial<{
    activePlanId: string;
    configurationDigest: string;
    cancelPlan: () => Promise<ExecutionResult>;
    submitPlan: () => Promise<ExecutionResult>;
    executeNextActionWithProof: (index: number) => Promise<ExecutionResult>;
    getPlanState: () => Promise<{
      activePlanId: string;
      merkleRoot: string;
      nextActionIndex: bigint;
      actionCount: bigint;
      expiresAt: bigint;
    }>;
    /** The plan id this mock reports as "active" until it clears on
     * completion — must match the `planId` field of whatever PlanDraft is
     * passed to executePlanDraft in the test (the `draft()`/`twoActionDraft()`
     * helpers above always use '0x2a'). */
    planId: string;
    /** Total actions in the plan under test, so this mock knows which
     * action index is the FINAL one and should clear the plan rather than
     * merely advance the cursor. Defaults to 1 (draft()'s default
     * actionCount) — pass the real count for any 2+-action draft that
     * relies on this default (unoverridden) getPlanState. */
    planActionCount: number;
  }> = {}
) {
  const calls: string[] = [];
  const totalActions = overrides.planActionCount ?? 1;
  const activePlanIdWhileRunning = overrides.planId ?? '0x2a';
  let nextActionIndex = 0n;
  let planCleared = false;
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
        const result = overrides.executeNextActionWithProof
          ? await overrides.executeNextActionWithProof(action.index)
          : ok(`0xaction${action.index}`);
        if (result.success) {
          if (action.index + 1 >= totalActions) {
            // Mirrors _clearActivePlan(): the cursor resets to 0 and the
            // plan is no longer active, it does NOT advance to actionCount.
            planCleared = true;
            nextActionIndex = 0n;
          } else {
            nextActionIndex = BigInt(action.index) + 1n;
          }
        }
        return result;
      }),
    getConfigurationDigest: jest
      .fn<() => Promise<string>>()
      .mockImplementation(async () => overrides.configurationDigest ?? DEFAULT_CONFIG_DIGEST),
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
    getPlanState: jest
      .fn<() => Promise<{
        activePlanId: string;
        merkleRoot: string;
        nextActionIndex: bigint;
        actionCount: bigint;
        expiresAt: bigint;
      }>>()
      .mockImplementation(async () =>
        overrides.getPlanState
          ? overrides.getPlanState()
          : {
              activePlanId: planCleared ? ethers.ZeroHash : activePlanIdWhileRunning,
              merkleRoot: ethers.ZeroHash,
              nextActionIndex,
              actionCount: planCleared ? 0n : BigInt(totalActions),
              expiresAt: 0n,
            }
      ),
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

    // Task 14 review, Finding 2: submitPlan's require conditions this
    // executor can check without an RPC call.
    it('refuses a draft whose actionCount is zero, distinctly from a mismatch', async () => {
      const d = draft({ actionCount: 0n });
      d.actions = [];
      const r = await keeper().executePlanDraft(d);
      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/actionCount is zero/i);
    });

    it('refuses a draft whose merkleRoot is zero', async () => {
      const d = draft();
      d.merkleRoot = ethers.ZeroHash;
      const r = await keeper().executePlanDraft(d);
      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/merkleRoot/i);
    });

    it('refuses a draft whose createdAt is in the future', async () => {
      const r = await keeper().executePlanDraft(
        draft({ createdAt: NOW + 100_000n, expiresAt: NOW + 200_000n })
      );
      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/createdAt is in the future/i);
    });

    it('refuses a draft whose expiresAt is in the past by wall clock, even when expiresAt > createdAt', async () => {
      // Isolates the live "expiresAt < now" check from the unconditional
      // "expiresAt <= createdAt" check: both createdAt and expiresAt are in
      // the past here, but expiresAt is still after createdAt.
      const r = await keeper().executePlanDraft(
        draft({ createdAt: NOW - 500_000n, expiresAt: NOW - 100_000n })
      );
      expect(r.success).toBe(false);
      expect(r.errors.join(' ')).toMatch(/expiresAt < now/i);
      expect(r.errors.join(' ')).not.toMatch(/expiresAt <= createdAt/i);
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
      const { executor, calls } = mockExecutor({ planActionCount: 2 });
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

/** A 2-action draft, for tests that need to prove a later action was never attempted. */
function twoActionDraft(): PlanDraft {
  const d = draft({ actionCount: 2n });
  d.actions = [
    { ...d.actions[0]!, index: 0 },
    { ...d.actions[0]!, index: 1 },
  ];
  return d;
}

describe('KeeperExecutor.executePlanDraft — §10.3 submission loop wiring (Task 15 review, Finding 1)', () => {
  it('acquires the lock once, persists intent once per action, and releases it once on a successful plan', async () => {
    const { executor } = mockExecutor({ planActionCount: 2 });
    const { lock } = mockExecutionLock();
    const r = await keeper(ALLOWED_GUARD, executor, lock).executePlanDraft(twoActionDraft());

    expect(r.success).toBe(true);
    expect(lock.acquireLock).toHaveBeenCalledTimes(1);
    expect(lock.acquireLock).toHaveBeenCalledWith('0x2a');
    expect(lock.persistIntent).toHaveBeenCalledTimes(2);
    expect(lock.persistIntent).toHaveBeenNthCalledWith(1, '0x2a', 0);
    expect(lock.persistIntent).toHaveBeenNthCalledWith(2, '0x2a', 1);
    expect(lock.releaseLock).toHaveBeenCalledTimes(1);
    expect(lock.releaseLock).toHaveBeenCalledWith('0x2a');
  });

  it('releases the lock and never attempts the second action when a submitted action fails', async () => {
    const { executor, calls } = mockExecutor({
      executeNextActionWithProof: async (index) => (index === 0 ? fail('divest reverted') : ok('0xnever')),
    });
    const { lock } = mockExecutionLock();
    const r = await keeper(ALLOWED_GUARD, executor, lock).executePlanDraft(twoActionDraft());

    expect(r.success).toBe(false);
    // The real proof the plan stopped: action 1's executor call never
    // happened -- not merely that the summary says "failed".
    expect(calls).not.toContain('execute:1');
    expect(lock.persistIntent).toHaveBeenCalledTimes(1);
    expect(lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('releases the lock and never submits any action when verifyChain finds a stale configuration digest', async () => {
    const { executor, calls } = mockExecutor({ configurationDigest: '0x' + 'ff'.repeat(32) });
    const { lock } = mockExecutionLock();
    const r = await keeper(ALLOWED_GUARD, executor, lock).executePlanDraft(twoActionDraft());

    expect(r.success).toBe(false);
    expect(r.errors.join(' ')).toMatch(/configuration digest/i);
    // verifyChain runs before submit for action 0 -- this proves the loop
    // gates submission, not just that the overall result reports failure.
    expect(calls).not.toContain('execute:0');
    expect(lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('releases the lock and never submits any action when simulate finds the plan cursor already past this action', async () => {
    const { executor, calls } = mockExecutor({
      getPlanState: async () => ({
        activePlanId: ethers.ZeroHash,
        merkleRoot: ethers.ZeroHash,
        nextActionIndex: 1n, // action 0 is no longer the pending one
        actionCount: 0n,
        expiresAt: 0n,
      }),
    });
    const { lock } = mockExecutionLock();
    const r = await keeper(ALLOWED_GUARD, executor, lock).executePlanDraft(twoActionDraft());

    expect(r.success).toBe(false);
    expect(r.errors.join(' ')).toMatch(/pending plan state/i);
    expect(calls).not.toContain('execute:0');
    expect(lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('releases the lock, halts the plan, and never attempts the second action when reconcile finds the receipt did not move the chain', async () => {
    // executeNextActionWithProof reports success for action 0, but the very
    // next plan-state read (reconcile's) still shows nextActionIndex 0 --
    // exactly the receipt-vs-chain-state divergence §10.3's reconcile step
    // exists to catch. Isolated from simulate's own (overlapping)
    // pending-state check by call order: the 1st getPlanState call is
    // simulate(0) (must see 0, matching reality), the 2nd is reconcile(0)
    // (pinned to a stale 0, the injected divergence), and any call after
    // that reports the true state (1) -- so if reconcile's stop is the only
    // thing keeping this test red, a version of executePlanDraft that
    // dropped reconcile's check would let action 1 run to completion
    // (simulate(1) and reconcile(1) both see the true, advanced state) and
    // the whole plan would report success.
    let getPlanStateCalls = 0;
    const { executor, calls } = mockExecutor({
      getPlanState: async () => {
        getPlanStateCalls++;
        const nextActionIndex = getPlanStateCalls <= 2 ? 0n : 1n;
        return { activePlanId: ethers.ZeroHash, merkleRoot: ethers.ZeroHash, nextActionIndex, actionCount: 0n, expiresAt: 0n };
      },
    });
    const { lock } = mockExecutionLock();
    const r = await keeper(ALLOWED_GUARD, executor, lock).executePlanDraft(twoActionDraft());

    expect(r.success).toBe(false);
    expect(r.errors.join(' ')).toMatch(/did not advance/i);
    expect(calls).toEqual(['getActivePlanId', 'submitPlan', 'execute:0']);
    expect(calls).not.toContain('execute:1');
    expect(lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('never persists, submits, or calls releaseLock when the lock could not be acquired', async () => {
    const { executor, calls } = mockExecutor();
    const lock: KeeperExecutionLock = {
      acquireLock: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
      persistIntent: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      releaseLock: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const r = await keeper(ALLOWED_GUARD, executor, lock).executePlanDraft(twoActionDraft());

    expect(r.success).toBe(false);
    expect(r.errors.join(' ')).toMatch(/lock/i);
    expect(calls).not.toContain('execute:0');
    // acquireLock returning false is the one case runSubmissionLoop returns
    // before ever entering its try/finally (see submission-loop.spec.ts's
    // own "refuses to start when the lock is held" test) -- there is
    // nothing to release, so releaseLock correctly is NOT called here.
    expect(lock.persistIntent).not.toHaveBeenCalled();
    expect(lock.releaseLock).not.toHaveBeenCalled();
  });
});

describe('KeeperExecutor.executePlanDraft — reconcile vs NavyVaultSRCLA._clearActivePlan() (whole-branch review, Critical 2)', () => {
  it('reports success on a single-action plan whose only (and therefore final) action completes and clears the plan', async () => {
    // Under the OLD reconcile logic (`nextActionIndex <= index` = failure),
    // this exact scenario -- a real, faithfully-modelled completion where
    // the cursor resets to 0 -- would have reported `success: false` with
    // "did not advance past action 0", because 0 <= 0 is true. This is the
    // failure this whole test class catches: reconciliation failing on the
    // last action of every plan, including single-action ones.
    const { executor, calls } = mockExecutor();
    const r = await keeper(ALLOWED_GUARD, executor).executePlanDraft(draft());

    expect(r.success).toBe(true);
    expect(r.errors).toEqual([]);
    expect(calls).toEqual(['getActivePlanId', 'submitPlan', 'execute:0']);
  });

  it('reports success on the second (final) action of a two-action plan once it clears, after correctly requiring advancement on the first', async () => {
    const { executor, calls } = mockExecutor({ planActionCount: 2 });
    const r = await keeper(ALLOWED_GUARD, executor).executePlanDraft(twoActionDraft());

    expect(r.success).toBe(true);
    expect(r.errors).toEqual([]);
    expect(calls).toEqual(['getActivePlanId', 'submitPlan', 'execute:0', 'execute:1']);
  });

  it('reports failure on the final action when the plan never actually clears (still active, cursor unchanged) — proves the fix does not just always pass the last action', async () => {
    const { executor, calls } = mockExecutor({
      // A faithful "the submitted tx did not actually land" state for the
      // final action: still active, cursor never advanced. This must still
      // be a reconcile failure -- the fix only treats "our plan is no
      // longer active" as success, not "this happened to be the last index".
      getPlanState: async () => ({
        activePlanId: '0x2a',
        merkleRoot: ethers.ZeroHash,
        nextActionIndex: 0n,
        actionCount: 1n,
        expiresAt: 0n,
      }),
    });
    const r = await keeper(ALLOWED_GUARD, executor).executePlanDraft(draft());

    expect(r.success).toBe(false);
    expect(r.errors.join(' ')).toMatch(/still the active plan/i);
    expect(calls).toEqual(['getActivePlanId', 'submitPlan', 'execute:0']);
  });
});

describe('KeeperExecutor.executeAction guard scoping (Task 14 review, Finding 4)', () => {
  it('blocks harvest when placeholder prices are in use, without ever calling the executor', async () => {
    const { executor } = mockExecutor();
    const r = await keeper(BLOCKED_GUARD, executor).executeAction({
      action: 'harvest',
      adapter: '0x' + 'aa'.repeat(20),
      amount: 1_000_000n,
      reason: 'test',
    });

    expect(r.success).toBe(false);
    expect(r.errors.join(' ')).toMatch(/execution blocked/i);
    expect(executor.harvest).not.toHaveBeenCalled();
  });

  it('permits harvest when the guard allows it', async () => {
    const { executor } = mockExecutor();
    const r = await keeper(ALLOWED_GUARD, executor).executeAction({
      action: 'harvest',
      adapter: '0x' + 'aa'.repeat(20),
      amount: 1_000_000n,
      reason: 'test',
    });

    expect(r.success).toBe(true);
    expect(executor.harvest).toHaveBeenCalledTimes(1);
  });

  it('does not gate emergency exit on the pricing guard', async () => {
    const { executor } = mockExecutor();
    const r = await keeper(BLOCKED_GUARD, executor).executeAction({
      action: 'emergency',
      adapter: '0x' + 'aa'.repeat(20),
      amount: 0n,
      reason: 'incident',
    });

    expect(r.success).toBe(true);
    expect(executor.emergencyExit).toHaveBeenCalledTimes(1);
  });
});
