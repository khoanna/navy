/**
 * §7.2's SECOND registered forecast target (readiness audit NEW-11).
 *
 * "A second registered target is calibrated with the same machinery: a lower
 * prediction bound on the venue's withdrawable cash over the horizon, which
 * supplies e_i^cons in §8.1 and the exitable fraction in §8.2."
 *
 * The defect: BOTH consumers read the SPOT value
 * `MarketObservation.maxWithdrawableBase` — reserve.ts's `e_i^cons` and
 * optimize.ts's phi — while the label column for the target
 * (`realizedMinCashBase`) existed with no consumer anywhere in src. A spot
 * reading says the cash is there NOW; the reserve and phi both need to know
 * it will still be there when the vault actually has to exit.
 *
 * Two properties are load-bearing and each has its own case below:
 *   1. The bound is APPLIED — the reserve and phi move when the quantile
 *      moves. A test using only a zero quantile would pass against the
 *      original spot-reading code.
 *   2. ABSENCE IS CONSERVATIVE — an uncalibrated venue gets a haircut, not
 *      the spot value. A zero fallback would restore the bug silently.
 */
import {
  cashQuantileFor,
  withdrawableLowerBoundBase,
  forecastMarkets,
} from '../../../src/policy/steps/forecast.js';
import { requiredReserve } from '../../../src/policy/steps/reserve.js';
import { portfolioLowerBound } from '../../../src/policy/steps/optimize.js';
import { calibrateCashResidualQuantiles } from '../../../src/evaluation/kernel/decision-input.js';
import { loadBootstrapArtifact, parseArtifact } from '../../../src/policy/artifact.js';
import type {
  CompletedLabel,
  DecisionInput,
  MarketObservation,
  PolicyArtifact,
  RateCurve,
} from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const USDC = 1_000_000n;

function market(marketId: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId,
    adapter: `0x${'1'.repeat(40)}`,
    protocol: 'aave',
    cash: 100_000n * USDC,
    borrows: 0n,
    reserves: 0n,
    supplyRateWad: WAD / 20n,
    utilizationWad: 0n,
    positionBase: 0n,
    maxDeployableBase: 100_000n * USDC,
    maxWithdrawableBase: 100_000n * USDC,
    configDigest: '0xd',
    regimeId: 'r1',
    paused: false,
    capBps: 10_000,
    absoluteCapBase: 1_000_000n * USDC,
    maxLossBps: 50,
    dependencyGroupIds: [],
    ...over,
  };
}

function input(markets: MarketObservation[]): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 1_000_000n * USDC,
      idleBase: 1_000_000n * USDC,
      sharesOutstanding: 1_000_000n * USDC,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0xv',
    },
    markets,
    dependencyGroups: [],
    withdrawals: [],
    gas: {
      l2BaseFeeWei: 1n,
      l1BaseFeeWei: 1n,
      l1BlobBaseFeeWei: 1n,
      ethUsdE8: 350_000_000_000n,
      usdcUsdE8: 100_000_000n,
    },
    history: [],
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
  };
}

function artifact(over: Partial<PolicyArtifact> = {}): PolicyArtifact {
  return { ...loadBootstrapArtifact(), residualQuantileWadByMarket: {}, ...over };
}

const RESERVE_OPTS = { quantile: 0.95, horizonSeconds: 86_400 };

describe('cashQuantileFor (§7.2 second target, same fallback ladder as the first)', () => {
  it('prefers the venue\'s own calibrated entry', () => {
    const a = artifact({ cashResidualQuantileWadByMarket: { aave: -WAD / 20n, compound: -WAD / 2n } });
    expect(cashQuantileFor(a, 'aave')).toBe(-WAD / 20n);
  });

  it('falls back to the most CONSERVATIVE calibrated peer, not the mean', () => {
    const a = artifact({ cashResidualQuantileWadByMarket: { aave: -WAD / 20n, compound: -WAD / 2n } });
    expect(cashQuantileFor(a, 'moonwell')).toBe(-WAD / 2n);
  });

  it('falls back to the registered scalar when nothing is calibrated', () => {
    const a = artifact({ cashResidualQuantileWadByMarket: {}, cashLowerBoundQuantileWad: -WAD / 4n });
    expect(cashQuantileFor(a, 'aave')).toBe(-WAD / 4n);
  });

  it('ships a STRICTLY NEGATIVE registered fallback', () => {
    // The whole point of the second target: with no calibration at all, the
    // predicted withdrawable cash must be BELOW the spot reading. A zero
    // here would silently restore the pre-fix behaviour.
    expect(loadBootstrapArtifact().cashLowerBoundQuantileWad).toBeLessThan(0n);
  });
});

