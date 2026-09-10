import { rateAt } from './simulate.js';
import type { DecisionInput, DecisionOutput, MarketObservation, PolicyArtifact, RateCurve } from '../types.js';

const SECONDS_PER_YEAR = 31_536_000n;
const WAD = 10n ** 18n;

/**
 * P1 — the residual quantile is per venue. A venue with no calibrated entry
 * falls back to the most conservative registered quantile rather than to
 * zero, so an unregistered market can never receive an optimistic bound.
 *
 * When `residualQuantileWadByMarket` is empty there is no per-venue minimum
 * to take at all — the shipped bootstrap artifact
 * (`config/bootstrap-artifact.json`) is exactly this case today, so this is
 * live production behaviour, not a hypothetical branch. The only other
 * calibrated conservative value the artifact carries is the P2 portfolio
 * quantile (`portfolioResidualQuantileWad`), so that is the deliberate
 * fallback here — never `0n`, which would be optimistic relative to any
 * calibrated quantile and would silently break the conservatism invariant
 * this whole module exists to enforce.
 */
function quantileFor(artifact: PolicyArtifact, marketId: string): bigint {
  const own = artifact.residualQuantileWadByMarket[marketId];
  if (own !== undefined) return own;
  const all = Object.values(artifact.residualQuantileWadByMarket);
  if (all.length === 0) return artifact.portfolioResidualQuantileWad;
  return all.reduce((min, q) => (q < min ? q : min));
}

/**
 * P1's RELATIVE quantile, with the same fallback ladder as `quantileFor` and
 * for the same reason: an unregistered venue must never receive a MORE
 * optimistic bound than a calibrated one, so a missing entry takes the most
 * conservative registered peer.
 *
 * Returns `undefined` — not a fabricated value — when the artifact carries no
 * relative map at all. An artifact frozen before the field existed must keep
 * using the absolute form it was calibrated in; the two are not
 * interconvertible without the forecast level each was measured against, and
 * inventing one from the other would be a haircut nobody calibrated.
 */
function relativeQuantileFor(artifact: PolicyArtifact, marketId: string): bigint | undefined {
  const map = artifact.relativeResidualQuantileWadByMarket;
  if (map === undefined) return undefined;
  const own = map[marketId];
  if (own !== undefined) return own;
  const all = Object.values(map);
  if (all.length === 0) return undefined;
  return all.reduce((min, q) => (q < min ? q : min));
}

/**
 * §7.1 — l(x) = mu_hat(x) + q_alpha, where mu_hat is the annualised curve rate
 * converted to the horizon and q_alpha <= 0 is the calibrated lower quantile
 * of completed horizon residuals.
 *
 * A positive quantile would push the bound above the mean, which contradicts
 * the whole point of a conservative lower bound — reject it loudly rather
 * than silently clamping or accepting it.
 */
export function lowerBoundAt(
  curve: RateCurve,
  artifact: PolicyArtifact,
  marketId: string,
  xBase: bigint,
  horizonSeconds: number
): bigint {
  const annualised = rateAt(curve, xBase);
  const horizonMu = (annualised * BigInt(horizonSeconds)) / SECONDS_PER_YEAR;

  // RELATIVE form when the artifact carries it (see
  // `PolicyArtifact.relativeResidualQuantileWadByMarket` for the measurement
  // that motivates it). `mu` here is evaluated at the CANDIDATE allocation
  // `xBase`, so at a large vault size it is a rate the vault's own deposit
  // has already compressed; a fixed absolute haircut then eats a growing
  // share of a shrinking edge until nothing can clear the deployment hurdle.
  // A proportional haircut scales with the quantity it is uncertain about.
  const qRel = relativeQuantileFor(artifact, marketId);
  if (qRel !== undefined) {
    if (qRel > 0n) {
      throw new Error(`relative residual quantile for ${marketId} must be <= 0, got ${qRel}`);
    }
    // A quantile at or below -WAD would flip the bound negative (or zero it)
    // for every forecast, which is a degenerate calibration rather than a
    // conservative one. Clamp at -WAD: the bound floors at 0, never inverts.
    const scale = qRel < -WAD ? 0n : WAD + qRel;
    return (horizonMu * scale) / WAD;
  }

  const q = quantileFor(artifact, marketId);
  if (q > 0n) throw new Error(`residual quantile for ${marketId} must be <= 0, got ${q}`);
  return horizonMu + q;
}


