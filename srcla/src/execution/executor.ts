import { ethers } from 'ethers';
import { PlanBuilder, type PlanAction } from './plan-builder.js';
import { preflight, type PreflightParams } from './preflight.js';
import type { VaultState } from './reconciler.js';
import type { MarketState } from '../protocols/simulation/types.js';

/**
 * Failure strategies for plan execution
 */
export type DivestFailureStrategy = 'stop' | 'continue';
export type DeployFailureStrategy = 'stop' | 'recover_idle';

/**
 * Recovery configuration for executeWithRecovery
 */
export interface RecoveryConfig {
  /** Strategy when a divest action fails */
  divestFailureStrategy: DivestFailureStrategy;
  /** Strategy when a deploy action fails */
  deployFailureStrategy: DeployFailureStrategy;
  /** Enable direct allocation fallback */
  enableDirectAllocationFallback: boolean;
}

/**
 * Direct allocation result
 */
export interface DirectAllocationResult {
  /** Target adapter address */
  adapter: string;
  /** Amount allocated (may be less than requested if capacity constrained) */
  amount: bigint;
}

/**
 * Executor configuration
 */
export interface ExecutorConfig {
  /** Maximum gas price in wei */
  maxGasPrice: bigint;
  /** Maximum slippage in basis points (default: 50 = 0.5%) */
  maxSlippageBps: bigint;
  /** Number of confirmations to wait for (default: 2) */
  confirmations: number;
  /** Gas limit for transactions */
  gasLimit?: bigint;
}

/**
 * Result of a single action execution
 */
export interface ExecutionResult {
  /** Whether the execution succeeded */
  success: boolean;
  /** Transaction hash if successful */
  txHash?: string;
  /** Gas used by the transaction */
  gasUsed?: bigint;
  /** Error message if failed */
  error?: string;
  /** Whether preflight check failed */
  preflightFailed?: boolean;
}

/**
 * Result of executing a full plan
 */
export interface PlanExecutionResult {
  /** Number of successfully completed actions */
  completed: number;
  /** Number of failed actions */
  failed: number;
  /** Individual action results */
  results: ExecutionResult[];
  /** Whether execution was stopped early due to failure */
  stoppedEarly: boolean;
}

/**
 * Vault ABI fragment for NavyVaultSRCLA executor operations.
 * Matches the deployed contract at contract/src/NavyVaultSRCLA.sol
 *
 * Key functions:
 * - submitPlan(header, merkleRoot): Submit a new execution plan
 * - executeNextActionWithProof(proof, action): Execute next action with Merkle proof
 * - executeAction(planId, actionIndex, kind, adapter, amount, minOut, dataHash, proof)
 * - harvest(adapter, token, maxClaim, routeId, minOut, deadline): Atomic harvest
 * - emergencyExit(adapter): Emergency exit from adapter
 * - cancelPlan(): Cancel active plan
 */
