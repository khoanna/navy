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
 */

import { ethers } from 'ethers';
import {
  PlanExecutor,
  DEFAULT_EXECUTOR_CONFIG,
  ActionKindCode,
  type ExecutorConfig,
  type ExecutionResult,
  type IPlanExecutor,
} from './executor.js';
import type { PlanDraft } from '../policy/types.js';
import { assertExecutionAllowed, type PricingGuardStatus } from '../runtime/decision-driver.js';

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

    const errors: string[] = [];
    const ZERO = ethers.ZeroHash;

    if (draft.header.snapshotHash === ZERO) {
      errors.push('header.snapshotHash is zero; submitPlan would revert InvalidPlan');
    }
    if (draft.header.decisionHash === ZERO) {
      errors.push('header.decisionHash is zero; submitPlan would revert InvalidPlan');
    }
    if (draft.header.planId === 0n) {
      errors.push('header.planId is zero; submitPlan would revert InvalidPlan');
    }
    if (draft.header.actionCount !== BigInt(draft.actions.length)) {
      errors.push(`header.actionCount ${draft.header.actionCount} != ${draft.actions.length} actions`);
    }
    if (draft.header.expiresAt <= draft.header.createdAt) {
      errors.push('plan already expired: expiresAt <= createdAt');
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
    for (const a of draft.actions) {
      const r = await this.executor.executeNextActionWithProof(a.proof, {
        planId: draft.header.planId,
        index: a.index,
        kind: a.kind,
        adapter: a.adapter,
        amount: a.amountBase,
        minOut: a.minOutBase,
        dataHash: a.dataHash,
      });
      if (r.txHash) txHashes.push(r.txHash);
      if (!r.success) {
        // §9.5 — a failed action (divest in particular) stops the plan.
        return {
          success: false,
          txHashes,
          errors: [`action ${a.index} (kind=${a.kind}) failed: ${r.error}`],
          planId: draft.planId,
        };
      }
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
   * Deliberately NOT gated by assertExecutionAllowed: the pricing guard
   * protects a plan priced by the decide() cost gate against fabricated
   * ETH/gas inputs. Harvest and emergency exit are not decide()-produced
   * plans — in particular, gating emergency exit on the pricing guard would
   * be actively unsafe (it must remain available to pull funds out during an
   * incident regardless of oracle placeholder status).
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
 */
export function createKeeperExecutor(pricingGuard: PricingGuardStatus): KeeperExecutor {
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
  });
}
