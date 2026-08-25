/**
 * Keeper Executor - Bridge between SRCLA Controller and PlanExecutor
 *
 * Implements the PlanExecutor interface expected by SrclaController
 * and wraps the real PlanExecutor with proper Merkle proof handling.
 */

import { ethers } from 'ethers';
import {
  PlanExecutor,
  DEFAULT_EXECUTOR_CONFIG,
  type ExecutorConfig,
  type ExecutionResult,
  ActionKindCode,
} from './executor.js';
import {
  orderActions,
  computeMerkleProofs,
  getOrderedActionsMerkleRoot,
  type OrderedAction,
  type ActionKind,
} from './rebalancer-ordering.js';

/**
 * Action decision from SRCLA controller
 */
export interface KeeperActionDecision {
  action: 'deploy' | 'divest' | 'harvest' | 'hold' | 'emergency';
  adapter: string | null;
  amount: bigint;
  reason: string;
}

/**
 * Execution result compatible with SrclaController
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
  /** Plan expiry in minutes */
  planExpiryMinutes?: number;
  /** Policy version */
  policyVersion?: bigint;
}

/**
 * KeeperExecutor - executes SRCLA decisions on-chain
 */
export class KeeperExecutor {
  private wallet: ethers.Wallet;
  private executor: PlanExecutor;
  private config: ExecutorConfig;
  private vaultAddress: string;
  private planExpiryMinutes: number;
  private policyVersion: bigint;

  constructor(config: KeeperExecutorConfig) {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.keeperPrivateKey, provider);
    this.vaultAddress = config.vaultAddress;
    this.planExpiryMinutes = config.planExpiryMinutes ?? 30;
    this.policyVersion = config.policyVersion ?? 1n;

    // Merge executor config
    this.config = {
      ...DEFAULT_EXECUTOR_CONFIG,
      ...config.executorConfig,
    };

