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
import {
  evaluateRegisteredRelease,
  type RegisteredGateOptions,
  type RegisteredGateResult,
} from './kernel/gates.js';
import type { RegisteredEvaluationResult } from './kernel/harness.js';
import { DEFAULT_DECIDE_OPTS } from '../policy/decide.js';
import { movementCostBase, type Move } from '../policy/steps/cost.js';
import type { DecisionInput } from '../policy/types.js';

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
  /**
   * §11.5's policy gate, when the caller supplied a registered evaluation to
   * gate against. There is now exactly ONE implementation of it —
   * `kernel/gates.ts#evaluateRegisteredRelease` — shared by the registered
   * run and by this operator path.
   */
  releaseGate?: RegisteredGateResult;
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
   * Review a proposal AND gate it against §11.5's policy gate.
   *
   * WHY THIS TAKES A REGISTERED RUN. It used to take five hand-supplied
   * scalars — `{safetyViolations, pValue, srclaAPY, b0APY, srclaSharpe}` —
   * and feed them to a second, weaker implementation of the gate in
   * `release-gates.ts`: B0 only, one p-value, and a hardcoded `Sharpe >= 0.5`
   * that appears nowhere in the paper. That reinstated exactly the
   * optimiser/grader divergence P10 removed — the registered evaluation was
   * graded by `kernel/gates.ts` while the operator endpoint graded the same
   * release by something else, so the two could disagree about whether a
   * policy was releasable and nothing would notice.
   *
   * There is now one definition. The caller passes the registered evaluation
   * result (the same object `runRegisteredEvaluation` produces) and gets the
   * same three-valued verdict, with the same absence-is-failure rule, that
   * the report publishes. Omitting it means no gate was run — which leaves
   * `releaseGate` undefined rather than fabricating a pass.
   */
  async reviewProposalWithGates(
    proposal: RebalanceProposal,
    evaluationResult?: RegisteredEvaluationResult,
    gateOptions?: RegisteredGateOptions
  ): Promise<ProposalEvaluation> {
    const evaluation = await this.reviewProposal(proposal);

    if (evaluationResult) {
      const releaseGate = evaluateRegisteredRelease(evaluationResult, gateOptions ?? {});
      evaluation.releaseGate = releaseGate;

      // A `null` check is NOT PRODUCED, and `pass` already refuses to roll one
      // up into a verdict — so this branch fires on "did not verify", which
      // covers both FAILED and NOT PRODUCED.
      if (!releaseGate.pass) {
        evaluation.valid = false;
        evaluation.reasons.push(
          `Release gate did not verify: ${releaseGate.blockedReasons.join('; ')}`
        );
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
    proposal: RebalanceProposal
  ): Promise<boolean> {
    // Validate adapter targets in proposal are valid address inputs and non-null
    for (const action of proposal.actions) {
      if (!action.adapter || !ethers.isAddress(action.adapter)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check cost gate (movement costs vs expected gain)
   * Paper §9.1: "Cost gate"
   */
  private async checkCostGate(state: EvaluatorVaultState, proposal: RebalanceProposal): Promise<boolean> {
    const srclaConfig = this.config.srcla;

    // Estimate total cost of actions
    const totalCost = await this.estimateTotalCost(proposal.actions, state);

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

    // R34 FIX (defect 2 of 2): the threshold used to be
    // `totalAssets * (slippageBps + mevBps) / 10000` — a PORTFOLIO-scaled
    // bound compared against a MOVEMENT-scaled cost. Because
    // `costGateSlippageBps`/`costGateMevBps` are small constants (tens of
    // bps), that made the gate nearly independent of how much was actually
    // being moved: a tiny rebalance of a large vault got the same generous
    // ceiling as a proposal moving the whole vault. A cost gate must scale
    // its tolerance with the size of the move it is gating, not with the
    // size of the vault.
    //
    // Fixed by scaling the SAME bps knobs off the total notional the
    // proposal actually moves (every action's amount — deploy, divest,
    // harvest and emergency alike, matching what `estimateTotalCost` prices)
    // instead of `state.totalAssets`. This needs no new registered constant
    // (the existing `costGateSlippageBps`/`costGateMevBps` config already
    // exist for this purpose); the §9.1 payback-period framing
    // (`paybackSeconds` on a registered `PolicyArtifact`) was considered but
    // is unnecessary here since a movement-scaled bps bound is already
    // dimensionally correct, and pulling in artifact/rate-curve machinery
    // for a coarse portfolio-level backstop would be a materially bigger
    // change than this defect calls for.
    const movedNotional = proposal.actions.reduce((sum, a) => sum + a.amount, 0n);
    const maxAllowedCost = (movedNotional * BigInt(srclaConfig.costGateSlippageBps + srclaConfig.costGateMevBps)) / 10000n;
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
   * Estimate total cost of actions.
   *
   * R34 FIX (defect 1 of 2): this used to charge `slippageBps`/`mevBps` of
   * NOTIONAL against every action, including `deploy`/`divest` — i.e. it
   * priced a lending supply/withdraw as though it were a swap. A lending
   * deposit or withdrawal executes at the protocol's own index: there is no
   * quoted price to slip against, no counterparty spread, and no sandwich
   * surface, and the rate consequence of size is already priced by the
   * post-deposit capacity curve elsewhere in the policy — so bps-of-notional
   * on those legs both invented a cost and double-counted that curve. This
   * was the fourth surviving copy of that defect; the other three
   * (`policy/steps/cost.ts#movementCostBase`, and its callers in
   * `policy/steps/hurdles.ts` / `policy/harvest.ts` / `forecast/decision-
   * score.ts`) already attribute impact/slippage/MEV to the `harvest`
   * (reward-swap) leg only. Re-pointing this call site at that single model
   * rather than re-deriving a fifth one.
   *
   * `movementCostBase` only reads `input.gas` off its `DecisionInput`
   * argument (see its body) — it never touches `origin`/`vault`/`markets`/
   * `dependencyGroups`/`withdrawals`/`history`/`lastAction`. Those fields
   * are still required by the type, so they are filled with honestly-labelled
   * placeholders below (some, like `vault`, from the real state this method
   * already fetched) rather than left to silently coerce; if a future change
   * to `movementCostBase` starts reading them, this call site would need
   * those real values plumbed in from the runtime driver — it cannot
   * currently source per-origin market/gas-oracle/last-action state itself.
   *
   * Gas/oracle inputs mirror the exact pattern `src/index.ts`'s `loadOrigin`
   * uses for the live decision path: the L2 base fee is read live off the
   * RPC, and L1 blob fee / ETH-USD / USDC-USD are the registered
   * `SRCLA_REAL_*` config placeholders (`config.srcla.placeholder*`) — not a
   * fabricated fifth set of numbers.
   *
   * Cost params are `DEFAULT_DECIDE_OPTS.cost` (`policy/decide.ts`) verbatim
   * — the one registered `CostParams` the live decision path itself uses —
   * rather than the narrower, operator-local `costGate{GasLimit,
   * SlippageBps,MevBps}` config, which priced only gas+bps per action and
   * cannot express `movementCostBase`'s eleven §9.1 terms.
   */
  private async estimateTotalCost(actions: Action[], state: EvaluatorVaultState): Promise<bigint> {
    if (actions.length === 0) return 0n;

    const gas = {
      l2BaseFeeWei: await this.chainClient.getGasPrice(),
      l1BaseFeeWei: this.config.srcla.placeholderL1BaseFeeWei,
      l1BlobBaseFeeWei: this.config.srcla.placeholderL1BlobBaseFeeWei,
      ethUsdE8: this.config.srcla.placeholderEthUsdE8,
      usdcUsdE8: this.config.srcla.placeholderUsdcUsdE8,
    };

    // Placeholder DecisionInput fields movementCostBase does not read (see
    // the method comment above) — `vault` is filled from the real state
    // already fetched by the caller since it costs nothing to be accurate,
    // the rest are inert empties.
    const input: DecisionInput = {
      origin: {
        blockNumber: 0,
        blockHash: ethers.ZeroHash,
        timestampSeconds: Math.floor(Date.now() / 1000),
        finalized: true,
      },
      vault: {
        totalAssetsBase: state.totalAssets,
        idleBase: state.idleBase,
        sharesOutstanding: state.totalShares,
        adminReserveBase: 0n,
        dynamicReserveBase: 0n,
        minIdleBps: 0,
        paused: false,
        configurationDigest: '',
      },
      markets: [],
      dependencyGroups: [],
      withdrawals: [],
      gas,
      history: [],
      lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
    };

    // `emergency` has no equivalent in `Move.kind` — it is an exit from an
    // adapter (contract-side ActionKind 3, `kindToNumber` below), so it is
    // priced as a `divest` for gas purposes; like `deploy`/`divest`, it
    // carries no impact/slippage/MEV term in `movementCostBase`.
    const moves: Move[] = actions.map((a) => ({
      adapter: a.adapter,
      amountBase: a.amount,
      kind: a.kind === 'emergency' ? 'divest' : a.kind,
    }));

    return movementCostBase(input, moves, DEFAULT_DECIDE_OPTS.cost).totalBase;
  }

  /**
   * Close resources
   */
  close(): void {
    this.chainClient.close();
  }
}
