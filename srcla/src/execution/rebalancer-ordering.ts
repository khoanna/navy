/**
 * Rebalancer Ordering Rule
 *
 * Implements §9.5 from SRCLA paper:
 * "Divestment precedes deployment. A failed divestment stops the plan;
 *  a failed deployment leaves recovered funds as idle USDC."
 *
 * This module provides ordered action execution to ensure:
 * 1. Divestments execute first (free capacity for deployments)
 * 2. Harvests execute second (capture rewards during rebalance)
 * 3. Deployments execute last (optimized allocation)
 * 4. Emergency actions execute last (only when market ineligible)
 */

import { createHash } from 'crypto';
import type { PlanAction } from './plan-builder.js';

/**
 * Action kind for ordering purposes
 */
export type ActionKind = 'deploy' | 'divest' | 'harvest' | 'emergency';

/**
 * Ordered action with execution metadata
 */
export interface OrderedAction {
  /** Original index in input array */
  originalIndex: number;
  /** Execution order index */
  executionIndex: number;
  /** Action kind */
  kind: ActionKind;
  /** Target adapter address */
  adapter: string;
  /** Amount in base units */
  amountBase: bigint;
  /** Merkle proof for this action */
  merkleProof?: string[];
}

/**
 * Result of a single action execution
 */
export interface ActionResult {
  /** Original index */
  index: number;
  /** Execution index */
  executionIndex: number;
  /** Whether execution succeeded */
  success: boolean;
  /** Amount actually processed */
  amountProcessed?: bigint;
  /** Transaction hash if successful */
  txHash?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Failure handling strategy for divestments
 */
export type DivestFailureStrategy = 'stop' | 'continue';

/**
 * Failure handling strategy for deployments
 */
export type DeployFailureStrategy = 'stop' | 'recover_idle';

/**
 * Result of ordered action execution
 */
export interface OrderedExecutionResult {
  /** All action results */
  results: ActionResult[];
  /** Whether all actions completed successfully */
  completed: boolean;
  /** Final execution state */
  finalState: 'completed' | 'partial' | 'failed';
  /** Total idle funds recovered from failed deployments */
  idleRecovered: bigint;
  /** Total amount deployed */
  totalDeployed: bigint;
  /** Total amount divested */
  totalDivested: bigint;
}

/**
 * Order actions according to SRCLA rules:
 *
 * Order: divest → harvest → deploy → emergency
 * - Divestments first: Free capacity for deployments
 * - Harvests second: Capture rewards during rebalance
 * - Deployments last: Deploy to optimized targets
 * - Emergency last: Only when market ineligible
 *
 * Within each tier, actions are sorted by:
 * 1. Amount (larger first) - bigger moves have priority
 * 2. Original index (stability) - deterministic ordering
 */
export function orderActions(
  actions: Array<{
    kind: ActionKind;
    adapter: string;
    amountBase: bigint;
  }>
): OrderedAction[] {
  // Categorize actions by kind
  const divestActions: OrderedAction[] = [];
  const harvestActions: OrderedAction[] = [];
  const deployActions: OrderedAction[] = [];
  const emergencyActions: OrderedAction[] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    const ordered: OrderedAction = {
      originalIndex: i,
      executionIndex: -1,
      kind: action.kind,
      adapter: action.adapter,
      amountBase: action.amountBase,
    };

    switch (action.kind) {
      case 'divest':
        divestActions.push(ordered);
        break;
      case 'harvest':
        harvestActions.push(ordered);
        break;
      case 'deploy':
        deployActions.push(ordered);
        break;
      case 'emergency':
        emergencyActions.push(ordered);
        break;
    }
  }

  // Sort each category by amount (larger first), then by original index
  const sortByAmount = (a: OrderedAction, b: OrderedAction): number => {
    if (b.amountBase !== a.amountBase) {
      return b.amountBase > a.amountBase ? 1 : -1;
    }
    return a.originalIndex - b.originalIndex;
  };

  divestActions.sort(sortByAmount);
  harvestActions.sort(sortByAmount);
  deployActions.sort(sortByAmount);
  emergencyActions.sort(sortByAmount);

  // Concatenate in execution order
  const ordered: OrderedAction[] = [
    ...divestActions,
    ...harvestActions,
    ...deployActions,
    ...emergencyActions,
  ];

  // Assign execution indices
  return ordered.map((action, index) => ({
    ...action,
    executionIndex: index,
  }));
}

/**
 * Generate Merkle proof for an action
 *
 * For a Merkle tree of actions, generates a proof that this action
 * is included in the tree. Used for on-chain verification.
 */
export function generateMerkleProof(
  actions: OrderedAction[],
  targetIndex: number
): string[] {
  if (actions.length === 0) return [];
  if (actions.length === 1) return [];

  // Build Merkle tree
  const leaves = actions.map((action) => hashAction(action));
  const tree = buildMerkleTree(leaves);

  // Generate proof for target index
  const proof: string[] = [];
  let currentIndex = targetIndex;

  for (let level = 0; level < tree.length - 1; level++) {
    const levelNodes = tree[level]!;
    const isRightNode = currentIndex % 2 === 1;

    if (isRightNode && levelNodes[currentIndex - 1]) {
      proof.push(levelNodes[currentIndex - 1]!);
    } else if (!isRightNode && levelNodes[currentIndex + 1]) {
      proof.push(levelNodes[currentIndex + 1]!);
    }

    currentIndex = Math.floor(currentIndex / 2);
  }

  return proof;
}

/**
 * Hash an action for Merkle tree
 */
