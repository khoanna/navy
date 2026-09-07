import { portfolioLowerBound } from './optimize.js';
import type { CostGateResult, DecisionInput, PolicyArtifact, RateCurve } from '../types.js';

const WAD = 10n ** 18n;
const WEI_PER_ETH = 10n ** 18n;

/**
 * Base has posted L2 transaction data via EIP-4844 blobs since the Ecotone
 * upgrade, not via L1 calldata - so the L1 data term below is priced off
 * `gas.l1BlobBaseFeeWei`, never `gas.l1BaseFeeWei`. `l1BaseFeeWei` stays on
 * `GasObservation` (kept for a future non-blob or fallback consumer) but
 * this cost model does not read it - that omission is intentional, not an
 * oversight; see the FINDING A note this was fixed against.
 *
 * BLOB_GAS_PER_BYTE approximates BLOB_GAS_PER_BLOB (131,072 = 2^17) divided
 * by the usable bytes in one blob (4096 field elements * 31 usable
 * bytes/element = 126,976), which is ~1.03 - rounded down to 1 for integer
 * bigint math. That is a ~3% conservative-but-negligible undercount, and
 * immaterial next to the bps-of-notional terms (impact, slippageMev), which
 * dominate C_move on this chain.
 */
const BLOB_GAS_PER_BYTE = 1n;

/**
 * §9.1 - C_move has exactly these eleven components, in the paper's own
 * order. Kept as a single source of truth so a caller can walk `terms` in
 * the order the formula lists them and see which component dominated.
 */
export const MOVE_COST_TERMS = [
  'l2', 'l1Data', 'exit', 'entry', 'claim',
  'approveReset', 'swap', 'impact', 'slippageMev', 'failure', 'buffer',
] as const;

export interface CostParams {
  cooldownSeconds: number;
  minTurnoverBps: number;
  maxTurnoverBps: number;
  slippageBps: number;
  mevBps: number;
  impactBps: number;
  failureRateBps: number;
  bufferBps: number;
  /**
   * Per-protocol-call gas: the adapter's own deposit/withdraw/claim
   * execution, priced into `exit`/`entry`/`claim` below. Deliberately NOT
   * used for `l2` - see `planGasOverhead`/`actionDispatchGas`, which price
   * a structurally different cost (submitting the plan and dispatching each
   * action), not the protocol call itself. Reusing this single rate for
   * both was FINDING 1: `l2` collapsed to an exact duplicate of
   * `exit + entry + claim`.
   */
  gasPerAction: bigint;
  /** Flat, once-per-plan gas: submitting the plan header (`submitPlan` in
   *  contract/src/NavyVaultSRCLA.sol writes ~12 storage words for the
   *  PlanHeader plus a PlanSubmitted event) - independent of action count. */
  planGasOverhead: bigint;
  /** Per-action gas for the `executeAction` dispatch wrapper itself -
   *  Merkle proof verification, next-index bookkeeping, and the
   *  ActionExecuted event - EXCLUDING the protocol call the action performs
   *  (that is `exit`/`entry`/`claim`, priced via `gasPerAction`). */
  actionDispatchGas: bigint;
  /** Per-harvest gas for ONE approve or reset call (the term multiplies by
   *  2 internally: approve then zero-reset, per §9.4). FINDING 2: was
   *  hardcoded to 50,000 inline; now a caller-supplied parameter. */
  approveResetGas: bigint;
  /** Per-harvest gas for the reward-executor swap call. FINDING 2: was
   *  hardcoded to 180,000 inline; now a caller-supplied parameter. */
  swapGas: bigint;
  l1BytesPerAction: bigint;
}

export interface Move {
  adapter: string;
  amountBase: bigint;
  kind: 'deploy' | 'divest' | 'harvest';
}

/**
 * Convert a wei amount to USDC base units using the origin's own oracle
 * round (`input.gas.ethUsdE8` / `usdcUsdE8`) - never a hardcoded price.
 * wei * (ETH/USD, e8) / 1e18 -> USD (e8); * 1e6 / (USDC/USD, e8) -> USDC
 * base units (6 decimals).
 */
function weiToUsdcBase(wei: bigint, ethUsdE8: bigint, usdcUsdE8: bigint): bigint {
  const usdE8 = (wei * ethUsdE8) / WEI_PER_ETH;
  return (usdE8 * 1_000_000n) / usdcUsdE8;
}

/**
 * §9.1 - the eleven-term movement cost, computed entirely from `input.gas`
 * (the decision origin's own gas/oracle observation) and the proposed
 * `moves`. Both the L2 execution term and the L1 data-availability term are
 * derived from live fee observations - Base posts data to L1 via EIP-4844
 * blobs (see BLOB_GAS_PER_BYTE above), so the L1 term is a real, distinct
 * cost on this chain, not a rounding nicety (constraint 3) - just a much
 * smaller one post-Ecotone than the pre-blob calldata model implied.
 */
