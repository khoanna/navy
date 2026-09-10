/**
 * The three §11.5 sustainability measurements. Each test pins a case where
 * the natural sloppy implementation would report a flattering number.
 */
import {
  displayedVsRealizedGap,
  timeToFullExit,
  venueStressContribution,
} from '../../../src/evaluation/replay/sustainability-metrics.js';

const M = 1_000_000n;

describe('timeToFullExit', () => {
  const origin = (nav: bigint, idle: bigint, exitable: bigint) => ({
    navBase: nav,
    idleBase: idle,
    exitCapacityBase: exitable,
  });

  it('is 0 when the whole vault is exitable at the stress origin itself', () => {
    const series = [origin(100n * M, 40n * M, 60n * M)];
    expect(timeToFullExit(series, { startIndex: 0 })).toBe(0);
  });

  it('counts the origins a drip-fed exit needs', () => {
    const series = Array.from({ length: 10 }, () => origin(100n * M, 0n, 25n * M));
    // 25% per origin: origins 0..3 raise 100%.
    expect(timeToFullExit(series, { startIndex: 0 })).toBe(3);
  });

  it('is null when the vault never fully exits inside the window', () => {
    const series = Array.from({ length: 5 }, () => origin(100n * M, 0n, 1n * M));
    expect(timeToFullExit(series, { startIndex: 0 })).toBeNull();
  });

  it('measures from the stress origin, not from the start of the run', () => {
    const series = [
      origin(100n * M, 100n * M, 0n), // calm: fully liquid
      origin(100n * M, 0n, 10n * M), // stress begins here
      ...Array.from({ length: 20 }, () => origin(100n * M, 0n, 10n * M)),
    ];
    expect(timeToFullExit(series, { startIndex: 0 })).toBe(0);
    expect(timeToFullExit(series, { startIndex: 1 })).toBe(9);
  });

  it('is null past the end of the series rather than 0', () => {
    expect(timeToFullExit([], { startIndex: 0 })).toBeNull();
    expect(timeToFullExit([origin(1n, 1n, 0n)], { startIndex: 5 })).toBeNull();
  });
});

describe('venueStressContribution', () => {
  it('time-weights over EVERY origin, not only the ones the venue was held', () => {
    const out = venueStressContribution([{ a: 0.4 }, {}, {}, {}]);
    expect(out['a']).toBeCloseTo(0.1);
  });

  it('reports each venue separately', () => {
    const out = venueStressContribution([
      { a: 0.2, b: 0.6 },
      { a: 0.4, b: 0.4 },
    ]);
    expect(out['a']).toBeCloseTo(0.3);
    expect(out['b']).toBeCloseTo(0.5);
  });

  it('is empty for an empty series rather than asserting a zero share', () => {
    expect(venueStressContribution([])).toEqual({});
  });
});

describe('displayedVsRealizedGap', () => {
  it('is the advertised rate minus what was actually kept', () => {
    const series = [
      { displayedApy: 0.05, deployedBase: 100n * M },
      { displayedApy: 0.05, deployedBase: 100n * M },
    ];
    expect(displayedVsRealizedGap(series, 0.03)).toBeCloseTo(0.02);
  });

  it('weights by deployed capital, so an idle origin does not flatter the gap', () => {
    const series = [
      { displayedApy: 0.1, deployedBase: 900n * M },
      { displayedApy: 0.0, deployedBase: 0n },
    ];
    expect(displayedVsRealizedGap(series, 0.1)).toBeCloseTo(0);
  });

  it('advertises nothing when nothing was ever deployed', () => {
    expect(displayedVsRealizedGap([{ displayedApy: 0.2, deployedBase: 0n }], 0)).toBeCloseTo(0);
  });
});
