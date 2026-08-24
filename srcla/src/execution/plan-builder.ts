import { createHash } from 'crypto';
import { ethers } from 'ethers';

/**
 * Action kinds mapped to numeric codes
 */
export enum ActionKindCode {
  DEPLOY = 0,
  DIVEST = 1,
  HARVEST = 2,
  EMERGENCY = 3,
}

/**
 * Plan action with encoded data for on-chain submission
 */
export interface PlanAction {
  /** Action kind: 0=deploy, 1=divest, 2=harvest, 3=emergency */
  kind: 0 | 1 | 2 | 3;
  /** Target adapter address */
  adapter: string;
  /** Amount in base units (6 decimals for USDC) */
  amountBase: bigint;
  /** Merkle root for batch execution proof */
  merkleRoot: string;
}

/**
 * Execution plan with staged actions
 * Matches NavyVaultSRCLA.PlanHeader exactly
 */
export interface ExecutionPlan {
  /** Unique plan identifier (SHA-256 hash) */
  planId: string;
  /** Hash of the decision that generated this plan */
  decisionHash: string;
  /** Plan expiry timestamp */
  expiresAt: Date;
  /** Ordered list of actions to execute */
  actions: PlanAction[];
  /** On-chain configuration digest at plan creation time */
  configurationDigest?: string;
  /** Hash of action data for verification */
  actionDataHash?: string;
  /** Deadline for harvest execution */
  harvestDeadline?: Date;
  /** Dynamic reserve at plan creation */
  dynamicReserve?: bigint;
  /** Policy version (must match contract's expected version) */
  policyVersion?: bigint;
  /** Creation timestamp */
  createdAt?: Date;
  /** Snapshot block number for plan */
  snapshotBlockNumber?: bigint;
  /** Minimum final assets after plan execution */
  minFinalAssets?: bigint;
  /** Maximum recognized loss during plan execution */
  maxRecognizedLoss?: bigint;
  /** Turnover limit for plan execution */
  turnoverLimit?: bigint;
}

/**
 * Encoded plan for on-chain submission
 * Matches VaultTypes.PlanHeader exactly
 */
export interface EncodedPlan {
  planId: string;
  decisionHash: string;
  expiresAt: bigint;
  actions: Array<{
    kind: number;
    adapter: string;
    amountBase: bigint;
    merkleRoot: string;
  }>;
  /** Plan header fields for on-chain submission */
  policyVersion: bigint;
  createdAt: bigint;
  snapshotBlockNumber: bigint;
  /** Configuration digest for on-chain verification */
  configurationDigest?: string;
  /** Hash of action data for verification */
  actionDataHash?: string;
  /** Deadline for harvest execution */
  harvestDeadline?: bigint;
  /** Dynamic reserve at plan creation */
  dynamicReserve?: bigint;
  minFinalAssets?: bigint;
  maxRecognizedLoss?: bigint;
  turnoverLimit?: bigint;
}

/**
 * Builds staged execution plans from ActionDecision
 */
export class PlanBuilder {
  /**
   * Build execution plan from decision
   * @param params.planId Optional plan ID (generated if not provided)
   * @param params.decisionHash Hash of the decision inputs
   * @param params.actions Actions to include in the plan
   * @param params.expiryMinutes Plan expiry in minutes (default: 30)
   * @param params.configurationDigest On-chain configuration digest
   * @param params.actionDataHash Hash of action data
   * @param params.harvestDeadline Deadline for harvest execution
   * @param params.dynamicReserve Dynamic reserve at plan creation
   */
  static build(params: {
    planId?: string;
    decisionHash: string;
    actions: Array<{
      kind: 'deploy' | 'divest' | 'harvest' | 'emergency';
      adapter: string;
      amount: bigint;
    }>;
    expiryMinutes?: number;
    configurationDigest?: string;
    actionDataHash?: string;
    harvestDeadline?: Date;
    dynamicReserve?: bigint;
    policyVersion?: bigint;
    snapshotBlockNumber?: bigint;
    minFinalAssets?: bigint;
    maxRecognizedLoss?: bigint;
    turnoverLimit?: bigint;
  }): ExecutionPlan {
    // Generate deterministic planId from decision hash + timestamp
    const timestamp = Date.now();
    const planId = params.planId ?? createHash('sha256')
      .update(`${params.decisionHash}-${timestamp}`)
      .digest('hex');

    const actions: PlanAction[] = params.actions.map((action) => ({
      kind: action.kind === 'deploy' ? 0
        : action.kind === 'divest' ? 1
        : action.kind === 'harvest' ? 2
        : 3,
      adapter: action.adapter,
      amountBase: action.amount,
      merkleRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
    }));

    const expiresAt = new Date(
      Date.now() + (params.expiryMinutes ?? 30) * 60 * 1000
    );

    const plan: ExecutionPlan = {
      planId: `0x${planId}`,
      decisionHash: params.decisionHash,
      expiresAt,
      actions,
      createdAt: new Date(),
    };

    // Add production fields if provided
    if (params.configurationDigest) {
      plan.configurationDigest = params.configurationDigest;
    }
    if (params.actionDataHash) {
      plan.actionDataHash = params.actionDataHash;
    }
    if (params.harvestDeadline) {
      plan.harvestDeadline = params.harvestDeadline;
    }
    if (params.dynamicReserve !== undefined) {
      plan.dynamicReserve = params.dynamicReserve;
    }
    if (params.policyVersion !== undefined) {
      plan.policyVersion = params.policyVersion;
    }
    if (params.snapshotBlockNumber !== undefined) {
      plan.snapshotBlockNumber = params.snapshotBlockNumber;
    }
    if (params.minFinalAssets !== undefined) {
      plan.minFinalAssets = params.minFinalAssets;
    }
    if (params.maxRecognizedLoss !== undefined) {
      plan.maxRecognizedLoss = params.maxRecognizedLoss;
    }
    if (params.turnoverLimit !== undefined) {
      plan.turnoverLimit = params.turnoverLimit;
    }

    return plan;
  }

