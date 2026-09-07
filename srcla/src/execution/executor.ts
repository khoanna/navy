import { ethers } from 'ethers';
import type { PlanAction } from './plan-builder.js';
import type { VaultState } from './reconciler.js';
import type { MarketState } from '../protocols/simulation/types.js';

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
  /** Transaction hash if successful (undefined if failed) */
  txHash?: string | undefined;
  /** Gas used by the transaction (undefined if failed) */
  gasUsed?: bigint | undefined;
  /** Error message if failed (undefined if succeeded) */
  error?: string | undefined;
  /** Whether preflight check failed */
  preflightFailed?: boolean;
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
 * `VaultTypes.PlanHeader`, field order/types read from
 * contract/src/libraries/VaultTypes.sol (mirrors src/policy/steps/plan.ts's
 * HEADER_TUPLE).
 */
export interface PlanHeaderInput {
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
}

/**
 * The `Action` struct consumed by `executeNextActionWithProof` (NOT the
 * older `executeAction` positional args).
 */
export interface PlanActionInput {
  planId: bigint;
  index: number;
  kind: number;
  adapter: string;
  amount: bigint;
  minOut: bigint;
  dataHash: string;
}

/**
 * Narrow surface `KeeperExecutor` depends on. Declared as an interface
 * (rather than depending on the concrete `PlanExecutor` class directly) so
 * tests can inject a fully mocked implementation and exercise
 * `KeeperExecutor.executePlanDraft`'s submit/cancel/execute-loop orchestration
 * without any RPC connection.
 */
export interface IPlanExecutor {
  submitPlan(header: PlanHeaderInput, merkleRoot: string): Promise<ExecutionResult>;
  executeNextActionWithProof(proof: string[], action: PlanActionInput): Promise<ExecutionResult>;
  cancelPlan(): Promise<ExecutionResult>;
  getActivePlanId(): Promise<string>;
  getConfigurationDigest(): Promise<string>;
  harvest(
    adapter: string,
    token: string,
    maxClaim: bigint,
    routeId: string,
    minOut: bigint,
    deadline: bigint
  ): Promise<ExecutionResult & { usdcReceived?: bigint }>;
  emergencyExit(adapter: string): Promise<ExecutionResult>;
  hasAllocatorRole(address: string): Promise<boolean>;
  hasAdminRole(address: string): Promise<boolean>;
  getPlanState(): Promise<{
    activePlanId: string;
    merkleRoot: string;
    nextActionIndex: bigint;
    actionCount: bigint;
    expiresAt: bigint;
  }>;
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
export class PlanExecutor implements IPlanExecutor {
  private wallet: ethers.Wallet;
  private vaultAddress: string;
  private iface: ethers.Interface;
  private config: ExecutorConfig;

  constructor(
    wallet: ethers.Wallet,
    vaultAddress: string,
    config: ExecutorConfig
  ) {
    this.wallet = wallet;
    this.vaultAddress = vaultAddress;
    this.iface = new ethers.Interface(VAULT_ABI);
    this.config = config;
  }

