import { rateAt } from './simulate.js';
import type { DecisionInput, DecisionOutput, PolicyArtifact, RateCurve } from '../types.js';

const SECONDS_PER_YEAR = 31_536_000n;

/**
 * P1 — the residual quantile is per venue. A venue with no calibrated entry
 * falls back to the most conservative registered quantile rather than to
 * zero, so an unregistered market can never receive an optimistic bound.
 */
function quantileFor(artifact: PolicyArtifact, marketId: string): bigint {
  const own = artifact.residualQuantileWadByMarket[marketId];
  if (own !== undefined) return own;
  const all = Object.values(artifact.residualQuantileWadByMarket);
  if (all.length === 0) return artifact.portfolioResidualQuantileWad;
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
  const q = quantileFor(artifact, marketId);
  if (q > 0n) throw new Error(`residual quantile for ${marketId} must be <= 0, got ${q}`);
  const annualised = rateAt(curve, xBase);
  const horizonMu = (annualised * BigInt(horizonSeconds)) / SECONDS_PER_YEAR;
  return horizonMu + q;
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
      exitableFraction: exitableFraction(x, m.maxWithdrawableBase),
    };
  });
}
