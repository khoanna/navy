import {
  C6_DECISION_TIER,
  C6_GAP_THRESHOLD_APY,
  assertCalibrationOnly,
  decideCalibrationGap,
  splitWarmup,
  timeAveragedVenueWeights,
  venueWeightsAt,
  type C6Row,
} from '../../../src/evaluation/calibration-gap.js';
import type { TimeOrderedSnapshot } from '../../../src/evaluation/dataset.js';

const row = (policyId: string, netApy: number, over: Partial<C6Row> = {}): C6Row => ({
  policyId,
  tier: C6_DECISION_TIER,
  netApy,
  capitalAtWork: 0.94,
  minStressedCoverage: 1,
  ...over,
});

describe('C6 decision — the gap criterion fixed before the run', () => {
  it('finds no gap when B4 leads by less than 21.5 bps', () => {
    const d = decideCalibrationGap([row('srcla', 0.03), row('b4', 0.0321), row('h1', 0.0321), row('h7', 0.03)]);
    expect(d.outcome).toBe('NO_GAP');
    expect(d.qualifying).toEqual([]);
    expect(d.ablations.find((a) => a.policyId === 'h1')!.reasons).toContain('no calibration gap to close');
  });

  it('treats a lead of exactly 21.5 bps as a gap', () => {
    const d = decideCalibrationGap([
      row('srcla', 0.03),
      row('b4', 0.03 + C6_GAP_THRESHOLD_APY),
      row('h1', 0.03),
      row('h7', 0.03),
    ]);
    expect(d.outcome).toBe('GAP_NO_QUALIFYING_COMPONENT');
    expect(d.gapApy).toBeCloseTo(0.00215, 12);
  });

  it('qualifies an ablation that closes at least half the gap with coverage and capital at work held', () => {
    const d = decideCalibrationGap([
      row('srcla', 0.03),
      row('b4', 0.034),
      row('h1', 0.0325, { capitalAtWork: 0.945 }),
      row('h7', 0.0305),
    ]);
    expect(d.outcome).toBe('GAP_COMPONENT_QUALIFIES');
    expect(d.qualifying).toEqual(['h1']);
    const h1 = d.ablations.find((a) => a.policyId === 'h1')!;
    expect(h1.gapClosedFraction).toBeCloseTo(0.625, 10);
    expect(h1.qualifies).toBe(true);
    const h7 = d.ablations.find((a) => a.policyId === 'h7')!;
    expect(h7.qualifies).toBe(false);
    expect(h7.reasons.join(' ')).toMatch(/below 50%/);
  });

  it('counts exactly half the gap as closed', () => {
    const d = decideCalibrationGap([row('srcla', 0.03), row('b4', 0.034), row('h1', 0.032), row('h7', 0.03)]);
    expect(d.qualifying).toEqual(['h1']);
  });

  it('disqualifies an ablation whose min stressed coverage falls below 0.95', () => {
    const d = decideCalibrationGap([
      row('srcla', 0.03),
      row('b4', 0.034),
      row('h1', 0.034, { minStressedCoverage: 0.94 }),
      row('h7', 0.03),
    ]);
    expect(d.outcome).toBe('GAP_NO_QUALIFYING_COMPONENT');
    expect(d.ablations.find((a) => a.policyId === 'h1')!.reasons.join(' ')).toMatch(/below 0\.95/);
  });

  it('disqualifies an ablation whose capital at work drifts more than 0.01 from SRCLA', () => {
    const d = decideCalibrationGap([
      row('srcla', 0.03),
      row('b4', 0.034),
      row('h1', 0.034, { capitalAtWork: 0.96 }),
      row('h7', 0.03),
    ]);
    expect(d.outcome).toBe('GAP_NO_QUALIFYING_COMPONENT');
    expect(d.ablations.find((a) => a.policyId === 'h1')!.reasons.join(' ')).toMatch(/above 0\.01/);
  });

  it('reports both components when both qualify', () => {
    const d = decideCalibrationGap([row('srcla', 0.03), row('b4', 0.034), row('h1', 0.034), row('h7', 0.034)]);
    expect(d.qualifying).toEqual(['h1', 'h7']);
  });

  it('refuses to decide without a B4 row at the 1M tier', () => {
    expect(() =>
      decideCalibrationGap([
        row('srcla', 0.03),
        row('b4', 0.034, { tier: 10_000_000_000n }),
        row('h1', 0.03),
        row('h7', 0.03),
      ]),
    ).toThrow(/no b4 row/);
  });

  it('refuses a NaN netApy at the decision tier instead of silently passing it through', () => {
    expect(() =>
      decideCalibrationGap([row('srcla', 0.03), row('b4', NaN), row('h1', 0.03), row('h7', 0.03)]),
    ).toThrow(/C6:.*b4.*1000000000000.*netApy/);
  });

  it('refuses a JSON null (parsed as unknown) standing in for a numeric field', () => {
    const b4 = row('b4', 0.034, { capitalAtWork: JSON.parse('null') as unknown as number });
    expect(() => decideCalibrationGap([row('srcla', 0.03), b4, row('h1', 0.03), row('h7', 0.03)])).toThrow(
      /C6:.*b4.*1000000000000.*capitalAtWork/,
    );
  });

  it('refuses a duplicate policy@tier row instead of silently taking the first', () => {
    expect(() =>
      decideCalibrationGap([
        row('srcla', 0.03),
        row('b4', 0.034),
        row('b4', 0.05), // duplicate b4@1M — `find` would silently take the first
        row('h1', 0.03),
        row('h7', 0.03),
      ]),
    ).toThrow(/C6:.*duplicate.*b4.*1000000000000/);
  });

  it('refuses a duplicate row at a non-decision tier too', () => {
    expect(() =>
      decideCalibrationGap([
        row('srcla', 0.03),
        row('b4', 0.034),
        row('h1', 0.03),
        row('h7', 0.03),
        row('srcla', 0.03, { tier: 10_000_000_000n }),
        row('srcla', 0.031, { tier: 10_000_000_000n }),
      ]),
    ).toThrow(/C6:.*duplicate.*srcla.*10000000000/);
  });

  it('refuses a non-finite minStressedCoverage even when netApy shows a real gap', () => {
    expect(() =>
      decideCalibrationGap([
        row('srcla', 0.03),
        row('b4', 0.0304, { minStressedCoverage: NaN }),
        row('h1', 0.03, { minStressedCoverage: NaN }),
        row('h7', 0.03),
      ]),
    ).toThrow(/C6:.*minStressedCoverage/);
  });
});