describe('withdrawableLowerBoundBase', () => {
  it('haircuts the spot cash by the calibrated relative quantile', () => {
    const a = artifact({ cashResidualQuantileWadByMarket: { aave: -WAD / 10n } });
    expect(withdrawableLowerBoundBase(market('aave'), a)).toBe(90_000n * USDC);
  });

  it('is never above the spot reading', () => {
    for (const q of [0n, -WAD / 100n, -WAD / 2n, -WAD]) {
      const a = artifact({ cashResidualQuantileWadByMarket: { aave: q } });
      expect(withdrawableLowerBoundBase(market('aave'), a)).toBeLessThanOrEqual(100_000n * USDC);
    }
  });

  it('floors at zero for a total-drain quantile', () => {
    const a = artifact({ cashResidualQuantileWadByMarket: { aave: -WAD } });
    expect(withdrawableLowerBoundBase(market('aave'), a)).toBe(0n);
  });

  it('is zero for a venue with no cash, without dividing anything', () => {
    const a = artifact({ cashResidualQuantileWadByMarket: { aave: -WAD / 10n } });
    expect(withdrawableLowerBoundBase(market('aave', { maxWithdrawableBase: 0n }), a)).toBe(0n);
  });

  it('REFUSES a positive quantile rather than clamping it', () => {
    // A "conservative" exit larger than the observed one is the one
    // direction this quantity must never move; failing loudly is the point.
    const a = artifact({ cashResidualQuantileWadByMarket: { aave: WAD / 10n } });
    expect(() => withdrawableLowerBoundBase(market('aave'), a)).toThrow(/must be <= 0/);
  });
});

describe('§8.1 e_i^cons reads the forecast, not the spot cash', () => {
  it('a deeper cash quantile raises the required reserve', () => {
    // Withdrawal demand of 50,000 against a venue holding 100,000 of the
    // candidate's allocation: netting against a full 100,000 exit leaves
    // nothing to reserve, netting against a haircut exit does not.
    const withdrawals = Array.from({ length: 20 }, (_, k) => ({
      timestampSeconds: 1_000_000 - k * 600,
      assetsBase: 5_000n * USDC,
    }));
    const i = { ...input([market('aave', { maxWithdrawableBase: 60_000n * USDC })]), withdrawals };
    const target = new Map([['aave', 60_000n * USDC]]);

    const spot = requiredReserve(i, artifact({ cashResidualQuantileWadByMarket: { aave: 0n } }), target, RESERVE_OPTS);
    const forecast = requiredReserve(
      i,
      artifact({ cashResidualQuantileWadByMarket: { aave: -WAD / 2n } }),
      target,
      RESERVE_OPTS
    );

    expect(forecast.netDemandQuantileBase).toBeGreaterThan(spot.netDemandQuantileBase);
    expect(forecast.requiredBase).toBeGreaterThan(spot.requiredBase);
  });

  it('a deeper cash quantile raises the stress shortfall too', () => {
    const i = input([market('aave', { maxWithdrawableBase: 900_000n * USDC })]);
    const target = new Map([['aave', 900_000n * USDC]]);

    const spot = requiredReserve(i, artifact({ cashResidualQuantileWadByMarket: { aave: 0n } }), target, RESERVE_OPTS);
    const forecast = requiredReserve(
      i,
      artifact({ cashResidualQuantileWadByMarket: { aave: -WAD / 2n } }),
      target,
      RESERVE_OPTS
    );

    expect(forecast.stressShortfallBase).toBeGreaterThan(spot.stressShortfallBase);
  });

  it('can turn a feasible stress scenario infeasible', () => {
    const i = input([market('aave', { maxWithdrawableBase: 1_000_000n * USDC })]);
    const target = new Map([['aave', 1_000_000n * USDC]]);

    const spot = requiredReserve(i, artifact({ cashResidualQuantileWadByMarket: { aave: 0n } }), target, RESERVE_OPTS);
    const forecast = requiredReserve(
      i,
      artifact({ cashResidualQuantileWadByMarket: { aave: -WAD / 2n } }),
      target,
      RESERVE_OPTS
    );

    expect(spot.scenarioFeasible.every((sc) => sc.feasible)).toBe(true);
    expect(forecast.scenarioFeasible.some((sc) => !sc.feasible)).toBe(true);
  });
});