export function movementCostBase(
  input: DecisionInput,
  moves: Move[],
  p: CostParams
): { totalBase: bigint; terms: Record<string, bigint> } {
  const n = BigInt(moves.length);
  const notional = moves.reduce((s, m) => s + m.amountBase, 0n);
  const { gas } = input;

  const divestCount = BigInt(moves.filter((m) => m.kind === 'divest').length);
  const deployCount = BigInt(moves.filter((m) => m.kind === 'deploy').length);
  const harvestCount = BigInt(moves.filter((m) => m.kind === 'harvest').length);

  // FINDING 1 - C_L2 is plan-level execution overhead: submitting the plan
  // once (`planGasOverhead`) plus dispatching each action through
  // `executeAction` (`actionDispatchGas` per action - proof verification +
  // bookkeeping, NOT the protocol call the action performs). This must
  // share no term with `exit`/`entry`/`claim` below, which price the
  // protocol call itself via the separate `gasPerAction` rate - reusing
  // that rate here made `l2` an exact duplicate of `exit + entry + claim`
  // (caught by the non-overlap test).
  const l2Wei = (p.planGasOverhead + n * p.actionDispatchGas) * gas.l2BaseFeeWei;
  // Data-availability cost, priced via the blob base fee (see
  // BLOB_GAS_PER_BYTE above) - a genuine second fee market on Base, not a
  // scaled-up copy of the L2 term. `p.l1BytesPerAction` should be sized to
  // one `executeAction` call (contract/src/NavyVaultSRCLA.sol): a 4-byte
  // selector + 7 x 32-byte fixed args (planId, actionIndex, kind, adapter,
  // amount, minOut, dataHash) + a dynamic bytes32[] proof (32-byte offset +
  // 32-byte length + up to ~3 x 32-byte siblings for the <=8-leaf plans the
  // <=3-market universe produces) = 4 + 224 + 64 + 96 = 388 bytes, not the
  // multi-KB a whole plan submission would carry.
  //
  // At the EIP-4844 protocol-floor blob base fee (1 wei), this term rounds
  // to exactly 0n in USDC's 6-decimal resolution. That is the economically
  // correct answer, not a precision defect - the true cost genuinely sits
  // below six-decimal resolution at floor blob fees, and it does not recur
  // at realistic (non-floor) blob fees. Do not "fix" this into a fabricated
  // non-zero floor.
  const l1Wei = n * p.l1BytesPerAction * BLOB_GAS_PER_BYTE * gas.l1BlobBaseFeeWei;
  // The blob-based model above approximates Base's actual Ecotone L1-fee
  // formula, which blends `l1BaseFeeWei` and `l1BlobBaseFeeWei` through two
  // independently governed scalars (`baseFeeScalar`, `blobBaseFeeScalar`) -
  // neither of which `GasObservation` carries. This is a deliberate
  // simplification (single blob-gas-per-byte rate, no base-fee blend), not
  // a literal reproduction of the two-scalar formula.
  const exitWei = divestCount * p.gasPerAction * gas.l2BaseFeeWei;
  const entryWei = deployCount * p.gasPerAction * gas.l2BaseFeeWei;
  const claimWei = harvestCount * p.gasPerAction * gas.l2BaseFeeWei;
  // A reward harvest needs an approve + a zero-reset (§9.4 - "every swap
  // uses an exact token allowance and resets it to zero") plus the swap
  // itself; both are flat per-harvest gas costs, not scaled by notional.
  // FINDING 2 - gas limits are caller-supplied params, not hardcoded.
  const approveResetWei = harvestCount * 2n * p.approveResetGas * gas.l2BaseFeeWei;
  const swapWei = harvestCount * p.swapGas * gas.l2BaseFeeWei;

  const bpsOf = (bps: number) => (notional * BigInt(bps)) / 10_000n;

  const terms: Record<string, bigint> = {
    l2: weiToUsdcBase(l2Wei, gas.ethUsdE8, gas.usdcUsdE8),
    l1Data: weiToUsdcBase(l1Wei, gas.ethUsdE8, gas.usdcUsdE8),
    exit: weiToUsdcBase(exitWei, gas.ethUsdE8, gas.usdcUsdE8),
    entry: weiToUsdcBase(entryWei, gas.ethUsdE8, gas.usdcUsdE8),
    claim: weiToUsdcBase(claimWei, gas.ethUsdE8, gas.usdcUsdE8),
    approveReset: weiToUsdcBase(approveResetWei, gas.ethUsdE8, gas.usdcUsdE8),
    swap: weiToUsdcBase(swapWei, gas.ethUsdE8, gas.usdcUsdE8),
    impact: bpsOf(p.impactBps),
    slippageMev: bpsOf(p.slippageBps + p.mevBps),
    failure: 0n,
    buffer: 0n,
  };

  // C_failure: expected cost of a reverted action still burning gas. Scaled
  // off the execution-only terms already computed above (not impact/
  // slippage/buffer, which are paid only on a successful fill).
  const executionSoFar = terms['l2']! + terms['l1Data']! + terms['exit']! + terms['entry']! + terms['claim']!;
  terms['failure'] = (executionSoFar * BigInt(p.failureRateBps)) / 10_000n;

  // C_buffer is a fixed haircut over every other term, so it is computed
  // last, once every other term (failure included) is final.
  const beforeBuffer = MOVE_COST_TERMS.reduce((s, k) => (k === 'buffer' ? s : s + terms[k]!), 0n);
  terms['buffer'] = (beforeBuffer * BigInt(p.bufferBps)) / 10_000n;

  const totalBase = MOVE_COST_TERMS.reduce((s, k) => s + terms[k]!, 0n);
  return { totalBase, terms };
}