    this.executor = new PlanExecutor(this.wallet, this.vaultAddress, this.config);
  }

  /**
   * Execute a single action decision
   * For simple decisions (no Merkle proof needed)
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
        // For harvest, use the direct harvest function
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

      // Deploy/Divest require a plan with Merkle proof
      // Build a single-action plan
      const result = await this.executeSingleActionPlan(
        kind,
        decision.adapter,
        decision.amount
      );

      return result;
    } catch (error) {
      return {
        success: false,
        txHashes: [],
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  /**
   * Execute a plan with multiple ordered actions
   */
  async executePlan(
    decisionHash: string,
    actions: Array<{
      action: 'deploy' | 'divest' | 'harvest' | 'emergency';
      adapter: string;
      amount: bigint;
    }>,
    snapshotBlockNumber: number,
    reserve: bigint
  ): Promise<KeeperExecutionResult> {
    if (actions.length === 0) {
      return { success: true, txHashes: [], errors: [] };
    }

    try {
      // Order actions according to SRCLA rules
      const orderedInput = actions.map((a) => ({
        kind: a.action as ActionKind,
        adapter: a.adapter,
        amountBase: a.amount,
      }));

      const orderedActions = orderActions(orderedInput);

      // Compute Merkle proofs
      const actionsWithProofs = computeMerkleProofs(orderedActions);

      // Get Merkle root
      const merkleRoot = getOrderedActionsMerkleRoot(actionsWithProofs);

      // Build plan header
      const now = Math.floor(Date.now() / 1000);
      const planId = BigInt(this.generatePlanId(decisionHash));
      const header = {
        planId,
        policyVersion: this.policyVersion,
        createdAt: BigInt(now),
        expiresAt: BigInt(now + this.planExpiryMinutes * 60),
        actionCount: BigInt(orderedActions.length),
        snapshotBlockNumber: BigInt(snapshotBlockNumber),
        snapshotHash: ethers.ZeroHash, // Would be computed from snapshot
        decisionHash,
        configurationDigest: ethers.ZeroHash, // Would be computed from current config
        reserve,
        minFinalAssets: 0n,
        maxRecognizedLoss: 0n,
        turnoverLimit: 0n,
      };

      // Submit plan
      const submitResult = await this.executor.submitPlan(header, merkleRoot);

      if (!submitResult.success) {
        return {
          success: false,
          txHashes: [],
          errors: [`Plan submission failed: ${submitResult.error}`],
        };
      }

      // Execute actions in order
      const txHashes: string[] = [];
      const errors: string[] = [];

      for (const action of actionsWithProofs) {
        const actionKind = this.actionToKind(action.kind);

        // Skip harvest in plan execution (use direct harvest instead)
        if (actionKind === ActionKindCode.HARVEST) {
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
          const result = await this.executor.harvest(
            action.adapter,
            ethers.ZeroAddress,
            action.amountBase,
            ethers.ZeroHash,
            0n,
            deadline
          );

          if (result.success && result.txHash) {
            txHashes.push(result.txHash);
          } else if (result.error) {
            errors.push(`Harvest ${action.adapter}: ${result.error}`);
          }
          continue;
        }

        // Execute deploy/divest with Merkle proof
        const result = await this.executor.executeAction(
          header.planId,
          action.executionIndex,
          actionKind,
          action.adapter,
          action.amountBase,
          0n,
          ethers.ZeroHash,
          action.merkleProof ?? []
        );

        if (result.success && result.txHash) {
          txHashes.push(result.txHash);
        } else {
          errors.push(`${action.kind} ${action.adapter}: ${result.error ?? 'Unknown error'}`);

          // Stop on divest failure (per §9.5)
          if (actionKind === ActionKindCode.DIVEST) {
            break;
          }
        }
      }

      return {
        success: errors.length === 0,
        txHashes,
        errors,
        planId: `0x${header.planId.toString(16)}`,
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
   * Execute a single action plan (deploy or divest)
   */
  private async executeSingleActionPlan(
    kind: number,
    adapter: string,
    amount: bigint
  ): Promise<KeeperExecutionResult> {
    const decisionHash = this.generatePlanId(`single-${Date.now()}`);

    // For single actions, we still need to submit a plan
    const now = Math.floor(Date.now() / 1000);
    const planId = BigInt(decisionHash);
    const header = {
      planId,
      policyVersion: this.policyVersion,
      createdAt: BigInt(now),
      expiresAt: BigInt(now + this.planExpiryMinutes * 60),
      actionCount: 1n,
      snapshotBlockNumber: 0n,
      snapshotHash: ethers.ZeroHash,
      decisionHash,
      configurationDigest: ethers.ZeroHash,
      reserve: 0n,
      minFinalAssets: 0n,
      maxRecognizedLoss: 0n,
      turnoverLimit: 0n,
    };

    // Build single-action Merkle tree
    const action: OrderedAction = {
      originalIndex: 0,
      executionIndex: 0,
      kind: this.kindToAction(kind),
      adapter,
      amountBase: amount,
    };

    const merkleRoot = getOrderedActionsMerkleRoot([action]);

    // Submit plan
    const submitResult = await this.executor.submitPlan(header, merkleRoot);

    if (!submitResult.success) {
      return {
        success: false,
        txHashes: [],
        errors: [`Plan submission failed: ${submitResult.error}`],
      };
    }

    // Execute action
    const result = await this.executor.executeAction(
      header.planId,
      0,
      kind,
      adapter,
      amount,
      0n,
      ethers.ZeroHash,
      [] // Single action has empty proof
    );

    return {
      success: result.success,
      txHashes: result.txHash ? [result.txHash] : [],
      errors: result.error ? [result.error] : [],
      planId: `0x${header.planId.toString(16)}`,
    };
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

  /**
   * Convert ActionKindCode to action string
   */
  private kindToAction(kind: number): ActionKind {
    switch (kind) {
      case ActionKindCode.DEPLOY: return 'deploy';
      case ActionKindCode.DIVEST: return 'divest';
      case ActionKindCode.HARVEST: return 'harvest';
      case ActionKindCode.EMERGENCY: return 'emergency';
      default: return 'deploy';
    }
  }

  /**
   * Generate deterministic plan ID from decision hash
   */
  private generatePlanId(seed: string): string {
    const hash = ethers.keccak256(ethers.toUtf8Bytes(seed));
    return hash;
  }
}

/**
 * Create KeeperExecutor from environment
 */
export function createKeeperExecutor(): KeeperExecutor {
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
  });
}
