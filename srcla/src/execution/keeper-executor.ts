/**
 * Keeper Executor - Bridge between the SRCLA decision kernel and PlanExecutor
 *
 * Wraps the real PlanExecutor with proper Merkle proof handling. Task 13
 * wired the scheduler to call decide() (src/policy/decide.ts) via
 * DecisionDriver (src/runtime/decision-driver.ts); Task 14 adds
 * executePlanDraft, the PlanDraft-shaped, domain-bound execution entry point
 * that consumes a decision's plan directly via
 * `PlanExecutor.executeNextActionWithProof` — NOT the weaker `executeAction`
 * path, which skips the configuration-digest recheck, plan risk limits,
 * turnover accounting, plan completion and dynamic-reserve activation.
 *
 * Every plan header field (snapshotHash, decisionHash, reserve,
 * minFinalAssets, maxRecognizedLoss, turnoverLimit) comes from the
 * PlanDraft produced by src/policy/steps/plan.ts's buildPlan — never
 * hardcoded here. The previous implementation of this file hardcoded
 * snapshotHash to ethers.ZeroHash and reserve/minFinalAssets/
 * maxRecognizedLoss/turnoverLimit to zero, which NavyVaultSRCLA.submitPlan
 * rejects with InvalidPlan — so no plan built by the old code path could
 * ever have executed.
 *
 * Task 15 review, Finding 1: the per-action loop inside executePlanDraft
 * now delegates to runSubmissionLoop (src/execution/submission-loop.ts),
 * §10.3's disciplined submit-one/reconcile/advance-or-stop orchestration.
 * Only that loop moved — submitPlan, the stale-plan cancel and the
 * structural preflight all stay exactly where they were. The chain-facing
 * SubmissionDeps (verifyChain, simulate, submit, reconcile) are built here
 * from IPlanExecutor methods that already existed (getConfigurationDigest,
 * getPlanState, executeNextActionWithProof) — no new chain surface was
 * added, and every one of them still goes through the same injectable
 * `executor` field the existing tests already mock, so nothing here can
 * reach a real network from a unit test. acquireLock/persistIntent/
 * releaseLock have no such existing home — this package has no database —
 * so they are a REQUIRED constructor dependency (KeeperExecutionLock,
 * below), never defaulted to a no-op that would look like protection
 * without providing any.
 */

import { ethers } from 'ethers';
import {
  PlanExecutor,
  DEFAULT_EXECUTOR_CONFIG,
  ActionKindCode,
  type ExecutorConfig,
  type ExecutionResult,
  type IPlanExecutor,
  type PlanActionInput,
} from './executor.js';
import type { PlanDraft } from '../policy/types.js';
import { assertExecutionAllowed, type PricingGuardStatus } from '../runtime/decision-driver.js';
import { runSubmissionLoop, type SubmissionDeps } from './submission-loop.js';

/**
 * Action decision from SRCLA controller (legacy ad-hoc shape, still used by
 * the harvest/emergency branches of executeAction — deploy/divest now
 * require a full PlanDraft, see executePlanDraft).
 */
export interface KeeperActionDecision {
  action: 'deploy' | 'divest' | 'harvest' | 'hold' | 'emergency';
  adapter: string | null;
  amount: bigint;
  reason: string;
}

/**
 * Result of executing a KeeperActionDecision or a PlanDraft.
 */
export interface KeeperExecutionResult {
  success: boolean;
  txHashes: string[];
  errors: string[];
  planId?: string;
}

/**
 * §10.3's durable execution lock: one active executor, and intent persisted
 * before signing. This package has no database, so these three operations
 * cannot be implemented here — they are the caller's durable storage,
 * supplied as a REQUIRED KeeperExecutorConfig field (see
 * KeeperExecutorConfig.executionLock) rather than defaulted to a no-op. A
 * silent no-op lock is worse than no lock at all: it looks like protection
 * while providing none.
 */