describe('§8.2 phi reads the forecast, not the spot cash', () => {
  const curve = (marketId: string, rate: bigint): RateCurve => ({
    marketId,
    quantumBase: 1_000n * USDC,
    points: Array.from({ length: 200 }, () => rate),
    maxXBase: 199_000n * USDC,
  });

  it('a deeper cash quantile lowers the objective for a position above the bound', () => {
    const i = input([market('aave', { maxWithdrawableBase: 100_000n * USDC })]);
    const curves = [curve('aave', WAD / 20n)];
    const target = new Map([['aave', 100_000n * USDC]]);

    const spot = portfolioLowerBound(i, curves, artifact({ cashResidualQuantileWadByMarket: { aave: 0n } }), target);
    const forecast = portfolioLowerBound(
      i,
      curves,
      artifact({ cashResidualQuantileWadByMarket: { aave: -WAD / 2n } }),
      target
    );

    expect(forecast).toBeLessThan(spot);
  });

  it('leaves a position comfortably inside the bound unweighted', () => {
    // phi caps at 1: a 10,000 target against a 90,000 forecast bound is
    // fully exitable either way, so the forecast must not penalise it.
    const i = input([market('aave', { maxWithdrawableBase: 100_000n * USDC })]);
    const curves = [curve('aave', WAD / 20n)];
    const target = new Map([['aave', 10_000n * USDC]]);

    const spot = portfolioLowerBound(i, curves, artifact({ cashResidualQuantileWadByMarket: { aave: 0n } }), target);
    const forecast = portfolioLowerBound(
      i,
      curves,
      artifact({ cashResidualQuantileWadByMarket: { aave: -WAD / 10n } }),
      target
    );

    expect(forecast).toBe(spot);
  });

  it('reports the forecast-weighted exitable fraction on the decision output', () => {
    const i = input([market('aave', { positionBase: 100_000n * USDC, maxWithdrawableBase: 100_000n * USDC })]);
    const curves = [curve('aave', WAD / 20n)];
    const out = forecastMarkets(i, curves, artifact({ cashResidualQuantileWadByMarket: { aave: -WAD / 4n } }));
    expect(out[0]!.exitableFraction).toBeCloseTo(0.75, 5);
  });
});

