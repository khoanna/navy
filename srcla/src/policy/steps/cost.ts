import type { CostGateResult, DecisionInput, MoveRecord, PolicyArtifact, RateCurve } from '../types.js';

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
  /**
   * Length of the rolling window `lastAction.turnoverWindowBase` is summed
   * over. It lives on CostParams rather than only in the loader so exactly
   * one value governs BOTH the window that is measured
   * (`runtime/decision-driver.ts#loadLastAction`, which reads this same
   * `CostParams`) and the window the gate's rejection message names. A
   * loader window that disagreed with the gate's would produce a
   * `MAX_TURNOVER` rejection quoting a bound it did not actually apply.
   */
  turnoverWindowSeconds: number;
  /**
   * §9.1's "reversal allowance", the third churn brake. Over
   * `reversalWindowSeconds`, the ROUND-TRIP churn a venue may accumulate —
   * `sum |delta| - |sum delta|`, which is exactly zero for a monotone
   * build-up or wind-down and `2*min(up,down)` for a round trip — is capped
   * at this many basis points of total assets. See `reversalChurnBase`.
   *
   * This measure is deliberately not "notional moved": a policy that keeps
   * adding to a venue is not churning, and capping it on notional would
   * duplicate MAX_TURNOVER rather than add anything.
   */
  reversalWindowSeconds: number;
  reversalAllowanceBps: number;
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

  // P14 - impact, slippage and MEV are properties of the §9.4 Uniswap route.
  // A lending supply/withdraw executes at the protocol index: there is no
  // quoted price to slip against and no sandwich surface, and the rate effect
  // of size is already priced by §6.1's post-deposit curve. Charging bps here
  // as well both invents a cost and double-counts that curve.
  const swapNotional = moves
    .filter((m) => m.kind === 'harvest')
    .reduce((s, m) => s + m.amountBase, 0n);
  const bpsOfSwap = (bps: number) => (swapNotional * BigInt(bps)) / 10_000n;

  const terms: Record<string, bigint> = {
    l2: weiToUsdcBase(l2Wei, gas.ethUsdE8, gas.usdcUsdE8),
    l1Data: weiToUsdcBase(l1Wei, gas.ethUsdE8, gas.usdcUsdE8),
    exit: weiToUsdcBase(exitWei, gas.ethUsdE8, gas.usdcUsdE8),
    entry: weiToUsdcBase(entryWei, gas.ethUsdE8, gas.usdcUsdE8),
    claim: weiToUsdcBase(claimWei, gas.ethUsdE8, gas.usdcUsdE8),
    approveReset: weiToUsdcBase(approveResetWei, gas.ethUsdE8, gas.usdcUsdE8),
    swap: weiToUsdcBase(swapWei, gas.ethUsdE8, gas.usdcUsdE8),
    impact: bpsOfSwap(p.impactBps),
    slippageMev: bpsOfSwap(p.slippageBps + p.mevBps),
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

const abs = (v: bigint): bigint => (v < 0n ? -v : v);

/**
 * §9.1's reversal allowance, as a measurable quantity.
 *
 * ROUND-TRIP CHURN over a window, per venue:
 *
 *     churn_i = sum_t |delta_{i,t}|  -  | sum_t delta_{i,t} |
 *
 * summed over venues. The identity that makes this the right statistic:
 * a monotone series (only deploys, or only divests) has
 * `sum|delta| == |sum delta|` and therefore contributes ZERO, while a
 * perfect round trip of size `a` contributes `2a`. So the allowance
 * restrains repeated entry and exit — which §9.1 says execution cost alone
 * does not suppress on a low-fee chain — without taxing a policy that
 * simply keeps building one position.
 *
 * The proposed move is folded in as one more delta at the origin, so the
 * budget is CUMULATIVE across the window rather than per-decision: a policy
 * cannot reverse the allowance once per cycle forever.
 *
 * Only records strictly inside `(originSeconds - windowSeconds,
 * originSeconds]` are counted. A record stamped after the origin is
 * discarded rather than counted, because it cannot be evidence available at
 * the origin (the same no-look-ahead rule `policy/input.ts` enforces on
 * labels).
 */
export function reversalChurnBase(
  recentMoves: readonly MoveRecord[],
  proposed: ReadonlyMap<string, bigint>,
  originSeconds: number,
  windowSeconds: number
): bigint {
  const windowStart = originSeconds - windowSeconds;
  const gross = new Map<string, bigint>();
  const net = new Map<string, bigint>();

  const add = (marketId: string, delta: bigint): void => {
    if (delta === 0n) return;
    gross.set(marketId, (gross.get(marketId) ?? 0n) + abs(delta));
    net.set(marketId, (net.get(marketId) ?? 0n) + delta);
  };

  for (const r of recentMoves) {
    if (r.timestampSeconds <= windowStart) continue;
    if (r.timestampSeconds > originSeconds) continue;
    add(r.marketId, r.deltaBase);
  }
  for (const [marketId, delta] of proposed) add(marketId, delta);

  let churn = 0n;
  for (const [marketId, g] of gross) churn += g - abs(net.get(marketId) ?? 0n);
  return churn;
}

/** Signed per-venue exposure deltas of a candidate, keyed by market id. */
function signedDeltas(current: ReadonlyMap<string, bigint>, target: ReadonlyMap<string, bigint>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const id of new Set([...current.keys(), ...target.keys()])) {
    const delta = (target.get(id) ?? 0n) - (current.get(id) ?? 0n);
    if (delta !== 0n) out.set(id, delta);
  }
  return out;
}

