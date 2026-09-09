/**
 * §9.1.4 - the target is diffed into legs, each leg meets its own hurdle, the
 * survivors are re-checked for feasibility, and the executed move is a partial
 * adjustment toward them.
 *
 * v0.6 evaluated one gate over the whole vector and returned HOLD on failure.
 * Constantinides' no-trade region is exited by trading TO ITS BOUNDARY and
 * Garleanu-Pedersen's optimal policy is partial adjustment toward an aim; the
 * all-or-nothing form is the one structure both results exclude. On the two
 * sealed v0.6 held-out eras it produced 1 and 0 rebalances respectively.
 *
 * PURE. UNITS: bigint USDC base units (6 dp).
 */
import { deployClears, rotateClears, type LegVerdict } from './hurdles.js';
import type { CostParams } from './cost.js';
import type { DecisionInput, PolicyArtifact, RateCurve } from '../types.js';

/**
 * Deploy legs are idle -> venue. Rotation legs walk the deploys in descending
 * amount (ties broken on ascending market id) and pair each against the
 * largest remaining divest under the same order - a deterministic ordering, so
 * two runs on the same input pair identically. It is not a registered constant
 * and nothing outside this function depends on the particular pairing; only
 * that it is a function of the input.
 *
 * CURVES ARE READ AT ABSOLUTE LEVELS. `RateCurve.points[k]` is the rate at a
 * TOTAL allocation of `k*quantum`, so every leg carries both its delta (which
 * prices the movement cost) and the post-move level it reaches (which prices
 * the curve). `level` below tracks that running position, so a venue fed by a
 * rotation and then by idle sees each successive leg at the level that leg
 * actually reaches. See `hurdles.ts#deployClears` for why the delta is the
 * wrong x.
 *
 * VENUES OUTSIDE THE SIMULATED UNIVERSE ARE SKIPPED. `curves` covers only the
 * markets `admit` passed at this origin, while `current` covers every market
 * the vault holds, so a venue that has just fallen out of admission appears in
 * `current` with a position and in `target` not at all. There is no curve for
 * it, hence no conservative bound, hence no way to price either side of a
 * rotation out of it - and fabricating a flat curve from its displayed rate
 * would be inventing the forecast the hurdle is supposed to test. Such a
 * position is therefore LEFT ALONE here: §9.1's registered exit from an
 * ineligible venue is `steps/unwind.ts`'s bounded safety unwind, which runs
 * earlier in `decide` and bypasses the economic gate entirely, not a rotation
 * priced off a curve that does not exist.
 */
export function planLegs(
  current: Map<string, bigint>,
  target: Map<string, bigint>,
  input: DecisionInput,
  artifact: PolicyArtifact,
  curves: RateCurve[],
  p: CostParams,
): LegVerdict[] {
  const curveOf = new Map(curves.map((c) => [c.marketId, c]));
  const ids = [...new Set([...current.keys(), ...target.keys()])]
    .filter((id) => curveOf.has(id))
    .sort();

  const ups: Array<{ id: string; amt: bigint }> = [];
  const downs: Array<{ id: string; amt: bigint }> = [];
  for (const id of ids) {
    const d = (target.get(id) ?? 0n) - (current.get(id) ?? 0n);
    if (d > 0n) ups.push({ id, amt: d });
    else if (d < 0n) downs.push({ id, amt: -d });
  }
  const byAmount = (a: { id: string; amt: bigint }, b: { id: string; amt: bigint }) =>
    a.amt === b.amt ? a.id.localeCompare(b.id) : (b.amt > a.amt ? 1 : -1);
  ups.sort(byAmount);
  downs.sort(byAmount);

  // Running absolute position, so each leg is priced at the level it reaches.
  const level = new Map<string, bigint>();
  for (const id of ids) level.set(id, current.get(id) ?? 0n);

  const out: LegVerdict[] = [];

  // Pair divests against deploys first: those are rotations.
  let di = 0;
  for (const up of ups) {
    let remaining = up.amt;
    while (remaining > 0n && di < downs.length) {
      const down = downs[di]!;
      const m = remaining < down.amt ? remaining : down.amt;
      const toLevel = (level.get(up.id) ?? 0n) + m;
      const fromLevel = (level.get(down.id) ?? 0n) - m;
      out.push(
        rotateClears(
          input,
          artifact,
          curveOf.get(up.id)!,
          curveOf.get(down.id)!,
          up.id,
          down.id,
          m,
          toLevel,
          fromLevel,
          p,
        ),
      );
      level.set(up.id, toLevel);
      level.set(down.id, fromLevel);
      remaining -= m;
      down.amt -= m;
      if (down.amt === 0n) di++;
    }
    // Whatever is left is funded from idle: a deployment, not a rotation.
    if (remaining > 0n) {
      const toLevel = (level.get(up.id) ?? 0n) + remaining;
      out.push(deployClears(input, artifact, curveOf.get(up.id)!, up.id, remaining, toLevel, p));
      level.set(up.id, toLevel);
    }
  }

  // A divest with no deploy to pair against is a WITHDRAWAL TO IDLE, and
  // §9.1's hurdles do not price it: §9.1.2 asks whether idle cash repays the
  // cost of being DEPLOYED and §9.1.3 asks whether one venue's bound beats
  // another's - neither states a threshold for taking risk OFF. The optimiser
  // only shrinks a position when a constraint forces it (the reserve rose, a
  // cap or the liquidity cap fell, the venue was de-admitted), so blocking
  // these would resurrect exactly the all-or-nothing failure this step
  // removes, in the one direction that RAISES risk rather than forgoing
  // yield. They therefore clear unconditionally; the aggregate brakes
  // (`cost.ts#applyBrakes`) and `decide`'s feasibility re-check still bound
  // them, and the movement cost is still charged on-chain.
  for (let k = di; k < downs.length; k++) {
    const down = downs[k]!;
    if (down.amt === 0n) continue;
    out.push({
      kind: 'divest',
      marketId: down.id,
      fromMarketId: null,
      amountBase: down.amt,
      clears: true,
      edgeWad: 0n,
      hurdleWad: 0n,
      costHurdleWad: 0n,
      significanceWad: 0n,
      reason: 'DIVEST_TO_IDLE: no economic hurdle applies to reducing exposure',
    });
  }

  return out;
}

