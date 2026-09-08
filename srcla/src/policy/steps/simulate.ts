import {
  ProtocolSimulators,
  DefaultConfigs,
  type ProtocolId,
} from '../../protocols/simulation/index.js';
import { SECONDS_PER_YEAR } from '../../protocols/math.js';
import type {
  CompoundSimulatorConfig,
  MarketState,
  MoonwellSimulatorConfig,
  SimulatorConfig,
} from '../../protocols/simulation/types.js';
import type { DecisionInput, MarketObservation, RateCurve } from '../types.js';

/**
 * Protocols whose `ISimulator.simulateRate().postDepositRate` is returned in
 * WAD-**per-second** scale rather than the WAD-**annualized** scale that
 * `SimulatedRate` documents and that every other rate in the decision kernel
 * uses (`MarketObservation.supplyRateWad`, `RateCurve.points`).
 *
 * This is not a hypothetical: `compound-simulator.ts#calculateRateFromUtilization`
 * divides the annual config rates (baseRate/slopeLow/slopeHigh) by
 * `SECONDS_PER_YEAR` internally and its own docstring says "Supply rate per
 * second (WAD scale)" — confirmed against
 * `test/unit/protocols/compound-simulator.spec.ts`, which asserts the result
 * against `config.baseRate / 31557600n`. Left unconverted, a Compound curve
 * would fall off a ~3.15e7x (`SECONDS_PER_YEAR`) cliff between points[0]
 * (the annualized observed rate) and points[1] (a raw per-second simulator
 * rate) that has nothing to do with capacity.
 *
 * Moonwell reuses that same per-second function internally, but
 * `moonwell-simulator.ts#simulateRate` annualizes (`* SECONDS_PER_YEAR`)
 * before clamping against its `[minRate, maxRate]` oracle bounds, which are
 * themselves WAD-annualized (e.g. 1e16 = 1%) — so by the time its
 * `postDepositRate` reaches us it is already sitting on the WAD-annualized
 * scale. Re-annualizing it again here would push an already-annualized
 * number out by another `SECONDS_PER_YEAR` and produce nonsense. Aave's
 * simulator returns an annualized WAD rate directly. So only Compound needs
 * the conversion below.
 */
const PER_SECOND_PROTOCOLS: ReadonlySet<ProtocolId> = new Set<ProtocolId>(['compound']);

function toAnnualizedRateWad(protocol: ProtocolId, rateWad: bigint): bigint {
  return PER_SECOND_PROTOCOLS.has(protocol) ? rateWad * SECONDS_PER_YEAR : rateWad;
}

/**
 * Paper §6.3-6.5 requires simulation to mirror the LIVE registered
 * interest-rate strategy, not a hardcoded default. `m.irmParams` is that
 * seam: when present, it overrides the kinked-linear model's four core
 * fields (baseRate/kink/slopeLow/slopeHigh — §6.4's Compound III kinked
 * supply curve and §6.5's Moonwell jump-rate model share this shape). It is
 * NOT populated from chain yet — the collector that reads live IRM params
 * off each venue's rate strategy contract is a later task, so every market
 * currently falls back to `DefaultConfigs`.
 *
 * `irmParams`'s shape does not fit Aave: §6.3's Aave V3 strategy is a
 * piecewise-quadratic model (baseRate/variableRateSlope1/variableRateSlope2/
 * optimalUtilization/maxUtilization), structurally different from the
 * kinked-linear shape `irmParams` carries. Silently dropping an override
 * that does not apply is exactly the failure mode this task already hit
 * twice (an un-annualized Compound rate, then Moonwell's clamp comparing
 * mismatched scales) — both produced plausible-looking numbers with no
 * error. So an Aave market that supplies `irmParams` is a caller/config
 * error, not something to ignore: this throws rather than silently falling
 * back to `DefaultConfigs.aave`.
 */
function resolveConfig(m: MarketObservation, protocol: ProtocolId): SimulatorConfig {
  if (protocol === 'aave') {
    if (m.irmParams) {
      throw new Error(
        `simulateCurves: market '${m.marketId}' is protocol 'aave' but supplied irmParams. ` +
          `Aave's rate model (paper §6.3) takes a structurally different parameter shape ` +
          `(variableRateSlope1/variableRateSlope2/optimalUtilization/maxUtilization) than the ` +
          `kinked-linear irmParams (baseRate/kink/slopeLow/slopeHigh) this seam carries — a ` +
          `Compound-shaped override is not applicable to Aave. Remove irmParams for this market, ` +
          `or do not set it until an Aave-shaped override is supported.`
      );
    }
    return DefaultConfigs.aave;
  }
  if (!m.irmParams) {
    return DefaultConfigs[protocol];
  }
  const { baseRateWad, kinkRay, slopeLowWad, slopeHighWad } = m.irmParams;
  const kinked: CompoundSimulatorConfig = {
    baseRate: baseRateWad,
    kink: kinkRay,
    slopeLow: slopeLowWad,
    slopeHigh: slopeHighWad,
  };
  if (protocol === 'moonwell') {
    // minRate/maxRate are Apollo oracle bounds, not part of the IRM curve
    // shape irmParams carries — keep them from DefaultConfigs.
    const defaults = DefaultConfigs.moonwell as MoonwellSimulatorConfig;
    const moonwellConfig: MoonwellSimulatorConfig = {
      ...kinked,
      minRate: defaults.minRate,
      maxRate: defaults.maxRate,
    };
    return moonwellConfig;
  }
  return kinked; // protocol === 'compound'
}

function toMarketState(m: MarketObservation, origin: DecisionInput['origin']): MarketState {
  return {
    marketId: m.marketId,
    name: m.protocol,
    cash: m.cash,
    borrows: m.borrows,
    reserves: m.reserves,
    supplyRate: m.supplyRateWad,
    blockNumber: origin.blockNumber,
    timestamp: origin.timestampSeconds,
  };
}

