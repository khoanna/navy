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

  const BOUND = 24;

  it('is 0 when the whole vault is exitable at the stress origin itself', () => {
    const series = [origin(100n * M, 40n * M, 60n * M)];
    expect(timeToFullExit(series, { startIndex: 0, boundOrigins: BOUND })).toEqual({
      origins: 0,
      censored: false,
    });
  });

  it('counts the origins a drip-fed exit needs', () => {
    const series = Array.from({ length: 10 }, () => origin(100n * M, 0n, 25n * M));
    // 25% per origin: origins 0..3 raise 100%.
    expect(timeToFullExit(series, { startIndex: 0, boundOrigins: BOUND }).origins).toBe(3);
  });

  // The distinction that keeps a spurious BREACH out of the report: the bound
  // was fully observable and capacity still never sufficed.
  it('is a MEASURED failure when the bound was observable and capacity never sufficed', () => {
    // 60 origins observable (well past the 24-origin bound) raising 1% each:
    // the bound was fully testable and the vault still cannot get out.
    const series = Array.from({ length: 60 }, () => origin(100n * M, 0n, 1n * M));
    expect(timeToFullExit(series, { startIndex: 0, boundOrigins: BOUND })).toEqual({
      origins: null,
      censored: false,
    });
  });

  it('is RIGHT-CENSORED when the window ended before the bound could be tested', () => {
    const series = Array.from({ length: 5 }, () => origin(100n * M, 0n, 1n * M));
    expect(timeToFullExit(series, { startIndex: 0, boundOrigins: BOUND })).toEqual({
      origins: null,
      censored: true,
    });
  });

  it('is censored when the stress origin sits at the very end of the era', () => {
    const series = Array.from({ length: 100 }, () => origin(100n * M, 0n, 1n * M));
    expect(timeToFullExit(series, { startIndex: 98, boundOrigins: BOUND }).censored).toBe(true);
  });

  it('measures from the stress origin, not from the start of the run', () => {
    const series = [
      origin(100n * M, 100n * M, 0n), // calm: fully liquid
      origin(100n * M, 0n, 10n * M), // stress begins here
      ...Array.from({ length: 20 }, () => origin(100n * M, 0n, 10n * M)),
    ];
    expect(timeToFullExit(series, { startIndex: 0, boundOrigins: BOUND }).origins).toBe(0);
    expect(timeToFullExit(series, { startIndex: 1, boundOrigins: BOUND }).origins).toBe(9);
  });

  it('is censored, not failed, past the end of the series', () => {
    expect(timeToFullExit([], { startIndex: 0, boundOrigins: BOUND })).toEqual({
      origins: null,
      censored: true,
    });
    expect(
      timeToFullExit([origin(1n, 1n, 0n)], { startIndex: 5, boundOrigins: BOUND }).censored,
    ).toBe(true);
  });
});

describe('venueStressContribution', () => {
  // The reason it is a max: an average over every origin dilutes a moment of
  // dominance into a number that clears the threshold.
  it('takes the MAXIMUM over origins, so a brief dominance is not diluted', () => {
    const out = venueStressContribution([{ a: 1.0 }, {}, {}, {}, {}, {}, {}, {}, {}, {}]);
    expect(out['a']).toBeCloseTo(1.0); // a mean would report 0.10 and clear 0.25
  });

  it('reports each venue separately', () => {
    const out = venueStressContribution([
      { a: 0.2, b: 0.6 },
      { a: 0.4, b: 0.4 },
    ]);
    expect(out['a']).toBeCloseTo(0.4);
    expect(out['b']).toBeCloseTo(0.6);
  });

  it('omits a venue the vault never held rather than asserting a zero share', () => {
    expect(venueStressContribution([])).toEqual({});
    expect(venueStressContribution([{ a: 0.1 }])).toEqual({ a: 0.1 });
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
