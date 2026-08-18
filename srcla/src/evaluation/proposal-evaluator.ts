/**
 * SRCLA Proposal Evaluator
 *
 * Implements paper §4: "SRCLA reviews proposals from backend"
 *
 * The proposal evaluator validates backend-generated rebalance proposals against:
 * - Market admission (cold-start rules)
 * - Cost gate (movement costs vs expected gain)
 * - Reserve policy (idle reserve bounds)
 * - Adapter caps (per-adapter allocation limits)
 *
 * Valid proposals are signed with the SRCLA keeper key for execution.
 */
import { Wallet, ethers } from 'ethers';
import { loadConfig } from '../config.js';
import { ChainClient } from '../chain/client.js';
import { evaluatePolicyGate, type ReleaseGateResult } from './release-gates.js';

export interface Action {
  index: number;
  kind: 'deploy' | 'divest' | 'harvest' | 'emergency';
  adapter: string;
  amount: bigint;
  minOut: bigint;
}

export interface RebalanceProposal {
  id: string;
  actions: Action[];
  targetReserve: bigint;
}

export interface PolicyChecks {
  admissionPassed: boolean;
  costGatePassed: boolean;
  reservePassed: boolean;
  capsPassed: boolean;
}

export interface ProposalEvaluation {
  proposalId: string;
  valid: boolean;
  reasons: string[];
  policyChecks: PolicyChecks;
  releaseGate?: ReleaseGateResult;
  signature?: string;
}

/**
 * Vault state for proposal evaluation
 */
export interface EvaluatorVaultState {
  totalAssets: bigint;
  idleBase: bigint;
  strategyBalances: Map<string, bigint>;
  totalShares: bigint;
  /** Share price in WAD (18 decimals) */
  sharePrice: bigint;
}

/**
 * SRCLA Proposal Evaluator
 *
 * Validates backend proposals against vault state and signs valid ones.
 */
export class ProposalEvaluator {
  private chainClient: ChainClient;
  private config: ReturnType<typeof loadConfig>;
  private keeperWallet?: Wallet;

  constructor(config: ReturnType<typeof loadConfig>) {
    this.config = config;
    this.chainClient = new ChainClient({
      rpcUrl: config.baseRpcUrl,
      chainId: config.chainId,
    });

    // Initialize keeper wallet for signing
    const keeperKey = process.env.KEEPER_PRIVATE_KEY;
    if (keeperKey) {
      this.keeperWallet = new Wallet(keeperKey);
    }
  }

  /**
   * Review a rebalance proposal against current vault state
   * Implements paper §4: "SRCLA reviews proposals from backend"
   */
  async reviewProposal(proposal: RebalanceProposal): Promise<ProposalEvaluation> {
    const reasons: string[] = [];

    // 1. Fetch current vault state
    const state = await this.getCurrentVaultState();

    // 2. Run admission checks
    const admissionPassed = await this.checkAdmission(state, proposal);
    if (!admissionPassed) {
      reasons.push('Market admission check failed');
    }

    // 3. Verify cost gate
    const costGatePassed = await this.checkCostGate(state, proposal);
    if (!costGatePassed) {
      reasons.push('Cost gate check failed');
    }

    // 4. Verify reserve policy
    const reservePassed = await this.checkReserve(state, proposal);
    if (!reservePassed) {
      reasons.push('Reserve policy check failed');
    }

    // 5. Verify adapter caps
    const capsPassed = await this.checkCaps(state, proposal);
    if (!capsPassed) {
      reasons.push('Adapter cap check failed');
    }

    const valid = admissionPassed && costGatePassed && reservePassed && capsPassed;

    // 6. Sign if valid
    let signature: string | undefined;
    if (valid && this.keeperWallet) {
      signature = await this.signProposal(proposal);
    }

    return {
      proposalId: proposal.id,
      valid,
      reasons,
      policyChecks: {
        admissionPassed,
        costGatePassed,
        reservePassed,
        capsPassed,
      },
      ...(signature !== undefined && { signature }),
    };
  }

  /**
   * Review proposal with additional release gate checks
   * Combines policy checks with SRCLA's release gate evaluation
   */
  async reviewProposalWithGates(
    proposal: RebalanceProposal,
    releaseGateInput?: {
      safetyViolations: number;
      pValue: number;
      srclaAPY: number;
      b0APY: number;
      srclaSharpe: number;
    }
  ): Promise<ProposalEvaluation> {
    const evaluation = await this.reviewProposal(proposal);

    if (releaseGateInput) {
      const releaseGate = evaluatePolicyGate(releaseGateInput);
      evaluation.releaseGate = releaseGate;

      // Update validity based on release gate
      if (!releaseGate.passed) {
        evaluation.valid = false;
        evaluation.reasons.push(`Release gate failed: ${releaseGate.blockedReason}`);
      }
    }

    return evaluation;
  }