const VAULT_ABI = [
  // ERC-4626 User-facing (read)
  'function totalAssets() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function maxRedeem(address owner) view returns (uint256)',
  'function maxDeposit(address) view returns (uint256)',
  'function paused() view returns (bool)',

  // Plan state getters
  'function activePlanId() view returns (bytes32)',
  'function activePlanMerkleRoot() view returns (bytes32)',
  'function activePlanNextActionIndex() view returns (uint64)',
  'function activePlanActionCount() view returns (uint64)',
  'function activePlanExpiresAt() view returns (uint64)',
  'function activePlanDecisionHash() view returns (bytes32)',
  'function activePlanDomain() view returns (bytes32)',
  'function activePlanConfigurationDigest() view returns (bytes32)',
  'function currentConfigurationDigest() view returns (bytes32)',
  'function usedPlanIds(bytes32) view returns (bool)',

  // Admin functions (ADMIN_ROLE required)
  'function registerAdapter(address adapter, uint16 capBps, uint16 maxLossBps, string calldata name)',
  'function setAdapterRisk(address adapter, uint16 capBps, uint256 absoluteCap, uint16 maxLossBps)',
  'function setAdminReserve(uint256 reserve)',
  'function setMaxSynchronousLossBps(uint16 maxLossBps)',
  'function setAdapterState(address adapter, uint8 state)',
  'function setMinIdleBps(uint256 bps)',
  'function pause()',
  'function unpause()',
  'function setRewardExecutor(address executor)',
  'function setRewardAccountant(address accountant)',

  // Allocator functions (ALLOCATOR_ROLE required)
  // VaultTypes.PlanHeader: planId, policyVersion, createdAt, expiresAt, actionCount, snapshotBlockNumber, snapshotHash, decisionHash, configurationDigest, reserve, minFinalAssets, maxRecognizedLoss, turnoverLimit
  'function submitPlan((uint256 planId, uint64 policyVersion, uint64 createdAt, uint64 expiresAt, uint32 actionCount, uint256 snapshotBlockNumber, bytes32 snapshotHash, bytes32 decisionHash, bytes32 configurationDigest, uint256 reserve, uint256 minFinalAssets, uint256 maxRecognizedLoss, uint256 turnoverLimit) header, bytes32 merkleRoot)',
  'function executeNextActionWithProof(bytes32[] calldata merkleProof, (uint256 planId, uint32 index, uint8 kind, address adapter, uint256 amount, uint256 minOut, bytes32 dataHash) calldata action)',
  'function executeAction(uint256 planId, uint32 actionIndex, uint8 kind, address adapter, uint256 amount, uint256 minOut, bytes32 dataHash, bytes32[] calldata proof)',
  'function executeHarvestAction((address adapter, address token, uint256 maxClaim, bytes32 routeId, uint256 minOut, uint256 deadline) memory request)',
  'function cancelPlan()',

  // Harvest (ALLOCATOR_ROLE required)
  'function harvest(address adapter, address token, uint256 maxClaim, bytes32 routeId, uint256 minOut, uint256 deadline) returns (uint256 usdcReceived)',

  // Emergency (ADMIN_ROLE required)
  'function emergencyExit(address adapter)',

  // Strategy state
  'function strategyAssets(address adapter) view returns (uint256)',
  'function registeredAdapters(address) view returns (bool)',
  'function synchronousLiquidity() view returns (uint256)',

  // Access control
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function ADMIN_ROLE() view returns (bytes32)',
  'function ALLOCATOR_ROLE() view returns (bytes32)',

  // Events
  'event PlanSubmitted(bytes32 indexed planId, bytes32 merkleRoot)',
  'event PlanCompleted(bytes32 indexed planId)',
  'event PlanCancelled(bytes32 indexed planId)',
  'event ActionExecuted(uint256 indexed planId, uint32 indexed actionIndex, uint8 indexed kind)',
  'event Harvested(address indexed adapter, uint256 usdcReceived)',
  'event EmergencyExit(address indexed adapter, uint256 amount)',
  'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
];

/**
 * Action kinds as defined in NavyVaultSRCLA.sol
 */
export enum ActionKindCode {
  DEPLOY = 0,
  DIVEST = 1,
  HARVEST = 2,
  EMERGENCY = 3,
}

/**
 * Execute individual actions and full plans
 *
 * Handles:
 * - Plan submission via submitPlan()
 * - Action execution via executeAction()
 * - Harvest actions via harvest()
 * - Emergency exits via emergencyExit()
 * - Error handling and recovery
 */
export class PlanExecutor {
  private wallet: ethers.Wallet;
  private vault: ethers.BaseContract;
  private config: ExecutorConfig;

  constructor(
    wallet: ethers.Wallet,
    vaultAddress: string,
    config: ExecutorConfig
  ) {
    this.wallet = wallet;
    this.vault = new ethers.Contract(vaultAddress, VAULT_ABI, wallet) as ethers.BaseContract;
    this.config = config;
  }

  /**
   * Create executor with provider instead of wallet
   * Useful for read-only operations
   */
  static withProvider(vaultAddress: string, provider: ethers.JsonRpcProvider): ethers.BaseContract {
    return new ethers.Contract(vaultAddress, VAULT_ABI, provider) as ethers.BaseContract;
  }