  /**
   * Create executor with provider instead of wallet
   * Useful for read-only operations
   */
  static withProvider(vaultAddress: string, provider: ethers.JsonRpcProvider): ethers.Contract {
    return new ethers.Contract(vaultAddress, VAULT_ABI, provider);
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
      // The ABI entry for submitPlan (VAULT_ABI above) declares `header` as
      // a NAMED tuple struct, so ethers.Interface.encodeFunctionData accepts
      // the header object directly -- no manual AbiCoder step is needed or
      // correct here. (A prior version of this method ran the header through
      // `AbiCoder.defaultAbiCoder().encode(['(uint256,uint64,...)'], [obj])`
      // first: an UNNAMED tuple type string cannot encode a plain object --
      // ethers throws "cannot encode object for signature with missing
      // names" -- so that call threw on every invocation, was swallowed by
      // this method's own try/catch into `{success:false, error}`, and
      // `submitPlan` never once actually sent a transaction. Even had it not
      // thrown, the resulting bytes blob would have been passed where the
      // ABI expects a tuple, which encodeFunctionData would also reject.
      // Covered by the round-trip test in test/unit/execution/executor.spec.ts.)
      const tx = await this.wallet.sendTransaction({
        to: this.vaultAddress,
        data: this.iface.encodeFunctionData('submitPlan', [header, merkleRoot]),
        gasLimit: this.config.gasLimit ?? 500_000n,
      });

      const receipt = await tx.wait(this.config.confirmations);
      return {
        success: true,
        txHash: receipt?.hash ?? '',
        gasUsed: receipt?.gasUsed,
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
      const data = this.iface.encodeFunctionData('executeAction', [
        planId,
        actionIndex,
        kind,
        adapter,
        amount,
        minOut,
        dataHash,
        proof,
      ]);

      const tx = await this.wallet.sendTransaction({
        to: this.vaultAddress,
        data,
        gasLimit: this.config.gasLimit ?? 500_000n,
      });

      const receipt = await tx.wait(this.config.confirmations);
      return {
        success: true,
        txHash: receipt?.hash ?? '',
        gasUsed: receipt?.gasUsed,
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
      const data = this.iface.encodeFunctionData('harvest', [
        adapter,
        token,
        maxClaim,
        routeId,
        minOut,
        deadline,
      ]);

      const tx = await this.wallet.sendTransaction({
        to: this.vaultAddress,
        data,
        gasLimit: this.config.gasLimit ?? 300_000n,
      });

      const receipt = await tx.wait(this.config.confirmations);

      // Decode Harvested event
      let usdcReceived: bigint | undefined;
      try {
        const harvestedTopic = this.iface.getEvent('Harvested')!.topicHash;
        const log = receipt?.logs.find((l) => l.topics[0] === harvestedTopic);
        if (log) {
          const decoded = this.iface.decodeEventLog('Harvested', log.data, log.topics);
          usdcReceived = decoded.usdcReceived as bigint;
        }
      } catch {
        // Event decoding failed, continue without it
      }

      return {
        success: true,
        txHash: receipt?.hash ?? '',
        gasUsed: receipt?.gasUsed,
        ...(usdcReceived !== undefined && { usdcReceived }),
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
      const data = this.iface.encodeFunctionData('emergencyExit', [adapter]);

      const tx = await this.wallet.sendTransaction({
        to: this.vaultAddress,
        data,
        gasLimit: this.config.gasLimit ?? 500_000n,
      });

      const receipt = await tx.wait(this.config.confirmations);
      return {
        success: true,
        txHash: receipt?.hash ?? '',
        gasUsed: receipt?.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * §9.5 — the only fund-moving path for a staged deploy/divest action.
   * Unlike executeAction (which the vault still exposes but this task stops
   * calling for plan actions), executeNextActionWithProof rechecks the
   * configuration digest, enforces the plan's risk limits, accounts
   * turnover, completes the plan and activates the dynamic reserve.
   * @param proof Merkle proof for the leaf `hashPlanAction(planDomain(header), action)`
   *   (src/policy/steps/plan.ts) — NOT the old domain-less executeAction leaf.
   * @param action The `Action` struct matching the leaf that was proved.
   */
  async executeNextActionWithProof(proof: string[], action: PlanActionInput): Promise<ExecutionResult> {
    try {
      const data = this.iface.encodeFunctionData('executeNextActionWithProof', [
        proof,
        [action.planId, action.index, action.kind, action.adapter, action.amount, action.minOut, action.dataHash],
      ]);

      const tx = await this.wallet.sendTransaction({
        to: this.vaultAddress,
        data,
        gasLimit: this.config.gasLimit ?? 500_000n,
      });

      const receipt = await tx.wait(this.config.confirmations);
      return {
        success: true,
        txHash: receipt?.hash ?? '',
        gasUsed: receipt?.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Read the vault's current active plan id. Zero (ethers.ZeroHash) means no
   * plan is active. Used by KeeperExecutor.executePlanDraft to detect and
   * clear a wedged plan before submitting a new one.
   */
  async getActivePlanId(): Promise<string> {
    const provider = this.wallet.provider as ethers.JsonRpcProvider;
    try {
      const data = await provider.call({
        to: this.vaultAddress,
        data: this.iface.encodeFunctionData('activePlanId'),
      });
      if (data === '0x') return ethers.ZeroHash;
      const [id] = ethers.AbiCoder.defaultAbiCoder().decode(['bytes32'], data);
      return id as string;
    } catch {
      return ethers.ZeroHash;
    }
  }

  /**
   * Cancel active plan
   * @returns Execution result
   */
  async cancelPlan(): Promise<ExecutionResult> {
    try {
      const data = this.iface.encodeFunctionData('cancelPlan', []);

      const tx = await this.wallet.sendTransaction({
        to: this.vaultAddress,
        data,
        gasLimit: 200_000n,
      });

      const receipt = await tx.wait(this.config.confirmations);
      return {
        success: true,
        txHash: receipt?.hash ?? '',
        gasUsed: receipt?.gasUsed,
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
    const provider = this.wallet.provider as ethers.JsonRpcProvider;

    try {
      const [activePlanId, merkleRoot, nextActionIndex, actionCount, expiresAt] = await Promise.all([
        provider.call({ to: this.vaultAddress, data: this.iface.encodeFunctionData('activePlanId') }),
        provider.call({ to: this.vaultAddress, data: this.iface.encodeFunctionData('activePlanMerkleRoot') }),
        provider.call({ to: this.vaultAddress, data: this.iface.encodeFunctionData('activePlanNextActionIndex') }),
        provider.call({ to: this.vaultAddress, data: this.iface.encodeFunctionData('activePlanActionCount') }),
        provider.call({ to: this.vaultAddress, data: this.iface.encodeFunctionData('activePlanExpiresAt') }),
      ]);

      return {
        activePlanId: activePlanId === '0x' ? ethers.ZeroHash : ethers.AbiCoder.defaultAbiCoder().decode(['bytes32'], activePlanId)[0] as string,
        merkleRoot: merkleRoot === '0x' ? ethers.ZeroHash : ethers.AbiCoder.defaultAbiCoder().decode(['bytes32'], merkleRoot)[0] as string,
        nextActionIndex: nextActionIndex === '0x' ? 0n : ethers.AbiCoder.defaultAbiCoder().decode(['uint64'], nextActionIndex)[0] as bigint,
        actionCount: actionCount === '0x' ? 0n : ethers.AbiCoder.defaultAbiCoder().decode(['uint64'], actionCount)[0] as bigint,
        expiresAt: expiresAt === '0x' ? 0n : ethers.AbiCoder.defaultAbiCoder().decode(['uint64'], expiresAt)[0] as bigint,
      };
    } catch {
      // Return zero state on error
      return {
        activePlanId: ethers.ZeroHash,
        merkleRoot: ethers.ZeroHash,
        nextActionIndex: 0n,
        actionCount: 0n,
        expiresAt: 0n,
      };
    }
  }

  /**
   * Read current configuration digest from the vault contract.
   * This is required for submitPlan() to not revert with InvalidConfigurationDigest.
   */
  async getConfigurationDigest(): Promise<string> {
    const provider = this.wallet.provider as ethers.JsonRpcProvider;
    try {
      const data = await provider.call({
        to: this.vaultAddress,
        data: this.iface.encodeFunctionData('currentConfigurationDigest'),
      });
      if (data === '0x' || data === ethers.ZeroHash) return ethers.ZeroHash;
      const [digest] = ethers.AbiCoder.defaultAbiCoder().decode(['bytes32'], data);
      return digest as string;
    } catch {
      return ethers.ZeroHash;
    }
  }

  // Role hashes (computed from contract constants)
  private static readonly ADMIN_ROLE_HASH = '0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775';
  private static readonly ALLOCATOR_ROLE_HASH = '0x7935be9171d225aed0f1e3092f6e45b2c8c1b97c41c25e5077c07d3f3e71a62f';

  /**
   * Check if an address has ADMIN_ROLE
   */
  async hasAdminRole(address: string): Promise<boolean> {
    const provider = this.wallet.provider as ethers.JsonRpcProvider;
    try {
      const hasRoleData = await provider.call({
        to: this.vaultAddress,
        data: this.iface.encodeFunctionData('hasRole', [PlanExecutor.ADMIN_ROLE_HASH, address]),
      });
      return hasRoleData !== '0x' && (ethers.AbiCoder.defaultAbiCoder().decode(['bool'], hasRoleData)[0] as boolean);
    } catch {
      return false;
    }
  }

  /**
   * Check if an address has ALLOCATOR_ROLE
   */
  async hasAllocatorRole(address: string): Promise<boolean> {
    const provider = this.wallet.provider as ethers.JsonRpcProvider;
    try {
      const hasRoleData = await provider.call({
        to: this.vaultAddress,
        data: this.iface.encodeFunctionData('hasRole', [PlanExecutor.ALLOCATOR_ROLE_HASH, address]),
      });
      return hasRoleData !== '0x' && (ethers.AbiCoder.defaultAbiCoder().decode(['bool'], hasRoleData)[0] as boolean);
    } catch {
      return false;
    }
  }

  /**
   * Estimate gas for an action
   * Uses eth_estimateGas RPC call
   */
  async estimateGas(action: PlanAction): Promise<bigint> {
    try {
      const provider = this.wallet.provider as ethers.JsonRpcProvider;
      const data = this.iface.encodeFunctionData('executeAction', [
        0n, // planId
        0,  // actionIndex
        action.kind,
        action.adapter,
        action.amountBase,
        0n, // minOut
        ethers.ZeroHash,
        [],  // proof
      ]);

      const gas = await provider.estimateGas({
        from: this.wallet.address,
        to: this.vaultAddress,
        data,
      });
      return gas;
    } catch {
      return 500_000n;
    }
  }

  /**
   * Get current gas price from provider
   */
  async getGasPrice(): Promise<bigint> {
    const provider = this.wallet.provider as ethers.JsonRpcProvider;
    const feeData = await provider.getFeeData();
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
