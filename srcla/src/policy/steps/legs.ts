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
 * Deploy legs are idle -> venue. Rotation legs pair each divest with the
 * largest remaining deploy, in descending amount then ascending market id -
 * the registered ordering, so two runs on the same input pair identically.
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

  const out: LegVerdict[] = [];

  // Pair divests against deploys first: those are rotations.
  let di = 0;
  for (const up of ups) {
    let remaining = up.amt;
    while (remaining > 0n && di < downs.length) {
      const down = downs[di]!;
      const m = remaining < down.amt ? remaining : down.amt;
      out.push(
        rotateClears(
          input,
          artifact,
          curveOf.get(up.id)!,
          curveOf.get(down.id)!,
          up.id,
          down.id,
          m,
          p,
        ),
      );
      remaining -= m;
      down.amt -= m;
      if (down.amt === 0n) di++;
    }
    // Whatever is left is funded from idle: a deployment, not a rotation.
    if (remaining > 0n) {
      out.push(deployClears(input, artifact, curveOf.get(up.id)!, up.id, remaining, p));
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
  const scale = BigInt(Math.round(lambda * 1_000_000));
  const ids = [...new Set([...current.keys(), ...sub.keys()])].sort();

  let currentTotal = 0n;
  let subTotal = 0n;
  for (const id of ids) {
    currentTotal += current.get(id) ?? 0n;
    subTotal += sub.get(id) ?? 0n;
  }
  const intendedDrift = ((subTotal - currentTotal) * scale) / 1_000_000n;

  const out = new Map<string, bigint>();
  let drift = 0n;
  for (const id of ids) {
    const c = current.get(id) ?? 0n;
    const s = sub.get(id) ?? 0n;
    const moved = c + ((s - c) * scale) / 1_000_000n;
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