export function hashAction(action: OrderedAction): string {
  const data = `${action.kind}:${action.adapter}:${action.amountBase.toString()}:${action.originalIndex}`;
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Build Merkle tree from leaves
 */
function buildMerkleTree(leaves: string[]): string[][] {
  if (leaves.length === 0) return [[createHash('sha256').update('').digest('hex')]];

  let currentLevel = leaves.map((leaf) => leaf);
  const tree: string[][] = [currentLevel];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]!;
      const right = currentLevel[i + 1] ?? left;
      const combined = createHash('sha256').update(left + right).digest('hex');
      nextLevel.push(combined);
    }

    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  return tree;
}

/**
 * Verify Merkle proof
 */
export function verifyMerkleProof(
  action: OrderedAction,
  proof: string[],
  root: string
): boolean {
  let hash = hashAction(action);

  for (const sibling of proof) {
    hash = createHash('sha256').update(hash + sibling).digest('hex');
  }

  return hash === root;
}

/**
 * Execute ordered actions with failure handling
 *
 * @param orderedActions Actions to execute in order
 * @param executor Function to execute a single action
 * @param divestFailure Strategy for divestment failures
 * @param deployFailure Strategy for deployment failures
 * @returns Execution result with all outcomes
 */
export async function executeOrderedActions(
  orderedActions: OrderedAction[],
  executor: (action: OrderedAction) => Promise<ActionResult>,
  divestFailure: DivestFailureStrategy = 'stop',
  deployFailure: DeployFailureStrategy = 'recover_idle'
): Promise<OrderedExecutionResult> {
  const results: ActionResult[] = [];
  let idleRecovered = 0n;
  let totalDeployed = 0n;
  let totalDivested = 0n;
  let stopExecution = false;

  for (const action of orderedActions) {
    if (stopExecution) {
      // Skip remaining actions after stop signal
      results.push({
        index: action.originalIndex,
        executionIndex: action.executionIndex,
        success: false,
        error: 'STOPPED_BY_PRIOR_FAILURE',
      });
      continue;
    }

    const result = await executor(action);
    results.push(result);

    if (!result.success) {
      switch (action.kind) {
        case 'divest':
          // Divestment failure: per §9.5, stops the plan
          if (divestFailure === 'stop') {
            stopExecution = true;
          }
          break;

        case 'deploy':
          // Deployment failure: per §9.5, recover funds as idle
          if (deployFailure === 'recover_idle') {
            idleRecovered += action.amountBase;
          }
          break;

        case 'harvest':
          // Harvest failure: log and continue
          // No action needed
          break;

        case 'emergency':
          // Emergency failure: stop execution
          stopExecution = true;
          break;
      }
    } else {
      // Track successful amounts
      if (action.kind === 'deploy') {
        totalDeployed += result.amountProcessed ?? 0n;
      } else if (action.kind === 'divest') {
        totalDivested += result.amountProcessed ?? 0n;
      }
    }
  }

  // Determine final state
  const failedCount = results.filter((r) => !r.success).length;
  let finalState: 'completed' | 'partial' | 'failed';

  if (failedCount === 0) {
    finalState = 'completed';
  } else if (failedCount === results.length) {
    finalState = 'failed';
  } else {
    finalState = 'partial';
  }

  return {
    results,
    completed: failedCount === 0,
    finalState,
    idleRecovered,
    totalDeployed,
    totalDivested,
  };
}

/**
 * Convert PlanAction to OrderedAction format
 */
export function planActionsToOrdered(
  actions: PlanAction[]
): Array<{
  kind: ActionKind;
  adapter: string;
  amountBase: bigint;
}> {
  return actions.map((action) => ({
    kind: action.kind === 0
      ? 'deploy'
      : action.kind === 1
        ? 'divest'
        : action.kind === 2
          ? 'harvest'
          : 'emergency',
    adapter: action.adapter,
    amountBase: action.amountBase,
  }));
}

/**
 * Convert OrderedAction back to PlanAction format
 */
export function orderedToPlanAction(action: OrderedAction): PlanAction {
  return {
    kind: action.kind === 'deploy' ? 0
      : action.kind === 'divest' ? 1
        : action.kind === 'harvest' ? 2
          : 3,
    adapter: action.adapter,
    amountBase: action.amountBase,
    merkleRoot: '0x' + generateMerkleRoot([action]),
  };
}

/**
 * Generate Merkle root for a list of actions
 */
export function generateMerkleRoot(actions: OrderedAction[]): string {
  if (actions.length === 0) {
    return createHash('sha256').update('').digest('hex');
  }

  const leaves = actions.map((action) => hashAction(action));
  const tree = buildMerkleTree(leaves);
  return tree[tree.length - 1]![0]!;
}

/**
 * Validate execution ordering constraints
 */
export function validateOrderingConstraints(
  orderedActions: OrderedAction[]
): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  let lastDeployIndex = -1;

  for (const action of orderedActions) {
    switch (action.kind) {
      case 'divest':
        // After divest, no deploys should have happened
        if (lastDeployIndex >= 0) {
          errors.push(`Divest at index ${action.executionIndex} after deploy at index ${lastDeployIndex}`);
        }
        break;

      case 'harvest':
        // After harvest, no deploys should have happened
        if (lastDeployIndex >= 0) {
          errors.push(`Harvest at index ${action.executionIndex} after deploy at index ${lastDeployIndex}`);
        }
        break;

      case 'deploy':
        lastDeployIndex = action.executionIndex;
        break;

      case 'emergency':
        // Emergency must be last
        if (action.executionIndex !== orderedActions.length - 1) {
          errors.push(`Emergency at index ${action.executionIndex} is not last`);
        }
        break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