/**
 * The cash NOT attributable to the vault's own current position — every
 * `ISimulator.simulateRate(state, x, config)` computes `newCash = state.cash
 * + x`, treating `x` as an amount added on top of `state.cash`. `m.cash` is
 * the protocol's raw observed cash, which already includes whatever the
 * vault currently holds here (`m.positionBase`). To make `x` mean the
 * vault's ABSOLUTE target allocation (see the `RateCurve.points` doc
 * comment), the simulator's baseline must start from the cash contributed
 * by everyone else, so `externalCash + x` reproduces the true post-target
 * cash for any x — including `x = m.positionBase` reproducing today's
 * observed `m.cash` exactly, and `x = 0` correctly modelling a full exit
 * (the vault's own contribution removed, not `m.cash` unchanged).
 *
 * Clamped at 0: `positionBase` is off-chain-tracked and `cash` is an
 * on-chain snapshot, so a same-block mismatch could in principle make the
 * subtraction negative; treating that as "no external cash" is the
 * conservative (lowest-capacity) reading, not a crash.
 */
function externalCash(m: MarketObservation): bigint {
  const v = m.cash - m.positionBase;
  return v > 0n ? v : 0n;
}

/**
 * §6.3-6.5 — the protocol-exact post-deposit supply rate as a function of the
 * vault's own allocation x, sampled at the allocation quantum.
 *
 * The curve is the contract between simulation, forecasting and optimisation:
 * the forecast applies its lower bound to rateAt(curve, x), and the optimiser
 * searches over x. Nothing downstream re-derives protocol mechanics.
 *
 * PURE: no I/O, no Date.now(), no randomness — the whole decision kernel is
 * asserted deterministic and must reproduce an identical hash across runs.
 */
export function simulateCurves(
  input: DecisionInput,
  eligible: string[],
  quantumBase: bigint,
  maxPoints: number
): RateCurve[] {
  const eligibleSet = new Set(eligible);
  const curves: RateCurve[] = [];

  for (const m of input.markets) {
    if (!eligibleSet.has(m.marketId)) continue;

    const protocol: ProtocolId = m.protocol;
    const simulator = ProtocolSimulators[protocol];
    const config = resolveConfig(m, protocol);
    // Baseline cash EXCLUDES the vault's own current position — see
    // externalCash's doc comment. x (below) is then the vault's ABSOLUTE
    // target allocation, matching every consumer of RateCurve.
    const state: MarketState = { ...toMarketState(m, input.origin), cash: externalCash(m) };

    const points: bigint[] = [];
    for (let k = 0; k < maxPoints; k++) {
      const x = quantumBase * BigInt(k);
      // Every point, including k=0 (x=0, a full exit), is simulated from
      // the external-cash baseline — x=0 is NOT the same as "today's
      // observed rate" whenever the vault holds a non-zero position, so it
      // can no longer be special-cased to `m.supplyRateWad` (that was only
      // correct under the old, incremental-x interpretation).
      const sim = simulator.simulateRate(state, x, config);
      const rateWad = toAnnualizedRateWad(protocol, sim.postDepositRate);
      if (k === 0) {
        points.push(rateWad);
        continue;
      }
      // A deposit can only lower the supply rate; clamp to enforce
      // monotonicity so rounding in a protocol model cannot produce a
      // non-monotone curve.
      const prev = points[k - 1]!;
      points.push(rateWad < prev ? rateWad : prev);
    }

    curves.push({
      marketId: m.marketId,
      quantumBase,
      points,
      maxXBase: quantumBase * BigInt(maxPoints - 1),
    });
  }

  return curves;
}

/** Linear interpolation between samples; clamped at both ends. */
export function rateAt(curve: RateCurve, xBase: bigint): bigint {
  if (xBase <= 0n) return curve.points[0]!;
  if (xBase >= curve.maxXBase) return curve.points[curve.points.length - 1]!;

  const k = Number(xBase / curve.quantumBase);
  const lo = curve.points[k]!;
  const hi = curve.points[k + 1] ?? lo;
  const remainder = xBase % curve.quantumBase;
  if (remainder === 0n) return lo;

  // lo >= hi by construction, so the interpolated value walks down from lo.
  return lo - ((lo - hi) * remainder) / curve.quantumBase;
}

/**
 * H1 (paper §11.3 — "remove post-deposit simulation; rank on displayed
 * rate"). Produces a curve of the SAME shape as `simulateCurves` — same
 * marketId set, same quantum, same point count, same `maxXBase` — whose
 * every point is the venue's currently displayed `supplyRateWad`. Rate unit:
 * WAD annualized, identical to `simulateCurves`'s output, so nothing
 * downstream (forecast, optimize, cost) needs an H1-specific branch.
 *
 * A flat curve is exactly the ablation: the optimiser still searches over x
 * and still obeys every cap and the reserve, but marginal rate no longer
 * decays with the size of the vault's own deposit, so ranking collapses onto
 * the displayed rate.
 */
export function flatDisplayedRateCurves(
  input: DecisionInput,
  eligible: string[],
  quantumBase: bigint,
  maxPoints: number
): RateCurve[] {
  const eligibleSet = new Set(eligible);
  const curves: RateCurve[] = [];
  for (const m of input.markets) {
    if (!eligibleSet.has(m.marketId)) continue;
    curves.push({
      marketId: m.marketId,
      quantumBase,
      points: Array.from({ length: maxPoints }, () => m.supplyRateWad),
      maxXBase: quantumBase * BigInt(maxPoints - 1),
    });
  }
  return curves;
}