/**
 * The position implied by executing only the legs that cleared.
 *
 * `_target` is accepted (and unused) so the caller reads as a diff of the same
 * two vectors `planLegs` was given: the surviving position is built from
 * `current` plus the cleared legs, never from the target, because a leg that
 * did not clear must leave its venue exactly where it was.
 */
export function survivingTarget(
  current: Map<string, bigint>,
  _target: Map<string, bigint>,
  verdicts: readonly LegVerdict[],
): Map<string, bigint> {
  const out = new Map(current);
  for (const v of verdicts) {
    if (!v.clears) continue;
    if (v.kind === 'divest') {
      out.set(v.marketId, (out.get(v.marketId) ?? 0n) - v.amountBase);
      continue;
    }
    out.set(v.marketId, (out.get(v.marketId) ?? 0n) + v.amountBase);
    if (v.fromMarketId !== null) {
      out.set(v.fromMarketId, (out.get(v.fromMarketId) ?? 0n) - v.amountBase);
    }
  }
  return out;
}

/** `sum |b_i - a_i|` over the union of both vectors, in USDC base units. */
export function notionalBase(
  a: ReadonlyMap<string, bigint>,
  b: ReadonlyMap<string, bigint>,
): bigint {
  let total = 0n;
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const d = (b.get(id) ?? 0n) - (a.get(id) ?? 0n);
    total += d < 0n ? -d : d;
  }
  return total;
}

/** The adjustment rate's fixed-point denominator: lambda is carried as
 *  `scale / SCALE_ONE` so the search below can step it exactly. */
const SCALE_ONE = 1_000_000n;

function adjustAtScale(
  current: Map<string, bigint>,
  sub: Map<string, bigint>,
  scale: bigint,
): Map<string, bigint> {
  const ids = [...new Set([...current.keys(), ...sub.keys()])].sort();

  let currentTotal = 0n;
  let subTotal = 0n;
  for (const id of ids) {
    currentTotal += current.get(id) ?? 0n;
    subTotal += sub.get(id) ?? 0n;
  }
  const intendedDrift = ((subTotal - currentTotal) * scale) / SCALE_ONE;

  const out = new Map<string, bigint>();
  let drift = 0n;
  for (const id of ids) {
    const c = current.get(id) ?? 0n;
    const s = sub.get(id) ?? 0n;
    const moved = c + ((s - c) * scale) / SCALE_ONE;
    out.set(id, moved);
    drift += moved - c;
  }

  const dust = drift - intendedDrift;
  if (dust !== 0n && ids.length > 0) {
    const fix = ids.find((id) => (out.get(id) ?? 0n) - dust >= 0n) ?? ids[0]!;
    out.set(fix, (out.get(fix) ?? 0n) - dust);
  }
  return out;
}

/**
 * §9.1.4's partial adjustment: `x <- x + lambda*(sub - x)`, rounded so the
 * change in TOTAL DEPLOYMENT is exactly the scaled change the sub-target asked
 * for - a truncating per-venue scale otherwise mints or burns a few base
 * units, and the vault's own accounting has no source for them.
 *
 * The correction is against the INTENDED total change, not against zero. A
 * sub-target need not deploy the same total as the current position: a divest
 * to idle deliberately shrinks it, and forcing conservation there would undo
 * the whole move (a 5,000 -> 1,000 USDC reduction at lambda = 0.5 came back out
 * at 5,000). Only the truncation dust - bounded by the number of venues - is
 * reassigned.
 *
 * The dust goes to the first market id in sorted order that can absorb it
 * without going negative. Determinism is the requirement (`decide` is pure and
 * its hash covers the target), not any particular venue.
 */
