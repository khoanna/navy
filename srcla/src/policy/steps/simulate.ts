import {
  ProtocolSimulators,
  DefaultConfigs,
  type ProtocolId,
} from '../../protocols/simulation/index.js';
import { SECONDS_PER_YEAR } from '../../protocols/math.js';
import type { MarketState } from '../../protocols/simulation/types.js';
import type { DecisionInput, MarketObservation, RateCurve } from '../types.js';

/**
 * Protocols whose `ISimulator.simulateRate().postDepositRate` is returned in
 * WAD-**per-second** scale rather than the WAD-**annualized** scale that
 * `SimulatedRate` documents and that every other rate in the decision kernel
 * uses (`MarketObservation.supplyRateWad`, `RateCurve.points`).
 *
 * This is not a hypothetical: `compound-simulator.ts#calculateRateFromUtilization`
 * divides the annual config rates by `SECONDS_PER_YEAR` internally and its own
 * docstring says "Supply rate per second (WAD scale)" — confirmed against
 * `test/unit/protocols/compound-simulator.spec.ts`, which asserts the result
 * against `config.baseRate / 31557600n`. Left unconverted, a Compound curve
 * would fall off a ~3.15e7x cliff between points[0] (the annualized observed
 * rate) and points[1] (a per-second simulator rate) that has nothing to do
 * with capacity — see task-5-report.md for the raw numbers.
 *
 * Moonwell reuses that same per-second function internally, but
 * `moonwell-simulator.ts#simulateRate` then clamps the raw value against
 * `[minRate, maxRate]` oracle bounds that are themselves WAD-annualized
 * (e.g. 1e16 = 1%) — so by the time its `postDepositRate` reaches us it is
 * already sitting on the WAD-annualized scale (that clamp saturates against
 * `minRate` for any realistic input, which is a pre-existing defect in that
 * module, not a scale problem — see task-5-report.md). Re-annualizing it here
 * would push an already-annualized number out by another `SECONDS_PER_YEAR`
 * and produce nonsense. Aave's simulator returns an annualized WAD rate
 * directly. So only Compound needs the conversion.
 */
const PER_SECOND_PROTOCOLS: ReadonlySet<ProtocolId> = new Set<ProtocolId>(['compound']);

function toAnnualizedRateWad(protocol: ProtocolId, rateWad: bigint): bigint {
  return PER_SECOND_PROTOCOLS.has(protocol) ? rateWad * SECONDS_PER_YEAR : rateWad;
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
    const config = DefaultConfigs[protocol];
    const state = toMarketState(m, input.origin);

    const points: bigint[] = [];
    for (let k = 0; k < maxPoints; k++) {
      const x = quantumBase * BigInt(k);
      if (k === 0) {
        // points[0] is the current pre-deposit rate taken from the
        // observation itself, not from the simulator.
        points.push(m.supplyRateWad);
        continue;
      }
      const sim = simulator.simulateRate(state, x, config);
      const rateWad = toAnnualizedRateWad(protocol, sim.postDepositRate);
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
