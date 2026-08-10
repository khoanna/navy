import { createHash } from 'crypto';

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
}

/**
 * Encoded plan for on-chain submission
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

    return {
      planId: `0x${planId}`,
      decisionHash: params.decisionHash,
      expiresAt,
      actions,
    };
  }

  /**
   * Encode plan for on-chain submission
   * @param plan Execution plan to encode
   * @returns Encoded plan with Unix timestamps and numeric action kinds
   */
  static encode(plan: ExecutionPlan): EncodedPlan {
    return {
      planId: plan.planId,
      decisionHash: plan.decisionHash,
      expiresAt: BigInt(Math.floor(plan.expiresAt.getTime() / 1000)),
      actions: plan.actions.map((a) => ({
        kind: a.kind,
        adapter: a.adapter,
        amountBase: a.amountBase,
        merkleRoot: a.merkleRoot,
      })),
    };
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
}
