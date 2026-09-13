import {
  C6_DECISION_TIER,
  C6_GAP_THRESHOLD_APY,
  decideCalibrationGap,
  type C6Row,
} from '../../../src/evaluation/calibration-gap.js';

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
});