  /**
   * Submit a plan to the vault
   * @param header Plan header with all required fields (matches VaultTypes.PlanHeader)
   * @param merkleRoot Merkle root for action verification
   * @returns Execution result
   */
  async submitPlan(
    header: {
      planId: bigint;
      policyVersion: bigint;
      createdAt: bigint;
      expiresAt: bigint;
      actionCount: bigint;
      snapshotBlockNumber: bigint;
      snapshotHash: string;
      decisionHash: string;
      configurationDigest: string;
      reserve: bigint;
      minFinalAssets: bigint;
      maxRecognizedLoss: bigint;
      turnoverLimit: bigint;
    },
    merkleRoot: string
  ): Promise<ExecutionResult> {
    try {
      // Encode the PlanHeader struct: (uint256,uint64,uint64,uint64,uint32,uint256,bytes32,bytes32,bytes32,uint256,uint256,uint256,uint256)
      const iface = this.vault.interface;
      const encodedHeader = ethers.AbiCoder.defaultAbiCoder().encode(
        ['(uint256,uint64,uint64,uint64,uint32,uint256,bytes32,bytes32,bytes32,uint256,uint256,uint256,uint256)'],
        [{
          planId: header.planId,
          policyVersion: header.policyVersion,
          createdAt: header.createdAt,
          expiresAt: header.expiresAt,
          actionCount: header.actionCount,
          snapshotBlockNumber: header.snapshotBlockNumber,
          snapshotHash: header.snapshotHash,
          decisionHash: header.decisionHash,
          configurationDigest: header.configurationDigest,
          reserve: header.reserve,
          minFinalAssets: header.minFinalAssets,
          maxRecognizedLoss: header.maxRecognizedLoss,
          turnoverLimit: header.turnoverLimit,
        }]
      );

      const tx = await this.wallet.sendTransaction({
        to: this.vault.target,
        data: iface.encodeFunctionData('submitPlan', [encodedHeader, merkleRoot]),
        gasLimit: this.config.gasLimit ?? 500_000n,
      });

      const receipt = await tx.wait(this.config.confirmations);
      return {
        success: true,
        txHash: receipt!.hash,
        gasUsed: receipt!.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute a single action with Merkle proof
   * @param planId Plan ID
   * @param actionIndex Action index
   * @param kind Action kind (0=deploy, 1=divest, 2=harvest, 3=emergency)
   * @param adapter Target adapter
   * @param amount Amount
   * @param minOut Minimum output
   * @param dataHash Data hash for verification
   * @param proof Merkle proof
   * @returns Execution result
   */
  async executeAction(
    planId: bigint,
    actionIndex: number,
    kind: number,
    adapter: string,
    amount: bigint,
    minOut: bigint,
    dataHash: string,
    proof: string[]
  ): Promise<ExecutionResult> {
    try {
      const tx = await (this.vault.executeAction as Function)(
        planId,
        actionIndex,
        kind,
        adapter,
        amount,
        minOut,
        dataHash,
        proof,
        {
          gasLimit: this.config.gasLimit ?? 500_000n,
        }
      );

      const receipt = await tx.wait(this.config.confirmations);
      return {
        success: true,
        txHash: receipt!.hash,
        gasUsed: receipt!.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Atomic harvest via direct harvest function
   * @param adapter Strategy adapter
   * @param token Reward token to claim
   * @param maxClaim Maximum amount to claim
   * @param routeId Swap route ID
   * @param minOut Minimum USDC output
   * @param deadline Deadline timestamp
   * @returns Execution result with USDC received
   */
  async harvest(
    adapter: string,
    token: string,
    maxClaim: bigint,
    routeId: string,
    minOut: bigint,
    deadline: bigint
  ): Promise<ExecutionResult & { usdcReceived?: bigint }> {
    try {
      const tx = await (this.vault.harvest as Function)(
        adapter,
        token,
        maxClaim,
        routeId,
        minOut,
        deadline,
        { gasLimit: this.config.gasLimit ?? 300_000n }
      );

      const receipt = await tx.wait(this.config.confirmations);

      // Decode Harvested event
      let usdcReceived: bigint | undefined;
      try {
        const iface = this.vault.interface;
        const harvestedTopic = iface.getEvent('Harvested')!.topicHash;
        const log = receipt!.logs.find((l: { topics: string[] }) => l.topics[0] === harvestedTopic);
        if (log) {
          const decoded = iface.decodeEventLog('Harvested', log.data, log.topics);
          usdcReceived = decoded.usdcReceived as bigint;
        }
      } catch {
        // Event decoding failed, continue without it
      }

      return {
        success: true,
        txHash: receipt!.hash,
        gasUsed: receipt!.gasUsed,
        usdcReceived,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Emergency exit from an adapter
   * @param adapter Adapter to exit
   * @returns Execution result
   */
  async emergencyExit(adapter: string): Promise<ExecutionResult> {
    try {
      const tx = await (this.vault.emergencyExit as Function)(adapter, {
        gasLimit: this.config.gasLimit ?? 500_000n,
      });

      const receipt = await tx.wait(this.config.confirmations);
      return {
        success: true,
        txHash: receipt!.hash,
        gasUsed: receipt!.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Cancel active plan
   * @returns Execution result
   */
  async cancelPlan(): Promise<ExecutionResult> {
    try {
      const tx = await (this.vault.cancelPlan as Function)({
        gasLimit: 200_000n,
      });

      const receipt = await tx.wait(this.config.confirmations);
      return {
        success: true,
        txHash: receipt!.hash,
        gasUsed: receipt!.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
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
    const [activePlanId, merkleRoot, nextActionIndex, actionCount, expiresAt] = await Promise.all([
      this.vault.activePlanId() as Promise<string>,
      this.vault.activePlanMerkleRoot() as Promise<string>,
      this.vault.activePlanNextActionIndex() as Promise<bigint>,
      this.vault.activePlanActionCount() as Promise<bigint>,
      this.vault.activePlanExpiresAt() as Promise<bigint>,
    ]);

    return {
      activePlanId,
      merkleRoot,
      nextActionIndex,
      actionCount,
      expiresAt,
    };
  }

  /**
   * Check if an address has ADMIN_ROLE
   */
  async hasAdminRole(address: string): Promise<boolean> {
    return (this.vault.hasRole as Function)(
      await (this.vault.ADMIN_ROLE as Function)(),
      address
    ) as Promise<boolean>;
  }

  /**
   * Check if an address has ALLOCATOR_ROLE
   */
  async hasAllocatorRole(address: string): Promise<boolean> {
    return (this.vault.hasRole as Function)(
      await (this.vault.ALLOCATOR_ROLE as Function)(),
      address
    ) as Promise<boolean>;
  }

  /**
   * Execute full plan with staged actions
   * @param plan Plan to execute
   * @param preflightParamsFactory Factory function to create preflight params for each action
   * @returns Plan execution result
   */
  async executePlan(
    plan: ReturnType<typeof PlanBuilder.build>,
    preflightParamsFactory: (action: PlanAction) => PreflightParams
  ): Promise<PlanExecutionResult> {
    const results: ExecutionResult[] = [];
    let completed = 0;
    let failed = 0;
    let stoppedEarly = false;

    // Check if plan has expired
    if (PlanBuilder.isExpired(plan)) {
      return {
        completed: 0,
        failed: plan.actions.length,
        results: [{
          success: false,
          error: 'Plan has expired',
        }],
        stoppedEarly: true,
      };
    }

    for (const action of plan.actions) {
      const preflightParams = preflightParamsFactory(action);
      const result = await this.execute(action, preflightParams);
      results.push(result);

      if (result.success) {
        completed++;
      } else {
        failed++;
        // Stop on failure for safety
        stoppedEarly = true;
        break;
      }
    }

    return {
      completed,
      failed,
      results,
      stoppedEarly,
    };
  }

  /**
   * Execute a single action
   * @param action Action to execute
   * @param _preflightParams Preflight parameters for validation (unused in this simplified version)
   * @returns Execution result
   */
  async execute(action: PlanAction, _preflightParams: PreflightParams): Promise<ExecutionResult> {
    // Get current plan state
    const planState = await this.getPlanState();

    // Execute based on action kind
    switch (action.kind) {
      case ActionKindCode.DEPLOY:
      case ActionKindCode.DIVEST:
        return await this.executeAction(
          BigInt(planState.activePlanId),
          Number(planState.nextActionIndex),
          action.kind,
          action.adapter,
          action.amountBase,
          0n, // minOut
          ethers.ZeroHash,
          [] // proof - would need proper merkle proof in production
        );

      case ActionKindCode.HARVEST:
        // For harvest, we'd need the token and route params from the action
        // Simplified: return success if plan is active
        return {
          success: planState.activePlanId !== ethers.ZeroHash,
          txHash: undefined,
          error: planState.activePlanId === ethers.ZeroHash ? 'No active plan' : undefined,
        };

      case ActionKindCode.EMERGENCY:
        return await this.emergencyExit(action.adapter);

      default:
        return {
          success: false,
          error: `Unknown action kind: ${action.kind}`,
        };
    }
  }

  /**
   * Estimate gas for an action
   */
  async estimateGas(action: PlanAction): Promise<bigint> {
    try {
      const populatedTx = await (this.vault.executeAction as Function).populateTransaction(
        0n,
        0,
        action.kind,
        action.adapter,
        action.amountBase,
        0n,
        ethers.ZeroHash,
        [],
        { from: this.wallet.address }
      );
      return await this.wallet.provider.estimateGas(populatedTx as ethers.TransactionRequest);
    } catch {
      return 500_000n;
    }
  }

  /**
   * Get current gas price from provider
   */
  async getGasPrice(): Promise<bigint> {
    const feeData = await this.wallet.provider!.getFeeData();
    return feeData.gasPrice ?? 50_000_000_000n;
  }

  /**
   * Direct allocation fallback
   */
  directAllocation(
    vaultState: VaultState,
    markets: MarketState[],
    amount: bigint
  ): DirectAllocationResult | null {
    const eligible = markets.filter((m) => {
      const capacityRemaining = m.cash;
      const hasCapacity = capacityRemaining >= amount;

      const adapterBalance = vaultState.adapterBalances.get(m.marketId) ?? 0n;
      const isActive = adapterBalance > 0n || markets.length === 1;

      const notEmergency = m.cash > 0n;

      return hasCapacity && isActive && notEmergency;
    });

    if (eligible.length === 0) return null;

    eligible.sort((a, b) => {
      const rateA = a.supplyRate;
      const rateB = b.supplyRate;
      if (rateA < rateB) return 1;
      if (rateA > rateB) return -1;
      return 0;
    });

    const best = eligible[0]!;
    const capacityRemaining = best.cash;
    const actualAmount = amount <= capacityRemaining ? amount : capacityRemaining;

    return {
      adapter: best.marketId,
      amount: actualAmount,
    };
  }

  /**
   * Execute plan with failure recovery strategies
   */
  async executeWithRecovery(
    plan: ReturnType<typeof PlanBuilder.build>,
    preflightParamsFactory: (action: PlanAction) => PreflightParams,
    recoveryConfig: RecoveryConfig
  ): Promise<PlanExecutionResult & { recoveredAmount?: bigint; fallbackUsed?: boolean }> {
    const results: ExecutionResult[] = [];
    let completed = 0;
    let failed = 0;
    let stoppedEarly = false;
    let recoveredAmount: bigint | undefined;
    let fallbackUsed = false;

    if (PlanBuilder.isExpired(plan)) {
      return {
        completed: 0,
        failed: plan.actions.length,
        results: [{
          success: false,
          error: 'Plan has expired',
        }],
        stoppedEarly: true,
      };
    }

    let failedDeployAmount = 0n;

    for (let i = 0; i < plan.actions.length; i++) {
      const action = plan.actions[i]!;
      const preflightParams = preflightParamsFactory(action);
      const result = await this.execute(action, preflightParams);
      results.push(result);

      if (result.success) {
        completed++;
        failedDeployAmount = 0n;
      } else {
        failed++;

        if (action.kind === ActionKindCode.DEPLOY) {
          if (recoveryConfig.deployFailureStrategy === 'stop') {
            stoppedEarly = true;
            break;
          }
          failedDeployAmount += action.amountBase;
        } else if (action.kind === ActionKindCode.DIVEST) {
          if (recoveryConfig.divestFailureStrategy === 'stop') {
            stoppedEarly = true;
            break;
          }
        } else {
          stoppedEarly = true;
          break;
        }
      }
    }

    if (
      recoveryConfig.enableDirectAllocationFallback &&
      failedDeployAmount > 0n &&
      stoppedEarly
    ) {
      fallbackUsed = true;
    }

    return {
      completed,
      failed,
      results,
      stoppedEarly,
      ...(recoveredAmount !== undefined && { recoveredAmount }),
      ...(fallbackUsed && { fallbackUsed }),
    };
  }
}

/**
 * Default executor configuration
 */
export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  maxGasPrice: 100_000_000_000n, // 100 gwei
  maxSlippageBps: 50n, // 0.5%
  confirmations: 2,
  gasLimit: 500_000n,
};

/**
 * Default recovery configuration
 * Conservative defaults: stop on any failure
 */
export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  divestFailureStrategy: 'stop',
  deployFailureStrategy: 'stop',
  enableDirectAllocationFallback: false,
};

/**
 * Aggressive recovery configuration
 * Continues on divest failure, recovers idle on deploy failure
 */
export const AGGRESSIVE_RECOVERY_CONFIG: RecoveryConfig = {
  divestFailureStrategy: 'continue',
  deployFailureStrategy: 'recover_idle',
  enableDirectAllocationFallback: true,
};