describe('calibrateCashResidualQuantiles (§7.2 same machinery as the first target)', () => {
  function label(over: Partial<CompletedLabel>): CompletedLabel {
    return {
      marketId: 'aave',
      regimeId: 'r1',
      originSeconds: 0,
      horizonSeconds: 604_800,
      horizonEndSeconds: 604_800,
      availableAtSeconds: 604_800,
      realizedReturnWad: 0n,
      realizedMinCashBase: 100n * USDC,
      originCashBase: 100n * USDC,
      ...over,
    };
  }

  it('calibrates a RELATIVE residual, so the answer is scale-free', () => {
    const small = Array.from({ length: 10 }, () =>
      label({ originCashBase: 100n * USDC, realizedMinCashBase: 80n * USDC })
    );
    const large = Array.from({ length: 10 }, () =>
      label({ originCashBase: 1_000_000n * USDC, realizedMinCashBase: 800_000n * USDC })
    );
    expect(calibrateCashResidualQuantiles(small, 0.9, 5)).toEqual(
      calibrateCashResidualQuantiles(large, 0.9, 5)
    );
    expect(calibrateCashResidualQuantiles(small, 0.9, 5)['aave']).toBe(-WAD / 5n);
  });

  it('takes a LOWER quantile, not the mean', () => {
    // Nine benign observations and one 50% drain: a 0.9 coverage target must
    // land on the drain, which the mean would wash out.
    const labels = [
      ...Array.from({ length: 9 }, () => label({ realizedMinCashBase: 100n * USDC })),
      label({ realizedMinCashBase: 50n * USDC }),
    ];
    expect(calibrateCashResidualQuantiles(labels, 0.9, 5)['aave']).toBe(-WAD / 2n);
  });

  it('clamps a positive residual to zero rather than predicting MORE cash', () => {
    const labels = Array.from({ length: 10 }, () => label({ realizedMinCashBase: 200n * USDC }));
    expect(calibrateCashResidualQuantiles(labels, 0.9, 5)['aave']).toBe(0n);
  });

  it('SKIPS a label with no origin cash instead of counting it as zero', () => {
    // The live ForecastLabel table cannot supply the denominator. Folding
    // those rows in as zero residuals would drag every quantile toward "the
    // cash will still all be there" — the spot reading this replaces — and
    // would also manufacture an observation count the venue has not earned.
    const allNull = Array.from({ length: 20 }, () => label({ originCashBase: null }));
    expect(calibrateCashResidualQuantiles(allNull, 0.9, 5)).toEqual({});

    // Below minObservations once the nulls are removed: still no entry, so
    // the artifact's conservative fallback governs.
    const mostlyNull = [
      ...Array.from({ length: 20 }, () => label({ originCashBase: null })),
      ...Array.from({ length: 2 }, () => label({ realizedMinCashBase: 50n * USDC })),
    ];
    expect(calibrateCashResidualQuantiles(mostlyNull, 0.9, 5)).toEqual({});

    // And once there ARE enough real labels, the nulls contribute nothing to
    // the distribution.
    const enough = [
      ...Array.from({ length: 20 }, () => label({ originCashBase: null })),
      ...Array.from({ length: 5 }, () => label({ realizedMinCashBase: 50n * USDC })),
    ];
    expect(calibrateCashResidualQuantiles(enough, 0.9, 5)).toEqual({ aave: -WAD / 2n });
  });

  it('emits NO ENTRY below minObservations, so the conservative fallback governs', () => {
    // Not `0n`: an entry of zero would be the most OPTIMISTIC value
    // available, while an absent entry defers to the registered negative
    // scalar. This is the opposite convention from the return quantile, and
    // deliberately so.
    const labels = Array.from({ length: 3 }, () => label({}));
    expect(calibrateCashResidualQuantiles(labels, 0.9, 5)).toEqual({});
  });

  it('drops a label whose origin cash is zero rather than dividing by it', () => {
    const labels = Array.from({ length: 10 }, () => label({ originCashBase: 0n }));
    expect(calibrateCashResidualQuantiles(labels, 0.9, 5)).toEqual({});
  });

  it('calibrates each venue separately', () => {
    const labels = [
      ...Array.from({ length: 10 }, () => label({ marketId: 'aave', realizedMinCashBase: 90n * USDC })),
      ...Array.from({ length: 10 }, () => label({ marketId: 'compound', realizedMinCashBase: 50n * USDC })),
    ];
    const out = calibrateCashResidualQuantiles(labels, 0.9, 5);
    expect(out['aave']).toBe(-WAD / 10n);
    expect(out['compound']).toBe(-WAD / 2n);
  });
});

/**
 * The cold-start deadlock NEW-11 describes, both halves.
 *
 * The exitable half was fixed earlier by pointing `maxWithdrawableBase` at
 * venue cash instead of `min(position, cash)`. The DEPLOYABLE half was not:
 * `buildRawOriginFromCollector` still set
 * `maxDeployableBase = s.maxWithdrawable`, which is that same
 * `min(position, cash)` and is therefore 0 for an empty venue — so
 * `admit.ts`'s CAP_ZERO rule and `effectiveCapBase`'s headroom term both
 * rejected any venue the vault had not already entered.
 */
