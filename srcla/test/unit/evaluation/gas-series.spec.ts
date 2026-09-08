import {
  gasAt,
  gasSeriesFrom,
  isGasSeries,
  type GasRow,
} from '../../../src/evaluation/gas-series.js';

const row = (t: number, l2: bigint, eth: bigint): GasRow => ({
  timestampSeconds: t,
  l2BaseFeeWei: l2,
  l1BaseFeeWei: 8_000_000_000n,
  l1BlobBaseFeeWei: 1n,
  ethUsdE8: eth,
  usdcUsdE8: 100_000_000n,
});

const ROWS = [
  row(1000, 700_000n, 300_000_000_000n),
  row(2000, 3_800_000n, 400_000_000_000n),
  row(3000, 1_200_000n, 350_000_000_000n),
];

describe('gasSeriesFrom — resolution', () => {
  const s = gasSeriesFrom(ROWS);

  it('returns the observation at an exact origin', () => {
    expect(s.at(2000).ethUsdE8).toBe(400_000_000_000n);
    expect(s.at(2000).l2BaseFeeWei).toBe(3_800_000n);
  });

  it('carries the LAST observation at or before an origin, never a later one', () => {
    // Reading forward would be look-ahead: the decision at t=1500 cannot know
    // what gas cost at t=2000.
    expect(s.at(1500).ethUsdE8).toBe(300_000_000_000n);
    expect(s.at(1999).l2BaseFeeWei).toBe(700_000n);
  });

  it('carries the last observation forward past the end of the series', () => {
    expect(s.at(999_999).ethUsdE8).toBe(350_000_000_000n);
  });

  it('THROWS before the first observation rather than extrapolating backwards', () => {
    // A gas price invented for a period nobody measured is a fabricated cost,
    // and the §9.1 gate is priced off exactly that number.
    expect(() => s.at(999)).toThrow(/no gas observation/i);
    expect(() => s.at(999)).toThrow(/invent a cost/i);
  });

  it('refuses to build an empty series rather than falling back to a constant', () => {
    expect(() => gasSeriesFrom([])).toThrow(/no measured gas observations/i);
    expect(() => gasSeriesFrom([])).toThrow(/backfill:history/);
  });

  it('resolves correctly for every origin across the whole span', () => {
    for (let t = 1000; t <= 3500; t += 7) {
      const expected = [...ROWS].reverse().find((r) => r.timestampSeconds <= t)!;
      expect(s.at(t).l2BaseFeeWei).toBe(expected.l2BaseFeeWei);
    }
  });

  it('lets a re-collected origin supersede rather than duplicate', () => {
    const s2 = gasSeriesFrom([row(1000, 1n, 1n), row(1000, 2n, 2n)]);
    expect(s2.length).toBe(1);
    expect(s2.at(1000).l2BaseFeeWei).toBe(2n);
  });

  it('sorts unordered input rather than trusting the query order', () => {
    const s2 = gasSeriesFrom([ROWS[2]!, ROWS[0]!, ROWS[1]!]);
    expect(s2.at(1500).ethUsdE8).toBe(300_000_000_000n);
    expect(s2.firstSeconds).toBe(1000);
    expect(s2.lastSeconds).toBe(3000);
  });
});

describe('gasSeriesFrom — provenance', () => {
  it('digests the observations, so a swapped series over the same window is detectable', () => {
    // The manifest's dataset hash covers snapshots and withdrawals only.
    // Without this digest a substituted gas series would reproduce the same
    // dataset hash while changing every cost-gate decision.
    const a = gasSeriesFrom(ROWS);
    const b = gasSeriesFrom([ROWS[0]!, ROWS[1]!, row(3000, 9_999_999n, 350_000_000_000n)]);
    expect(a.digest).not.toBe(b.digest);
    expect(a.digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is order-independent, so the same data always digests the same', () => {
    expect(gasSeriesFrom(ROWS).digest).toBe(gasSeriesFrom([...ROWS].reverse()).digest);
  });

  it('summarises the range the run actually saw', () => {
    const s = gasSeriesFrom(ROWS);
    expect(s.summary.observations).toBe(3);
    expect(s.summary.minL2BaseFeeWei).toBe('700000');
    expect(s.summary.maxL2BaseFeeWei).toBe('3800000');
    expect(s.summary.minEthUsdE8).toBe('300000000000');
    expect(s.summary.maxEthUsdE8).toBe('400000000000');
  });
});

describe('gasAt / isGasSeries', () => {
  const constant = {
    l2BaseFeeWei: 30_000_000n,
    l1BaseFeeWei: 8_000_000_000n,
    l1BlobBaseFeeWei: 10_000_000n,
    ethUsdE8: 350_000_000_000n,
    usdcUsdE8: 100_000_000n,
  };

  it('passes a bare observation through unchanged, so existing tests keep working', () => {
    expect(isGasSeries(constant)).toBe(false);
    expect(gasAt(constant, 12_345)).toBe(constant);
    expect(gasAt(constant, 999_999_999)).toBe(constant);
  });

  it('resolves a series at the given origin', () => {
    const s = gasSeriesFrom(ROWS);
    expect(isGasSeries(s)).toBe(true);
    expect(gasAt(s, 2500).l2BaseFeeWei).toBe(3_800_000n);
  });
});
