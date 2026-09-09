/**
 * P19 — a fourth forecast candidate: forecast the SMOOTH BOUNDED STATE
 * (utilization) and map it through the venue's own kinked, governance-
 * reparameterized rate function, rather than forecasting the rate series
 * directly (§7 amendment record).
 *
 * THE MEASUREMENT THAT MOTIVATES THIS. One-day persistence on the
 * calibration era explains 75.8% / 91.8% / 91.5% of utilization variance
 * across Compound/Aave/Moonwell, against -20.6% / 43.0% / 4.2% for the
 * rates those utilizations produce -- a negative R2 on Compound means the
 * CURRENT rate predicts tomorrow's worse than the unconditional mean does.
 * Utilization moves smoothly and is bounded in [0, 1]; the rate it drives is
 * a piecewise-linear, KINKED function of it, reparameterized by governance
 * (a new kink, slope or reserve factor) independently of anything the market
 * itself did. Forecasting the input to that map is the tractable half of
 * the problem; forecasting its output directly conflates "what utilization
 * will be" with "what the current rate model does to it", and the second
 * changes on a governance vote that has nothing to do with market dynamics.
 *
 * THE SINGLE MOST IMPORTANT INVARIANT: every IRM parameter this module
 * touches must come from the CALLER (read off-chain, off the snapshot
 * columns `irmBaseRateWad`/`irmKinkRay`/`irmSlopeLowWad`/`irmSlopeHighWad`/
 * `reserveFactorBps`), never a `DEFAULT_*_CONFIG` placeholder. Those
 * placeholders assert an 80% kink and a ~6.25% low slope; Compound's real
 * Base USDC values are 90% and ~3.60%. A forecast built on the placeholder
 * would look internally consistent and be wrong in a way nothing here could
 * catch, because this module never reads a config table itself -- it only
 * ever sees what its caller hands it.
 *
 * PURE: no I/O, no Date.now(), no randomness. Every input is provided by the
 * caller; every output is a deterministic function of it.
 */

const WAD = 10n ** 18n;
/** Ray has 9 more decimal digits than Wad (1e27 / 1e18 = 1e9). */
const RAY_PER_WAD = 10n ** 9n;
const BPS_DENOMINATOR = 10_000n;

/**
 * The kinked-linear interest-rate-model parameters this candidate needs,
 * read PER ORIGIN off the venue's own on-chain state -- never a default.
 * `kinkRay` is Ray-scaled (1e27) to match how the on-chain rate strategies
 * themselves store it; everything else here is Wad-scaled (1e18), matching
 * `MarketSnapshot`/`MarketObservation`'s own units.
 */
export interface IrmParams {
  baseRateWad: bigint;
  kinkRay: bigint;
  slopeLowWad: bigint;
  slopeHighWad: bigint;
  reserveFactorBps: number;
}

/**
 * The venue's own kinked-linear rate curve, evaluated EXACTLY at a given
 * utilization (Wad, i.e. WAD == 100%):
 *
 *   rate(u) = base + slopeLow * u                            u <= kink
 *   rate(u) = base + slopeLow * kink + slopeHigh * (u - kink)  u >  kink
 *
 * then scaled by `(1 - reserveFactor)`. This is the map §7's amendment asks
 * for: apply the PROTOCOL'S OWN function to a forecast state, rather than
 * forecasting its output series directly.
 *
 * `kinkRay` is converted to Wad scale by dividing out the Ray/Wad ratio
 * (1e9) before comparing against a Wad-scaled utilization -- comparing
 * across scales without this would make every utilization read as "above
 * the kink".
 */
export function supplyRateAt(utilizationWad: bigint, irm: IrmParams): bigint {
  const kinkWad = irm.kinkRay / RAY_PER_WAD;
  const rateWad =
    utilizationWad <= kinkWad
      ? irm.baseRateWad + (irm.slopeLowWad * utilizationWad) / WAD
      : irm.baseRateWad +
        (irm.slopeLowWad * kinkWad) / WAD +
        (irm.slopeHighWad * (utilizationWad - kinkWad)) / WAD;

  const reserveFactorWad = (BigInt(Math.trunc(irm.reserveFactorBps)) * WAD) / BPS_DENOMINATOR;
  return (rateWad * (WAD - reserveFactorWad)) / WAD;
}

/**
 * Forecast utilization as an exponentially-weighted LEVEL: the most recent
 * observation carries the most weight, older ones decay away at a rate set
 * by the registered half-life, so the forecast mean-reverts toward the
 * recent window rather than chasing (or ignoring) the latest print.
 *
 * `decay` is derived from the half-life so the parameter a caller supplies
 * is legible (`halfLifeObservations`, matching the registered grid axis)
 * rather than an opaque decay constant: `decay = 0.5 ** (1 / halfLife)`
 * makes the weight on an observation `halfLifeObservations` steps old
 * exactly half the weight on the latest one.
 *
 * Same weighting construction as `grid-sweep.ts`'s `ew-residual` dispatch
 * (integer weights at 1e9 precision, most-recent-first, capped lookback),
 * so a run is deterministic across platforms rather than depending on float
 * accumulation order.
 */
export function forecastUtilization(
  history: readonly bigint[],
  params: { halfLifeObservations: number },
): bigint {
  if (history.length === 0) return 0n;
  const halfLife = Math.max(1, params.halfLifeObservations);
  const decay = Math.pow(0.5, 1 / halfLife);

  let weightedSum = 0n;
  let weightTotal = 0n;
  for (let i = history.length - 1, age = 0; i >= 0 && age < 512; i--, age++) {
    const w = BigInt(Math.round(Math.pow(decay, age) * 1e9));
    if (w === 0n) break;
    weightedSum += history[i]! * w;
    weightTotal += w;
  }
  if (weightTotal === 0n) return history[history.length - 1]!;
  return weightedSum / weightTotal;
}

/** Clamp `x` into `[minWad, maxWad]`. */
function clampWad(x: bigint, minWad: bigint, maxWad: bigint): bigint {
  if (x < minWad) return minWad;
  if (x > maxWad) return maxWad;
  return x;
}

/**
 * Compose the two halves of P19: forecast the state, then map it through
 * the venue's own rate function.
 *
 * REFUSES TO EXTRAPOLATE. The forecast utilization is hard-clamped to
 * `observedRange` -- the [min, max] utilization this venue has actually been
 * seen at -- before it is ever handed to `supplyRateAt`. An EWMA level is an
 * interpolation estimator; nothing here licenses it to invent a utilization
 * the venue has never occupied, and a rate curve evaluated past the range it
 * was observed over is not a measurement of anything.
 */
export function stateSpaceForecast(
  history: readonly bigint[],
  irm: IrmParams,
  params: { halfLifeObservations: number },
  observedRange: { minWad: bigint; maxWad: bigint },
): bigint {
  const forecastWad = forecastUtilization(history, params);
  const clampedWad = clampWad(forecastWad, observedRange.minWad, observedRange.maxWad);
  return supplyRateAt(clampedWad, irm);
}