const HOUR_MS = 3_600_000;
const origins = (count: number, startIso = '2024-03-15T00:00:00Z'): TimeOrderedSnapshot[] =>
  Array.from({ length: count }, (_, i) => ({
    index: i,
    timestamp: new Date(Date.parse(startIso) + i * HOUR_MS),
    blockHash: '0x',
    snapshots: [],
  }));

describe('C6 venue weights', () => {
  it('reads each venue as its share of total assets', () => {
    expect(
      venueWeightsAt({
        totalAssets: 1_000_000n,
        holdingsBaseByMarket: { 'aave-v3-usdc': 250_000n, 'moonwell-usdc': 500_000n },
      }),
    ).toEqual({ 'aave-v3-usdc': 0.25, 'moonwell-usdc': 0.5 });
  });

  it('gives no weights for a vault holding nothing', () => {
    expect(venueWeightsAt({ totalAssets: 0n, holdingsBaseByMarket: { 'aave-v3-usdc': 0n } })).toEqual({});
  });

  it('averages over every origin, counting an absent venue as zero', () => {
    expect(
      timeAveragedVenueWeights([
        { totalAssets: 1_000_000n, holdingsBaseByMarket: { 'aave-v3-usdc': 500_000n } },
        { totalAssets: 1_000_000n, holdingsBaseByMarket: {} },
      ]),
    ).toEqual({ 'aave-v3-usdc': 0.25 });
  });
});

describe('C6 warm-up split', () => {
  it('takes the first 31 days as warm-up and evaluates from 2024-04-15', () => {
    const all = origins(24 * 40);
    const { warmup, evaluated } = splitWarmup(all, 31);
    expect(warmup).toHaveLength(24 * 31);
    expect(evaluated[0]!.timestamp.toISOString()).toBe('2024-04-15T00:00:00.000Z');
    expect(warmup.length + evaluated.length).toBe(all.length);
  });

  it('refuses an empty era', () => {
    expect(() => splitWarmup([], 31)).toThrow(/holds no origins/);
  });

  it('refuses a warm-up that leaves nothing to evaluate', () => {
    expect(() => splitWarmup(origins(24 * 10), 31)).toThrow(/nothing left to evaluate/);
  });
});

describe('C6 calibration-only guard', () => {
  it('accepts calibration origins', () => {
    expect(() => assertCalibrationOnly(origins(3), 'test')).not.toThrow();
  });

  it('refuses an origin in a sealed era', () => {
    expect(() => assertCalibrationOnly(origins(1, '2026-08-30T00:00:00Z'), 'test')).toThrow(/heldout-b/);
  });

  it('refuses an origin outside every registered era', () => {
    expect(() => assertCalibrationOnly(origins(1, '2024-01-01T00:00:00Z'), 'test')).toThrow(/'none'/);
  });
});