export function partialAdjust(
  current: Map<string, bigint>,
  sub: Map<string, bigint>,
  lambda: number,
): Map<string, bigint> {
  if (lambda >= 1) return new Map(sub);
  return adjustAtScale(current, sub, BigInt(Math.round(lambda * Number(SCALE_ONE))));
}

/**
 * The partial adjustment, raised to the SMALLEST rate in `[lambda, 1]` whose
 * notional still clears `minNotionalBase` - §9.1's minimum-turnover floor.
 *
 * P17 review I4. Evaluating the brakes on the final executed vector is what
 * §9.1.4 asks for, but it makes MIN_TURNOVER see `lambda * notional`. A target
 * whose full notional clears the floor and whose scaled notional does not then
 * produced a HOLD - and since a hold changes no state, the next origin found
 * the same target and held again, forever. That is a self-perpetuating hold
 * introduced purely by the adjustment rate, and it is dormant today only
 * because `adjustmentRate` defaults to 1.
 *
 * THE INVARIANT CHOSEN: the floor is never bypassed, and a move that could
 * clear it is never refused for being scaled below it. Nothing below
 * `minNotionalBase` is ever executed - the alternative fix (measure
 * MIN_TURNOVER on the pre-adjustment vector) would let a dust move through,
 * and §9.1's floor exists precisely to stop repeated small moves. Instead the
 * rate is raised to the boundary: the policy moves the LEAST it is allowed to
 * move, which is also Constantinides' prescription for leaving a no-trade
 * region. When the full sub-target is itself under the floor no rate can help;
 * the vector is returned at `lambda` and MIN_TURNOVER refuses it, which is a
 * stable and correct refusal (the move is genuinely not worth its cost), not
 * the pathology above.
 *
 * Notional is non-decreasing in `scale` (each venue's `trunc((s_i-c_i)*scale)`
 * is), so a binary search over the fixed-point grid finds the boundary in ~20
 * exact integer steps. PURE and deterministic.
 */
export function partialAdjustAtLeast(
  current: Map<string, bigint>,
  sub: Map<string, bigint>,
  lambda: number,
  minNotionalBase: bigint,
): Map<string, bigint> {
  const first = partialAdjust(current, sub, lambda);
  if (notionalBase(current, first) >= minNotionalBase) return first;
  // Unreachable at any rate: let the brake refuse it rather than inflate it.
  if (notionalBase(current, sub) < minNotionalBase) return first;

  let lo = lambda >= 1 ? SCALE_ONE : BigInt(Math.round(lambda * Number(SCALE_ONE)));
  if (lo < 0n) lo = 0n;
  let hi = SCALE_ONE;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (notionalBase(current, adjustAtScale(current, sub, mid)) >= minNotionalBase) hi = mid;
    else lo = mid + 1n;
  }
  return lo >= SCALE_ONE ? new Map(sub) : adjustAtScale(current, sub, lo);
}

/**
 * P17 review I1 — the executed vector, chosen by backing OFF rather than by
 * falling all the way to the current position.
 *
 * `commit` must return `null` when a candidate cannot be executed (it fails the
 * caller's feasibility re-check, before or after the partial adjustment) and
 * the adjusted vector otherwise. The order is:
 *
 *   1. the full surviving set — every leg that cleared its hurdle;
 *   2. the RISK-REDUCING SUBSET of it — only the divest-to-idle legs;
 *   3. the current position, i.e. hold.
 *
 * Step 2 is the point. A subset of a feasible target need not be feasible, and
 * when it is not, dropping straight to `current` discards the unpaired divests
 * along with everything else — legs that carry no economic hurdle precisely
 * because §9.1 states none for reducing exposure, and that the optimiser only
 * proposed because a constraint moved. Discarding them is the all-or-nothing
 * failure P17 exists to remove, pointed in the direction that RAISES risk.
 *
 * `backedOff` is reported so the census can tell a full execution from a
 * reduced one; `decide` turns it into the `HURDLES_CLEARED_DIVEST_ONLY` reason.
 *
 * PURE, given a pure `commit`.
 */
export function chooseExecuted(
  current: Map<string, bigint>,
  sub: Map<string, bigint>,
  divestOnly: Map<string, bigint>,
  hasClearedDivest: boolean,
  commit: (candidate: Map<string, bigint>) => Map<string, bigint> | null,
): { executed: Map<string, bigint>; backedOff: boolean } {
  const full = commit(sub);
  if (full !== null) return { executed: full, backedOff: false };

  if (hasClearedDivest) {
    const reduced = commit(divestOnly);
    if (reduced !== null) return { executed: reduced, backedOff: true };
  }

  return { executed: new Map(current), backedOff: false };
}