/**
 * §9.1's five brakes: cooldown, minimum turnover, maximum turnover and the
 * reversal allowance, plus the trivial no-op guard. Paper §9.1.4 is
 * explicit that these remain in force independently of the hurdles in
 * `steps/hurdles.ts`: "Cooldown, minimum turnover, maximum turnover, and
 * reversal allowances remain in force and prevent repeated small moves;
 * they bound the policy's aggregate behavior, whereas the hurdles above
 * decide individual legs." Partial adjustment does not subsume them.
 *
 * This is the brake ENFORCEMENT extracted from the pre-P13/P15/P16
 * `costGate` (now a throwing stub - see its own comment) so it keeps a
 * caller in `src/`, not just in tests: `reversalChurnBase` and
 * `signedDeltas` would otherwise be orphaned with the band's removal, and
 * the brakes themselves would exist only in git history despite the paper
 * requiring them. Task 4 is expected to call this from `decide.ts` alongside
 * `deployClears`/`rotateClears`.
 *
 * Each check is independent and returns its own reason string (unchanged
 * from the pre-existing `costGate` messages, so any caller or test that
 * matched on them still does) so a rejection is never attributed to an
 * unstated constraint. Returns `null` when nothing fires.
 *
 * `notional` is the same quantity the old `costGate` derived from
 * `movesFrom` - the sum of `|target_i - current_i|` over every venue whose
 * allocation changes, i.e. `notional === 0n` iff there is no move at all
 * (NO_MOVES). All four churn brakes read `input.lastAction`, which
 * `runtime/decision-driver.ts#loadLastAction` derives from persisted
 * decisions; they are inert only when there genuinely is no history.
 */
export function applyBrakes(
  input: DecisionInput,
  notional: bigint,
  current: ReadonlyMap<string, bigint>,
  target: ReadonlyMap<string, bigint>,
  p: CostParams,
): string | null {
  if (notional === 0n) return 'NO_MOVES: target equals current';

  const last = input.lastAction.timestampSeconds;
  if (last !== null && input.origin.timestampSeconds - last < p.cooldownSeconds) {
    return `COOLDOWN: ${input.origin.timestampSeconds - last}s < ${p.cooldownSeconds}s`;
  }

  const minTurnover = (input.vault.totalAssetsBase * BigInt(p.minTurnoverBps)) / 10_000n;
  if (notional < minTurnover) return `MIN_TURNOVER: ${notional} < ${minTurnover}`;

  const maxTurnover = (input.vault.totalAssetsBase * BigInt(p.maxTurnoverBps)) / 10_000n;
  if (input.lastAction.turnoverWindowBase + notional > maxTurnover) {
    return (
      `MAX_TURNOVER: ${notional} would push the ${p.turnoverWindowSeconds}s rolling window ` +
      `(${input.lastAction.turnoverWindowBase} already moved) above ${maxTurnover}`
    );
  }

  const churn = reversalChurnBase(
    input.lastAction.recentMoves,
    signedDeltas(current, target),
    input.origin.timestampSeconds,
    p.reversalWindowSeconds,
  );
  const reversalAllowance = (input.vault.totalAssetsBase * BigInt(p.reversalAllowanceBps)) / 10_000n;
  if (churn > reversalAllowance) {
    return (
      `REVERSAL_ALLOWANCE: round-trip churn ${churn} over ${p.reversalWindowSeconds}s ` +
      `exceeds the allowance ${reversalAllowance}`
    );
  }

  return null;
}