  /**
   * Sign a proposal with keeper wallet (EIP-191)
   */
  private async signProposal(proposal: RebalanceProposal): Promise<string> {
    if (!this.keeperWallet) {
      throw new Error('Keeper wallet not configured');
    }

    // Sign the proposal hash
    const message = this.hashProposal(proposal);
    const signature = await this.keeperWallet.signMessage(message);

    return signature;
  }

  /**
   * Hash proposal for signing
   */
  private hashProposal(proposal: RebalanceProposal): string {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'tuple(uint256,uint8,address,uint256,uint256)[]', 'uint256'],
      [
        proposal.id,
        proposal.actions.map((a) => [
          a.index,
          this.kindToNumber(a.kind),
          a.adapter,
          a.amount,
          a.minOut,
        ]),
        proposal.targetReserve,
      ]
    );

    return ethers.keccak256(encoded);
  }

  /**
   * Get current vault state from chain
   */
  private async getCurrentVaultState(): Promise<EvaluatorVaultState> {
    const vaultAddress = this.config.vaultAddress;

    // Get strategy addresses from config
    const strategyAddresses = [
      this.config.aaveStrategyAddress,
      this.config.compoundStrategyAddress,
      this.config.moonwellStrategyAddress,
    ].filter(Boolean);

    // Fetch all vault state in parallel
    const [totalAssets, idleBase, totalShares] = await Promise.all([
      this.chainClient.call(vaultAddress, ethers.concat([
        '0xf2b3c8b7', // totalAssets()
      ])),
      this.chainClient.call(vaultAddress, ethers.concat([
        '0x4704b6a3', // idle()
      ])),
      this.chainClient.call(vaultAddress, ethers.concat([
        '0x18160ddd', // totalSupply()
      ])),
    ]);

    // Fetch strategy balances
    const strategyBalances = new Map<string, bigint>();
    for (const adapter of strategyAddresses) {
      if (adapter) {
        const balance = await this.chainClient.call(vaultAddress, ethers.concat([
          '0x3f426dc0', // adapterBalances(address)
          ethers.zeroPadValue(adapter, 32),
        ]));
        strategyBalances.set(adapter, BigInt(balance));
      }
    }

    // Calculate share price (convert 1 share to assets)
    const sharePriceRaw = await this.chainClient.call(vaultAddress, ethers.concat([
      '0x8f5d2e6e', // convertToAssets(uint256)
      ethers.zeroPadValue('0x1', 32), // 1e18 shares
    ]));
    const sharePrice = BigInt(sharePriceRaw);

    return {
      totalAssets: BigInt(totalAssets),
      idleBase: BigInt(idleBase),
      strategyBalances,
      totalShares: BigInt(totalShares),
      sharePrice,
    };
  }

  private kindToNumber(kind: string): number {
    const map: Record<string, number> = { deploy: 0, divest: 1, harvest: 2, emergency: 3 };
    return map[kind] ?? 0;
  }

  /**
   * Check market admission (cold-start rules)
   * Paper §6.1: "Cold-start rules"
   */
  private async checkAdmission(
    _state: EvaluatorVaultState,
    _proposal: RebalanceProposal
  ): Promise<boolean> {
    // Cold-start admission check would require:
    // 1. Getting market observation counts from database
    // 2. Checking first observation dates
    // 3. Applying cold-start eligibility rules

    // For now, return true - full implementation would check:
    // - Market has sufficient observations (>= 30)
    // - Market has passed cold-start period (>= 7 days)
    // - Markets in cold-start get reduced capacity

    // TODO: Implement full cold-start admission check
    // Requires database access to count observations per market

    return true;
  }

  /**
   * Check cost gate (movement costs vs expected gain)
   * Paper §9.1: "Cost gate"
   */
  private async checkCostGate(state: EvaluatorVaultState, proposal: RebalanceProposal): Promise<boolean> {
    const srclaConfig = this.config.srcla;

    // Estimate total cost of actions
    const totalCost = this.estimateTotalCost(proposal.actions);

    // Calculate expected idle after proposal
    const deployTotal = proposal.actions
      .filter((a) => a.kind === 'deploy')
      .reduce((sum, a) => sum + a.amount, 0n);

    const divestTotal = proposal.actions
      .filter((a) => a.kind === 'divest')
      .reduce((sum, a) => sum + a.amount, 0n);

    // Net idle change
    const netIdleChange = divestTotal - deployTotal;
    const expectedIdle = state.idleBase + netIdleChange;

    // Check against reserve floor
    const reserveFloor = (state.totalAssets * BigInt(srclaConfig.reserveFloorBps)) / 10000n;

    // Proposal must not push idle below floor (unless it's a divest to raise idle)
    if (expectedIdle < reserveFloor && netIdleChange < 0n) {
      return false;
    }

    // Check minimum threshold
    if (totalCost < srclaConfig.costGateMinThreshold) {
      return true; // Below minimum threshold, automatically passes
    }

    // TODO: Compare cost against expected gain from better rates
    // The cost gate should compare:
    // - Cost of moving funds (gas + slippage + MEV)
    // - Expected gain from better rate over forecast horizon

    // For now, use simple threshold-based gate
    const maxAllowedCost = (state.totalAssets * BigInt(srclaConfig.costGateSlippageBps + srclaConfig.costGateMevBps)) / 10000n;

    return totalCost <= maxAllowedCost;
  }

  /**
   * Check reserve policy
   * Paper §8.1: "Dynamic reserve"
   */
  private async checkReserve(state: EvaluatorVaultState, proposal: RebalanceProposal): Promise<boolean> {
    const srclaConfig = this.config.srcla;

    // Calculate expected idle after proposal
    const deployTotal = proposal.actions
      .filter((a) => a.kind === 'deploy')
      .reduce((sum, a) => sum + a.amount, 0n);

    const divestTotal = proposal.actions
      .filter((a) => a.kind === 'divest')
      .reduce((sum, a) => sum + a.amount, 0n);

    const netIdleChange = divestTotal - deployTotal;
    const expectedIdle = state.idleBase + netIdleChange;

    // Check against reserve floor
    const reserveFloor = (state.totalAssets * BigInt(srclaConfig.reserveFloorBps)) / 10000n;
    if (expectedIdle < reserveFloor) {
      return false;
    }

    // Check against target reserve
    if (proposal.targetReserve > 0n) {
      // Target reserve should be within reasonable bounds
      const reserveCeiling = (state.totalAssets * 10000n) / 10000n; // 100% max
      if (proposal.targetReserve > reserveCeiling) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check adapter caps
   * Paper §5.2: "Adapter caps"
   */
  private async checkCaps(state: EvaluatorVaultState, proposal: RebalanceProposal): Promise<boolean> {
    // Track proposed balances for cap checking
    const proposedBalances = new Map(state.strategyBalances);

    for (const action of proposal.actions) {
      if (action.kind === 'deploy') {
        const currentBalance = proposedBalances.get(action.adapter) ?? 0n;
        const newBalance = currentBalance + action.amount;

        // Check against 50% per-adapter cap
        const maxAdapterBalance = (state.totalAssets * 5000n) / 10000n;
        if (newBalance > maxAdapterBalance) {
          return false;
        }

        proposedBalances.set(action.adapter, newBalance);
      } else if (action.kind === 'divest') {
        const currentBalance = proposedBalances.get(action.adapter) ?? 0n;
        const newBalance = currentBalance - action.amount;

        // Cannot divest more than current balance
        if (newBalance < 0n) {
          return false;
        }

        proposedBalances.set(action.adapter, newBalance);
      }
    }

    // Check total deployment doesn't exceed 100% of assets
    const totalDeployed = Array.from(proposedBalances.values()).reduce((sum, b) => sum + b, 0n);
    if (totalDeployed > state.totalAssets) {
      return false;
    }

    return true;
  }

  /**
   * Estimate total cost of actions
   */
  private estimateTotalCost(actions: Action[]): bigint {
    const srclaConfig = this.config.srcla;

    let totalCost = 0n;

    for (const action of actions) {
      const cost = this.estimateActionCost(action, srclaConfig);
      totalCost += cost;
    }

    return totalCost;
  }

  /**
   * Estimate cost for a single action
   */
  private estimateActionCost(action: Action, srclaConfig: ReturnType<typeof loadConfig>['srcla']): bigint {
    const gasLimit = srclaConfig.costGateGasLimit;
    const gasPrice = 30_000_000_000n; // 30 gwei

    const gasCost = gasLimit * gasPrice;

    // Slippage cost (based on amount and slippage bps)
    const slippageBps = BigInt(srclaConfig.costGateSlippageBps);
    const slippageCost = (action.amount * slippageBps) / 10000n;

    // MEV cost
    const mevBps = BigInt(srclaConfig.costGateMevBps);
    const mevCost = (action.amount * mevBps) / 10000n;

    return gasCost + slippageCost + mevCost;
  }

  /**
   * Close resources
   */
  close(): void {
    this.chainClient.close();
  }
}

/**
 * Create a proposal evaluator instance
 */
export function createProposalEvaluator(): ProposalEvaluator {
  const config = loadConfig();
  return new ProposalEvaluator(config);
}