export interface KeeperExecutionLock {
  acquireLock: (planId: string) => Promise<boolean>;
  persistIntent: (planId: string, index: number) => Promise<void>;
  releaseLock: (planId: string) => Promise<void>;
}

/**
 * A deliberately non-functional KeeperExecutionLock: every method rejects
 * with an explicit, actionable error instead of silently succeeding.
 * KeeperExecutorConfig.executionLock is required precisely so no caller can
 * construct a KeeperExecutor without consciously deciding what to pass —
 * this export exists only for a caller that has not yet wired a real
 * durable lock (e.g. because live keeper execution is disabled) to satisfy
 * that requirement without hand-rolling the same "fail loudly" stub. It
 * must NEVER be wired into a path that actually calls executePlanDraft
 * against a real chain: acquiring it will throw, not silently succeed, so
 * doing so simply prevents execution rather than running it unprotected.
 * Do NOT replace this with a Prisma-backed implementation here — that is a
 * caller decision (a database is not a dependency of this package).
 */
export const UNCONFIGURED_EXECUTION_LOCK: KeeperExecutionLock = {
  acquireLock: async () => {
    throw new Error(
      'KeeperExecutor.executionLock is not configured: a durable acquireLock implementation ' +
        'must be supplied before executePlanDraft can run (see KeeperExecutorConfig.executionLock).'
    );
  },
  persistIntent: async () => {
    throw new Error(
      'KeeperExecutor.executionLock is not configured: a durable persistIntent implementation ' +
        'must be supplied before executePlanDraft can run (see KeeperExecutorConfig.executionLock).'
    );
  },
  releaseLock: async () => {
    throw new Error(
      'KeeperExecutor.executionLock is not configured: a durable releaseLock implementation ' +
        'must be supplied before executePlanDraft can run (see KeeperExecutorConfig.executionLock).'
    );
  },
};

/**
 * Keeper executor configuration
 */
export interface KeeperExecutorConfig {
  /** Keeper wallet private key */
  keeperPrivateKey: string;
  /** Vault address */
  vaultAddress: string;
  /** RPC URL */
  rpcUrl: string;
  /** Chain ID */
  chainId: number;
  /** Executor config overrides */
  executorConfig?: Partial<ExecutorConfig>;
  /**
   * Task 13 Finding 1 / Task 14 hard requirement: the sanctioned execution
   * gate's input. executePlanDraft calls assertExecutionAllowed(this
   * .pricingGuard) as its very first statement — before any preflight check
   * and before any RPC call — so constructing a KeeperExecutor with a
   * blocked guard makes executePlanDraft refuse to submit anything,
   * regardless of who calls it or what Scheduler itself already checked.
   */
  pricingGuard: PricingGuardStatus;
  /**
   * Task 15 review, Finding 1: required, not defaulted. See
   * KeeperExecutionLock — this package has no database, so the caller must
   * consciously supply acquireLock/persistIntent/releaseLock (or the
   * exported UNCONFIGURED_EXECUTION_LOCK sentinel, which fails loudly
   * rather than no-op'ing, when live execution is not yet enabled).
   */
  executionLock: KeeperExecutionLock;
}

/**
 * KeeperExecutor - executes SRCLA decisions on-chain
 */
export class KeeperExecutor {
  private wallet: ethers.Wallet;
  private executor: IPlanExecutor;
  private config: ExecutorConfig;
  private vaultAddress: string;
  private pricingGuard: PricingGuardStatus;
  private executionLock: KeeperExecutionLock;

  /**
   * @param executorOverride Test-only injection point for a mocked
   *   IPlanExecutor, so executePlanDraft's submit/cancel/execute-loop
   *   orchestration can be exercised without any RPC connection. Production
   *   callers (createKeeperExecutor) never pass this.
   */
  constructor(config: KeeperExecutorConfig, executorOverride?: IPlanExecutor) {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.keeperPrivateKey, provider);
    this.vaultAddress = config.vaultAddress;
    this.pricingGuard = config.pricingGuard;
    this.executionLock = config.executionLock;