/**
 * §7.2's SECOND registered target - the per-venue relative quantile of
 * withdrawable-cash shortfall over the horizon.
 *
 * Same fallback ladder as `quantileFor` above, and for the same reason: an
 * unregistered venue must never receive a MORE optimistic bound than a
 * calibrated one. Own entry, else the most conservative calibrated peer,
 * else the artifact's registered scalar - which is strictly negative, so
 * "no calibration at all" produces a haircut rather than the spot value.
 */
export function cashQuantileFor(artifact: PolicyArtifact, marketId: string): bigint {
  const own = artifact.cashResidualQuantileWadByMarket[marketId];
  if (own !== undefined) return own;
  const all = Object.values(artifact.cashResidualQuantileWadByMarket);
  if (all.length === 0) return artifact.cashLowerBoundQuantileWad;
  return all.reduce((min, q) => (q < min ? q : min));
}

/**
 * §7.2 / §8.1 - `e_i^cons`, the conservatively executable same-transaction
 * exit for a venue over the horizon:
 *
 *     e_i^cons = spotCash * (1 + q_cash)      q_cash <= 0
 *
 * WHAT THIS REPLACES. `reserve.ts` (`min(x_i, e_i^cons)`) and `optimize.ts`
 * (`exitableFraction(x, .)`) both read the SPOT value
 * `MarketObservation.maxWithdrawableBase` directly. §7.2 requires a lower
 * PREDICTION BOUND on withdrawable cash over the horizon instead, "calibrated
 * with the same machinery" as the return forecast - and the label column for
 * it (`realizedMinCashBase`) existed with no consumer anywhere in src
 * (readiness audit NEW-11). A spot reading is not a bound: it says the cash
 * is there NOW, while the reserve and phi both need to know it will still be
 * there when the vault actually needs to exit.
 *
 * The bound floors at zero and can never EXCEED spot cash, since q <= 0 is
 * enforced loudly rather than clamped - a positive quantile would make the
 * "conservative" exit larger than the observed one, which is the one
 * direction this quantity must never move.
 */
export function withdrawableLowerBoundBase(m: MarketObservation, artifact: PolicyArtifact): bigint {
  const q = cashQuantileFor(artifact, m.marketId);
  if (q > 0n) {
    throw new Error(`cash residual quantile for ${m.marketId} must be <= 0, got ${q}`);
  }
  if (m.maxWithdrawableBase <= 0n) return 0n;
  const scaled = (m.maxWithdrawableBase * (WAD + q)) / WAD;
  return scaled < 0n ? 0n : scaled;
}

/**
 * P4 — the conservatively exitable share of a target position. Value that
 * cannot be withdrawn earns no rank in the objective. A zero target position
 * holds nothing, so it is trivially fully exitable (1), not undefined or 0.
 */
export function exitableFraction(targetBase: bigint, maxWithdrawableBase: bigint): number {
  if (targetBase <= 0n) return 1;
  if (maxWithdrawableBase >= targetBase) return 1;
  if (maxWithdrawableBase <= 0n) return 0;
  return Number((maxWithdrawableBase * 1_000_000n) / targetBase) / 1_000_000;
}

/**
 * Applies the frozen artifact to every simulated curve: the point forecast,
 * its per-venue lower bound, and the exitable fraction of the venue's current
 * position. PURE — no I/O, no clock, no randomness.
 */
export function forecastMarkets(
  input: DecisionInput,
  curves: RateCurve[],
  artifact: PolicyArtifact
): DecisionOutput['lowerBounds'] {
  return curves.map((c) => {
    const m = input.markets.find((x) => x.marketId === c.marketId);
    if (!m) {
      throw new Error(`forecastMarkets: no MarketObservation for curve marketId '${c.marketId}'`);
    }
    const x = m.positionBase;
    return {
      marketId: c.marketId,
      muWad: (rateAt(c, x) * BigInt(artifact.horizonSeconds)) / SECONDS_PER_YEAR,
      lowerWad: lowerBoundAt(c, artifact, c.marketId, x, artifact.horizonSeconds),
      // §7.2's second target, not the spot reading — see
      // withdrawableLowerBoundBase.
      exitableFraction: exitableFraction(x, withdrawableLowerBoundBase(m, artifact)),
    };
  });
}