/**
 * The turnover still available in the rolling window, in USDC base units.
 *
 * Zero when the window is already full. Never negative.
 */
export function remainingTurnoverBase(input: DecisionInput, p: CostParams): bigint {
  const maxTurnover = (input.vault.totalAssetsBase * BigInt(p.maxTurnoverBps)) / 10_000n;
  const used = input.lastAction.turnoverWindowBase;
  return used >= maxTurnover ? 0n : maxTurnover - used;
}

/**
 * Scale a target back toward `current` so its notional fits `budgetBase`.
 *
 * §9.1's turnover limit is a CAP on how much may move per window -- "move at
 * most X" -- not a veto that says "if you want more than X, move nothing".
 * The gate used to reject wholesale, and that had two consequences serious
 * enough to invalidate the whole evaluation:
 *
 *   1. A COLD START could never resolve. A vault holding 100% cash wants to
 *      deploy ~94% of NAV, which exceeds a 50%/day cap, so the move was
 *      rejected; the next origin found the same 100% cash and rejected the
 *      same move. Every SRCLA and ablation run realised 0.000% net APY
 *      forever.
 *   2. It broke §11.1's equal-envelope requirement. B0 and B4 do not run
 *      through the cost gate at all (`frozenEqualWeightTarget` ->
 *      `targetToActions`), so the baselines deployed freely from cash while
 *      every policy that DID use the gate was frozen out. That is not a
 *      comparison of policies, it is a comparison of one policy against a
 *      brake only it wears.
 *
 * Trimming preserves the brake exactly -- no window ever exceeds the cap --
 * while letting a large move complete over several cycles. Deltas are scaled
 * proportionally so the target's DIRECTION and relative mix are preserved;
 * the trimmed move is then subject to the rest of the gate as usual, so a
 * trim that lands below MIN_TURNOVER is still correctly refused.
 */
export function clampToTurnoverBudget(
  current: ReadonlyMap<string, bigint>,
  target: ReadonlyMap<string, bigint>,
  budgetBase: bigint,
): Map<string, bigint> {
  const deltas = signedDeltas(current, target);
  let notional = 0n;
  for (const d of deltas.values()) notional += d < 0n ? -d : d;
  if (notional <= budgetBase || notional === 0n) return new Map(target);
  if (budgetBase <= 0n) return new Map(current);

  const clamped = new Map<string, bigint>(current);
  for (const [marketId, delta] of deltas) {
    if (delta === 0n) continue;
    // Integer scaling, truncating toward zero: the trimmed notional is
    // therefore never ABOVE the budget, which is the direction that matters.
    const scaled = (delta * budgetBase) / notional;
    clamped.set(marketId, (current.get(marketId) ?? 0n) + scaled);
  }
  return clamped;
}

/**
 * SUPERSEDED (P13/P15/P16). This compared a horizon-return gain against
 * `max(C_move, k*sigma)` — a threshold that moved with the forecast horizon
 * and double-charged forecast dispersion (once in the objective's lower
 * bound, again as the band). `steps/hurdles.ts`'s `deployClears`/
 * `rotateClears` are the economic-hurdle replacement, stated in annualised
 * rate units; `applyBrakes` above is the brake-enforcement replacement (the
 * cooldown/turnover/reversal checks this used to run inline — paper §9.1.4
 * says those remain in force independently of the hurdles). Task 4 rewires
 * every caller (`decide.ts` among them) onto those three functions and
 * removes this stub entirely; until then it throws rather than silently
 * returning a `CostGateResult` computed from a band that no longer exists.
 */
export function costGate(
  _input: DecisionInput,
  _curves: RateCurve[],
  _artifact: PolicyArtifact,
  _current: Map<string, bigint>,
  _target: Map<string, bigint>,
  _p: CostParams
): CostGateResult {
  throw new Error('costGate superseded by hurdles.ts; see plan Task 4');
}