  /**
   * Compute hash of action data for verification
   */
  static computeActionDataHash(actions: PlanAction[]): string {
    const actionData = actions.map((a) => ({
      kind: a.kind,
      adapter: a.adapter.toLowerCase(),
      amount: a.amountBase.toString(),
    }));
    return createHash('sha256').update(JSON.stringify(actionData)).digest('hex');
  }

  /**
   * Encode plan for on-chain submission
   * @param plan Execution plan to encode
   * @returns Encoded plan with Unix timestamps and numeric action kinds
   */
  static encode(plan: ExecutionPlan): EncodedPlan {
    const encoded: EncodedPlan = {
      planId: plan.planId,
      decisionHash: plan.decisionHash,
      expiresAt: BigInt(Math.floor(plan.expiresAt.getTime() / 1000)),
      policyVersion: plan.policyVersion ?? 1n,
      createdAt: plan.createdAt ? BigInt(Math.floor(plan.createdAt.getTime() / 1000)) : BigInt(Math.floor(Date.now() / 1000)),
      snapshotBlockNumber: plan.snapshotBlockNumber ?? 0n,
      actions: plan.actions.map((a) => ({
        kind: a.kind,
        adapter: a.adapter,
        amountBase: a.amountBase,
        merkleRoot: a.merkleRoot,
      })),
      configurationDigest: plan.configurationDigest ?? ethers.ZeroHash,
      minFinalAssets: plan.minFinalAssets ?? 0n,
      maxRecognizedLoss: plan.maxRecognizedLoss ?? 0n,
      turnoverLimit: plan.turnoverLimit ?? 0n,
    };

    if (plan.configurationDigest) {
      encoded.configurationDigest = plan.configurationDigest;
    }
    if (plan.actionDataHash) {
      encoded.actionDataHash = plan.actionDataHash;
    }
    if (plan.harvestDeadline) {
      encoded.harvestDeadline = BigInt(Math.floor(plan.harvestDeadline.getTime() / 1000));
    }
    if (plan.dynamicReserve !== undefined) {
      encoded.dynamicReserve = plan.dynamicReserve;
    }

    return encoded;
  }

  /**
   * Validate plan structure
   * @param plan Plan to validate
   * @returns true if plan is valid
   */
  static isValid(plan: ExecutionPlan): boolean {
    if (!plan.planId || !plan.decisionHash || !plan.expiresAt) {
      return false;
    }
    if (!Array.isArray(plan.actions)) {
      return false;
    }
    for (const action of plan.actions) {
      if (action.kind < 0 || action.kind > 3) {
        return false;
      }
      if (!action.adapter) {
        return false;
      }
      if (typeof action.amountBase !== 'bigint') {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if plan has expired
   * @param plan Plan to check
   */
  static isExpired(plan: ExecutionPlan): boolean {
    return plan.expiresAt.getTime() < Date.now();
  }

  /**
   * Validate configuration digest matches expected
   * @param plan Plan to validate
   * @param expectedDigest Expected configuration digest
   * @returns true if digest matches or is not set
   */
  static validateConfigurationDigest(plan: ExecutionPlan, expectedDigest: string): boolean {
    if (!plan.configurationDigest) {
      // No digest in plan - skip validation
      return true;
    }
    return plan.configurationDigest === expectedDigest;
  }
}