/**
 * P8 - the no-trade band k*sigma_hat. sigma_hat is the calibrated dispersion
 * of portfolio horizon residuals - the same `portfolioResidualQuantileWad`
 * the frozen artifact already carries (it is <= 0 by convention; the band
 * uses its magnitude). k is the artifact's registered `noTradeBandK`,
 * scaled by 1e6 for integer bigint arithmetic since it is a float.
 *
 * On a low-fee chain C_move alone does not suppress churn (paper §9.1); this
 * term is what actually does, so it must scale with the notional being
 * moved, not be a flat dollar constant.
 */
export function noTradeBandBase(
  _input: DecisionInput,
  _curves: RateCurve[],
  artifact: PolicyArtifact,
  notionalBase: bigint
): bigint {
  const sigma = artifact.portfolioResidualQuantileWad < 0n
    ? -artifact.portfolioResidualQuantileWad
    : artifact.portfolioResidualQuantileWad;
  const kFixed = BigInt(Math.round(artifact.noTradeBandK * 1_000_000));
  return (sigma * notionalBase * kFixed) / (WAD * 1_000_000n);
}

/** Diffs `target` against `current` into the discrete moves the cost model prices. */
function movesFrom(current: Map<string, bigint>, target: Map<string, bigint>, input: DecisionInput): Move[] {
  const moves: Move[] = [];
  const ids = [...new Set([...current.keys(), ...target.keys()])].sort();
  for (const id of ids) {
    // Signed by construction (a divest is negative); branched on sign below
    // before ever being used as a magnitude, so this is never treated as an
    // unsigned quantity that could silently go negative.
    const delta = (target.get(id) ?? 0n) - (current.get(id) ?? 0n);
    if (delta === 0n) continue;
    const adapter = input.markets.find((m) => m.marketId === id)?.adapter ?? id;
    moves.push({ adapter, amountBase: delta > 0n ? delta : -delta, kind: delta > 0n ? 'deploy' : 'divest' });
  }
  return moves;
}

/**
 * §9.1 - the action rule G_H > max(C_move, k*sigma), gated by cooldown and
 * turnover bounds. Each gate is checked independently and returns its own
 * `reason` so a caller can tell which constraint actually blocked the move
 * (constraint 4) - a move is never rejected for an unstated reason.
 */
export function costGate(
  input: DecisionInput,
  curves: RateCurve[],
  artifact: PolicyArtifact,
  current: Map<string, bigint>,
  target: Map<string, bigint>,
  p: CostParams
): CostGateResult {
  const moves = movesFrom(current, target, input);
  const notional = moves.reduce((s, m) => s + m.amountBase, 0n);
  const { totalBase: moveCostBase, terms } = movementCostBase(input, moves, p);
  const bandBase = noTradeBandBase(input, curves, artifact, notional);

  // Signed difference of two conservative lower bounds: legitimately
  // negative when the target is worse than the status quo (a loss), which
  // the threshold comparison below handles correctly without clamping.
  const gainBase =
    portfolioLowerBound(input, curves, artifact, target) -
    portfolioLowerBound(input, curves, artifact, current);

  const fail = (reason: string): CostGateResult =>
    ({ passed: false, reason, gainBase, moveCostBase, bandBase, terms });

  if (moves.length === 0) return fail('NO_MOVES: target equals current');

  const last = input.lastAction.timestampSeconds;
  if (last !== null && input.origin.timestampSeconds - last < p.cooldownSeconds) {
    return fail(`COOLDOWN: ${input.origin.timestampSeconds - last}s < ${p.cooldownSeconds}s`);
  }

  const minTurnover = (input.vault.totalAssetsBase * BigInt(p.minTurnoverBps)) / 10_000n;
  if (notional < minTurnover) return fail(`MIN_TURNOVER: ${notional} < ${minTurnover}`);

  const maxTurnover = (input.vault.totalAssetsBase * BigInt(p.maxTurnoverBps)) / 10_000n;
  if (input.lastAction.turnoverWindowBase + notional > maxTurnover) {
    return fail(`MAX_TURNOVER: ${notional} would push the rolling window above ${maxTurnover}`);
  }

  const threshold = moveCostBase > bandBase ? moveCostBase : bandBase;
  if (gainBase <= threshold) {
    const which = bandBase >= moveCostBase ? 'NO_TRADE_BAND' : 'MOVE_COST';
    return fail(`${which}: gain ${gainBase} <= threshold ${threshold}`);
  }

  return { passed: true, reason: 'GAIN_EXCEEDS_THRESHOLD', gainBase, moveCostBase, bandBase, terms };
}