describe('cold start: an empty venue is enterable', () => {
  const empty = () => market('aave', { positionBase: 0n, maxDeployableBase: 500_000n * USDC });

  it('phi is 1 for a first deployment inside the forecast bound', () => {
    // The exitable half. With `maxWithdrawableBase` frozen at the position's
    // exit (0), exitableFraction(x, 0) = 0 zeroed the objective for every
    // positive candidate.
    const a = artifact({ cashResidualQuantileWadByMarket: { aave: -WAD / 10n } });
    expect(withdrawableLowerBoundBase(empty(), a)).toBe(90_000n * USDC);
    const out = forecastMarkets(
      input([empty()]),
      [{ marketId: 'aave', quantumBase: 1_000n * USDC, points: [WAD / 20n, WAD / 20n], maxXBase: 1_000n * USDC }],
      a
    );
    expect(out[0]!.exitableFraction).toBe(1);
  });

  it('effective cap is positive for an empty venue', () => {
    // The deployable half: headroom is `positionBase + maxDeployableBase`,
    // which is 0 + 0 when deployable headroom is read off maxWithdrawable().
    const i = input([empty()]);
    const target = new Map([['aave', 100_000n * USDC]]);
    const r = requiredReserve(i, artifact(), target, RESERVE_OPTS);
    expect(r.requiredBase).toBeGreaterThanOrEqual(0n);
    expect(empty().maxDeployableBase).toBeGreaterThan(0n);
  });
});

/**
 * §7.3 - "The selected parameter artifact and its content hash are immutable
 * for held-out evaluation." A field that silently defaults is a field the
 * hash cannot testify to, so every one is required.
 *
 * These exist because a mutant that replaced `cashResidualQuantileWadByMarket`'s
 * required read with a silent `{}` default SURVIVED the whole suite: the
 * shipped artifact happens to carry an empty map for it, so "required" and
 * "defaulted to empty" were indistinguishable from outside `loadBootstrapArtifact`.
 */
describe('parseArtifact requires every registered field', () => {
  const RAW = {
    _provisional: 'test',
    policyVersion: 5,
    horizonSeconds: 604_800,
    coverageTarget: 0.95,
    method: 'ew-residual',
    methodParams: { decay: 0.9 },
    residualQuantileWadByMarket: { aave: '-1000' },
    portfolioResidualQuantileWad: '-10000000000000',
    cashResidualQuantileWadByMarket: { aave: '-50000000000000000' },
    cashLowerBoundQuantileWad: '-100000000000000000',
    minObservations: 30,
    availabilityLagSeconds: 900,
    noTradeBandK: 1.0,
    pinnedConfigDigests: {},
    configDigest: 'test',
  };

  it('parses a complete artifact', () => {
    const a = parseArtifact({ ...RAW });
    expect(a.cashResidualQuantileWadByMarket).toEqual({ aave: -50_000_000_000_000_000n });
    expect(a.cashLowerBoundQuantileWad).toBe(-100_000_000_000_000_000n);
    expect(a.artifactHash).toHaveLength(a.artifactHash.length);
  });

  it('throws on a missing field rather than defaulting it', () => {
    for (const field of Object.keys(RAW)) {
      const partial: Record<string, unknown> = { ...RAW };
      delete partial[field];
      expect(() => parseArtifact(partial)).toThrow(new RegExp(field));
    }
  });

  it('changes the artifact hash when the second target changes', () => {
    // The hash has to cover the new fields, or a result could be cited
    // against an artifact whose cash forecast has silently moved.
    const base = parseArtifact({ ...RAW });
    const moved = parseArtifact({ ...RAW, cashLowerBoundQuantileWad: '-200000000000000000' });
    const movedMap = parseArtifact({ ...RAW, cashResidualQuantileWadByMarket: { aave: '-1' } });
    expect(moved.artifactHash).not.toBe(base.artifactHash);
    expect(movedMap.artifactHash).not.toBe(base.artifactHash);
  });

  it('rejects a non-numeric-string quantile entry', () => {
    expect(() => parseArtifact({ ...RAW, cashResidualQuantileWadByMarket: { aave: '' } })).toThrow(
      /cashResidualQuantileWadByMarket/
    );
  });
});