    // Merge executor config
    this.config = {
      ...DEFAULT_EXECUTOR_CONFIG,
      ...config.executorConfig,
    };

    this.executor = executorOverride ?? new PlanExecutor(this.wallet, this.vaultAddress, this.config);
  }

  /**
   * Submit and execute a plan produced by the decision kernel
   * (src/policy/decide.ts via src/policy/steps/plan.ts's buildPlan).
   *
   * Order of operations:
   *  1. assertExecutionAllowed — the sanctioned execution gate. First
   *     statement, unconditionally, before any other check or RPC call.
   *  2. Structural preflight on the draft itself (no RPC): every field the
   *     vault's submitPlan/executeNextActionWithProof would revert on is
   *     checked here first, so a malformed draft never reaches the network.
   *  3. Cancel a wedged active plan, if any — a stale activePlanId blocks
   *     every later submitPlan with no on-chain recovery otherwise.
   *  4. submitPlan, then executeNextActionWithProof for each action in
   *     order. §9.5: the first failed action stops the plan — since
   *     buildPlan orders divests before deploys, this also guarantees the
   *     vault is never asked to deploy funds a failed divestment did not
   *     actually recover.
   */
  async executePlanDraft(draft: PlanDraft): Promise<KeeperExecutionResult> {
    // Sanctioned execution gate (Task 13 Finding 1; Task 14 hard
    // requirement). MUST stay the first statement in this method — this is
    // the one method that submits a plan-shaped transaction, so gating it
    // here makes the guard a structural chokepoint: no caller (Scheduler or
    // otherwise) can reach submitPlan/executeNextActionWithProof through
    // this class without passing it, even if a caller forgets to check the
    // guard itself first. Do not remove, reorder after a preflight/RPC
    // call, or duplicate with different logic elsewhere.
    assertExecutionAllowed(this.pricingGuard);

    // Mirrors NavyVaultSRCLA.submitPlan's own require conditions
    // (contract/src/NavyVaultSRCLA.sol ~line 627) as closely as possible
    // without an RPC call, so a malformed draft fails here instead of
    // costing a wasted transaction and an opaque on-chain revert:
    //
    //   if (usedPlanIds[planId]) revert PlanAlreadyUsed();                    <- needs chain state, not checked here
    //   if (activePlanId != 0) revert PlanAlreadyActive();                    <- handled below (cancel-stale-plan)
    //   if (header.expiresAt < block.timestamp) revert PlanExecutionExpired();
    //   if (planId == 0 || actionCount == 0 || merkleRoot == 0
    //       || decisionHash == 0 || snapshotHash == 0
    //       || createdAt > block.timestamp || expiresAt <= createdAt
    //       || snapshotBlockNumber > block.number) revert InvalidPlan();      <- snapshotBlockNumber needs chain state, not checked here
    //   if (configurationDigest != currentConfigurationDigest())
    //       revert InvalidConfigurationDigest();                             <- needs chain state, not checked here
    //
    // `snapshotBlockNumber > block.number` and the configuration-digest
    // match both require live chain state (current block number,
    // currentConfigurationDigest()) that this method deliberately does not
    // fetch — see the "Preflight validation must happen BEFORE any RPC
    // call" requirement. Those two belong to a pre-submission simulation
    // step (an explicit eth_call dry run against the vault) rather than a
    // silent RPC bolted onto this preflight; not implemented here.
    const errors: string[] = [];
    const ZERO = ethers.ZeroHash;
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));

    if (draft.header.snapshotHash === ZERO) {
      errors.push('header.snapshotHash is zero; submitPlan would revert InvalidPlan');
    }
    if (draft.header.decisionHash === ZERO) {
      errors.push('header.decisionHash is zero; submitPlan would revert InvalidPlan');
    }
    if (draft.header.planId === 0n) {
      errors.push('header.planId is zero; submitPlan would revert InvalidPlan');
    }
    if (draft.header.actionCount === 0n) {
      errors.push('header.actionCount is zero; submitPlan would revert InvalidPlan');
    }
    if (draft.header.actionCount !== BigInt(draft.actions.length)) {
      errors.push(`header.actionCount ${draft.header.actionCount} != ${draft.actions.length} actions`);
    }
    if (draft.merkleRoot === ZERO) {
      errors.push('merkleRoot is zero; submitPlan would revert InvalidPlan');
    }
    if (draft.header.expiresAt <= draft.header.createdAt) {
      errors.push('plan already expired: expiresAt <= createdAt');
    }
    if (draft.header.createdAt > nowSeconds) {
      errors.push('header.createdAt is in the future; submitPlan would revert InvalidPlan (createdAt > block.timestamp)');
    }
    if (draft.header.expiresAt < nowSeconds) {
      errors.push('plan already expired: header.expiresAt < now; submitPlan would revert PlanExecutionExpired');
    }
    if (errors.length > 0) {
      return { success: false, txHashes: [], errors };
    }

    // A wedged active plan blocks every later submitPlan; clear it first.
    const active = await this.executor.getActivePlanId();
    if (active !== ZERO) {
      const cancelled = await this.executor.cancelPlan();
      if (!cancelled.success) {
        return {
          success: false,
          txHashes: [],
          errors: [`stale plan ${active} could not be cancelled: ${cancelled.error}`],
        };
      }
    }

    const submit = await this.executor.submitPlan(draft.header, draft.merkleRoot);
    if (!submit.success) {
      return { success: false, txHashes: [], errors: [`submitPlan failed: ${submit.error}`] };
    }

    const txHashes: string[] = submit.txHash ? [submit.txHash] : [];

    const toActionInput = (a: PlanDraft['actions'][number]): PlanActionInput => ({
      planId: draft.header.planId,
      index: a.index,
      kind: a.kind,
      adapter: a.adapter,
      amount: a.amountBase,
      minOut: a.minOutBase,
      dataHash: a.dataHash,
    });

    // §10.3 — the per-action submission discipline (Task 15 review, Finding
    // 1): lock, persist intent before signing, verify chain/configuration,
    // simulate against pending state, submit exactly one action, reconcile,
    // then advance or stop. runSubmissionLoop (submission-loop.ts) is the
    // pure orchestration; every effect below is wired to a method this class
    // already had, through the same injectable `executor` the tests mock —
    // nothing here opens a new network path.
    const deps: SubmissionDeps = {
      acquireLock: this.executionLock.acquireLock,
      persistIntent: this.executionLock.persistIntent,
      releaseLock: this.executionLock.releaseLock,

      // "verifies... live configuration[...] chain identity" (§10.3.3): a
      // real read of the vault's current configuration digest. An
      // unreachable chain/contract surfaces as a thrown error here (caught
      // below); a configuration that changed since this plan was decided
      // surfaces as a digest mismatch. Both stop the plan before any
      // signature is produced.
      verifyChain: async () => {
        try {
          const digest = await this.executor.getConfigurationDigest();
          if (digest !== draft.header.configurationDigest) {
            return {
              ok: false,
              error: `configuration digest changed since decision: on-chain ${digest} != plan ${draft.header.configurationDigest}`,
            };
          }
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            error: `chain/configuration read failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          };
        }
      },

      // "simulates the next action against pending state" (§10.3.4): a real
      // re-read of the vault's live plan cursor. If this action is no
      // longer the next one pending on-chain — a prior partial run, a
      // racing executor, or an already-advanced plan — this fails before
      // signing rather than after a wasted (or worse, wrongly-ordered) tx.
      simulate: async (_planId, index) => {
        try {
          const state = await this.executor.getPlanState();
          if (state.nextActionIndex !== BigInt(index)) {
            return {
              ok: false,
              error: `pending plan state has nextActionIndex ${state.nextActionIndex}, expected ${index}`,
            };
          }
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            error: `pending-state read failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          };
        }
      },

      // Exactly one action submitted per iteration — no batching. This is
      // the only fund-moving call in the loop.
      submit: async (_planId, index) => {
        const action = draft.actions[index];
        if (!action) return { ok: false, error: `no action at index ${index} in this plan` };
        const r = await this.executor.executeNextActionWithProof(action.proof, toActionInput(action));
        if (r.txHash) txHashes.push(r.txHash);
        if (!r.success) return { ok: false, error: r.error ?? `action ${index} failed` };
        return { ok: true, txHash: r.txHash ?? '' };
      },

      // "reconciles receipt, events, and balance deltas... re-reads all
      // affected chain state" (§10.3.6-7): confirms the vault's plan cursor
      // actually advanced past this action. A receipt that claimed success
      // with no matching on-chain state change is exactly the divergence
      // this step exists to catch — per the design brief, a divergence here
      // is as fatal as a failed submission and halts the remaining plan.
      reconcile: async (_planId, index) => {
        try {
          const state = await this.executor.getPlanState();
          if (state.nextActionIndex <= BigInt(index)) {
            return {
              ok: false,
              error: `plan state did not advance past action ${index}: nextActionIndex is still ${state.nextActionIndex}`,
            };
          }
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            error: `reconciliation read failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          };
        }
      },
    };

    const loop = await runSubmissionLoop(draft, deps);
    if (loop.errors.length > 0) {
      // §9.5 — a failed or divergent action (a failed divest in particular)
      // stops the plan; later actions were never submitted (see
      // runSubmissionLoop).
      return { success: false, txHashes, errors: loop.errors, planId: draft.planId };
    }

    return { success: true, txHashes, errors: [], planId: draft.planId };
  }

  /**
   * Execute a single ad-hoc action decision. Harvest and emergency exit are
   * standalone vault functions that do not go through the plan/Merkle
   * mechanism, so they remain available here. Deploy/divest are NOT — the
   * single-action plan path that used to build them (executeSingleActionPlan)
   * hardcoded snapshotHash to ZeroHash and used the old domain-less action
   * leaf, exactly the two defects this task fixes; callers must go through
   * executePlanDraft with a real PlanDraft (src/policy/steps/plan.ts's
   * buildPlan) instead.
   *
   * Guard scoping (Task 14 review, Finding 4): harvest IS gated by
   * assertExecutionAllowed — a harvest performs a swap whose minOut and
   * route economics are exactly the price-dependent risk the guard exists
   * for, the same class of risk executePlanDraft is gated against.
   * emergencyExit deliberately is NOT gated: it is an admin incident lever
   * with no price-dependent economics, and it must remain available to pull
   * funds out during an incident regardless of oracle-placeholder status —
   * gating it on the pricing guard would be actively unsafe. This method has
   * no live caller today (Scheduler only calls executePlanDraft), but keep
   * this scoping if a caller is ever wired up rather than reverting it.
   */
  async executeAction(decision: KeeperActionDecision): Promise<KeeperExecutionResult> {
    if (decision.action === 'hold') {
      return { success: true, txHashes: [], errors: [] };
    }

    if (!decision.adapter) {
      return { success: false, txHashes: [], errors: ['No adapter specified'] };
    }

    try {
      const kind = this.actionToKind(decision.action);

      if (kind === ActionKindCode.HARVEST) {
        // Finding 4: a harvest's minOut/route economics are exactly the
        // price-dependent risk the guard exists for -- gate it, same as
        // executePlanDraft. Thrown ExecutionBlockedError is caught by this
        // method's own catch below and returned as a normal failure result.
        assertExecutionAllowed(this.pricingGuard);

        // deadline = now + 1 hour
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const result = await this.executor.harvest(
          decision.adapter,
          ethers.ZeroAddress, // USDC
          decision.amount,
          ethers.ZeroHash, // routeId
          0n, // minOut
          deadline
        );

        return {
          success: result.success,
          txHashes: result.txHash ? [result.txHash] : [],
          errors: result.error ? [result.error] : [],
        };
      }

      if (kind === ActionKindCode.EMERGENCY) {
        const result = await this.executor.emergencyExit(decision.adapter);
        return {
          success: result.success,
          txHashes: result.txHash ? [result.txHash] : [],
          errors: result.error ? [result.error] : [],
        };
      }

      // Deploy/Divest require a staged PlanDraft — see executePlanDraft.
      return {
        success: false,
        txHashes: [],
        errors: [
          `deploy/divest via executeAction is no longer supported (it built a plan with a zero ` +
            `snapshotHash and the old domain-less action leaf, which submitPlan rejects); call ` +
            `executePlanDraft with a PlanDraft from src/policy/steps/plan.ts's buildPlan instead`,
        ],
      };
    } catch (error) {
      return {
        success: false,
        txHashes: [],
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  /**
   * Check if keeper has ALLOCATOR_ROLE
   */
  async hasAllocatorRole(): Promise<boolean> {
    return this.executor.hasAllocatorRole(this.wallet.address);
  }

  /**
   * Check if keeper has ADMIN_ROLE
   */
  async hasAdminRole(): Promise<boolean> {
    return this.executor.hasAdminRole(this.wallet.address);
  }

  /**
   * Get keeper address
   */
  getAddress(): string {
    return this.wallet.address;
  }

  /**
   * Cancel active plan
   */
  async cancelPlan(): Promise<ExecutionResult> {
    return this.executor.cancelPlan();
  }

  /**
   * Get current plan state
   */
  async getPlanState(): Promise<{
    activePlanId: string;
    merkleRoot: string;
    nextActionIndex: bigint;
    actionCount: bigint;
    expiresAt: bigint;
  }> {
    return this.executor.getPlanState();
  }

  /**
   * Convert action string to ActionKindCode
   */
  private actionToKind(action: string): number {
    switch (action) {
      case 'deploy': return ActionKindCode.DEPLOY;
      case 'divest': return ActionKindCode.DIVEST;
      case 'harvest': return ActionKindCode.HARVEST;
      case 'emergency': return ActionKindCode.EMERGENCY;
      default: return ActionKindCode.DEPLOY;
    }
  }
}

/**
 * Create KeeperExecutor from environment.
 * @param pricingGuard Task 13 Finding 1 / Task 14 hard requirement — see
 *   KeeperExecutorConfig.pricingGuard. Threaded through from the caller
 *   (Scheduler already carries this in its own SchedulerConfig) rather than
 *   re-derived here, so there is exactly one place `placeholderPricesInUse`
 *   is computed (config.ts's computePlaceholderPriceStatus).
 * @param executionLock Task 15 review, Finding 1 / KeeperExecutorConfig
 *   .executionLock — required, not defaulted, for the same reason as
 *   pricingGuard: exactly one place decides what durable lock/persist/
 *   release backs execution, and every caller must consciously supply it
 *   (UNCONFIGURED_EXECUTION_LOCK if none is wired yet).
 */
export function createKeeperExecutor(
  pricingGuard: PricingGuardStatus,
  executionLock: KeeperExecutionLock
): KeeperExecutor {
  const privateKey = process.env.KEEPER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('KEEPER_PRIVATE_KEY not configured');
  }

  const vaultAddress = process.env.VAULT_ADDRESS;
  if (!vaultAddress) {
    throw new Error('VAULT_ADDRESS not configured');
  }

  const rpcUrl = process.env.BASE_RPC_URL;
  if (!rpcUrl) {
    throw new Error('BASE_RPC_URL not configured');
  }

  const chainId = parseInt(process.env.CHAIN_ID ?? '8453', 10);

  return new KeeperExecutor({
    keeperPrivateKey: privateKey,
    vaultAddress,
    rpcUrl,
    chainId,
    pricingGuard,
    executionLock,
  });
}
