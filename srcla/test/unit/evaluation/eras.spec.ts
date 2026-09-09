import {
  ERAS_IN_ORDER,
  REGISTERED_ERAS,
  SEALED_ERAS,
  assertNotSealed,
  eraBounds,
  eraFor,
} from '../../../src/evaluation/eras.js';

const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

describe('registered eras — structure', () => {
  it('leaves no gap and no overlap between adjacent eras', () => {
    for (let i = 1; i < ERAS_IN_ORDER.length; i++) {
      expect(ERAS_IN_ORDER[i]!.startSeconds).toBe(ERAS_IN_ORDER[i - 1]!.endSeconds + 1);
    }
  });

  it('orders calibration strictly before the primary held-out era', () => {
    expect(REGISTERED_ERAS.calibration.endSeconds).toBeLessThan(
      REGISTERED_ERAS['heldout-c'].startSeconds,
    );
  });

  it('seals both held-out eras and neither of the others', () => {
    expect([...SEALED_ERAS].sort()).toEqual(['heldout-b', 'heldout-c']);
    expect(REGISTERED_ERAS.calibration.sealed).toBe(false);
    expect(REGISTERED_ERAS.burned.sealed).toBe(false);
    expect(REGISTERED_ERAS['burned-a'].sealed).toBe(false);
  });
});

describe("registered eras — paper §4.1's burned window", () => {
  it('places the burned window in its own era, at exactly the declared bounds', () => {
    // Paper §4.1 declares 2026-05-26 -> 2026-08-23 as design data.
    expect(eraFor(at('2026-05-26T00:00:00Z'))).toBe('burned');
    expect(eraFor(at('2026-08-23T12:00:00Z'))).toBe('burned');
    expect(eraFor(at('2026-08-23T23:59:59Z'))).toBe('burned');
  });

  it('excludes the burned window from calibration as well as from held-out', () => {
    // Disclosure 1: §4.1's letter puts it in calibration; doing so would place
    // fitting data after held-out A in time and invert walk-forward order.
    expect(eraFor(at('2026-06-15T00:00:00Z'))).not.toBe('calibration');
    expect(eraFor(at('2026-06-15T00:00:00Z'))).not.toBe('burned-a');
    expect(eraFor(at('2026-06-15T00:00:00Z'))).not.toBe('heldout-c');
    expect(eraFor(at('2026-06-15T00:00:00Z'))).not.toBe('heldout-b');
  });

  it('never lets the burned window intersect a held-out era', () => {
    // The one property §4.1 exists to guarantee. Asserted structurally rather
    // than by sampling, so it survives a boundary edit.
    const burned = REGISTERED_ERAS.burned;
    for (const tag of SEALED_ERAS) {
      const e = REGISTERED_ERAS[tag];
      const disjoint = e.endSeconds < burned.startSeconds || e.startSeconds > burned.endSeconds;
      expect(disjoint).toBe(true);
    }
  });

  it('puts the day before and the day after the burn in different eras', () => {
    expect(eraFor(at('2026-05-25T23:00:00Z'))).toBe('heldout-c');
    expect(eraFor(at('2026-08-24T00:00:00Z'))).toBe('heldout-b');
  });
});

describe('eraFor', () => {
  it('classifies each era from a representative origin', () => {
    expect(eraFor(at('2024-09-01T00:00:00Z'))).toBe('calibration');
    expect(eraFor(at('2025-03-15T12:00:00Z'))).toBe('calibration');
    expect(eraFor(at('2025-09-01T00:00:00Z'))).toBe('burned-a');
    expect(eraFor(at('2026-01-01T00:00:00Z'))).toBe('burned-a');
    expect(eraFor(at('2026-09-01T00:00:00Z'))).toBe('heldout-b');
  });

  it('returns null before the registered window rather than folding into the nearest era', () => {
    // The backfill may resolve a boundary block outside the window. Such a row
    // belongs to no era and must not be silently absorbed into one.
    expect(eraFor(at('2024-03-14T23:59:59Z'))).toBeNull();
    expect(eraFor(at('2023-01-01T00:00:00Z'))).toBeNull();
  });

  it('is inclusive at both boundaries, so no origin falls between two eras', () => {
    for (const era of ERAS_IN_ORDER) {
      expect(eraFor(era.startSeconds)).toBe(era.tag);
      expect(eraFor(era.endSeconds)).toBe(era.tag);
    }
  });
});

describe('assertNotSealed', () => {
  it('refuses to hand a sealed era to a fitting purpose', () => {
    expect(() => assertNotSealed('heldout-c', 'artifact calibration')).toThrow(/sealed/i);
    expect(() => assertNotSealed('heldout-b', 'grid sweep')).toThrow(/sealed/i);
  });

  it('names the purpose in the message, so a stack trace says what tried to peek', () => {
    expect(() => assertNotSealed('heldout-c', 'noTradeBandK sweep')).toThrow(/noTradeBandK sweep/);
  });

  it('allows the calibration era', () => {
    expect(() => assertNotSealed('calibration', 'artifact calibration')).not.toThrow();
  });

  it('allows the burned era, which is excluded but not secret', () => {
    // It is design data that has already been read; sealing it would be
    // theatre, and it is excluded from both fitting and evaluation by the era
    // boundaries themselves rather than by this guard.
    expect(() => assertNotSealed('burned', 'documenting what was burned')).not.toThrow();
  });

  it('allows burned-a, the former held-out era that reading v0.5 burned', () => {
    expect(() => assertNotSealed('burned-a', 'documenting what was burned')).not.toThrow();
  });
});

describe('eraBounds', () => {
  it('reports the registered spans a report table needs', () => {
    expect(eraBounds('calibration').days).toBe(443);
    expect(eraBounds('burned-a').days).toBe(273);
    expect(eraBounds('burned').days).toBe(90);
    expect(eraBounds('calibration').start).toBe('2024-03-15T00:00:00.000Z');
    expect(eraBounds('burned-a').start).toBe('2025-06-01T00:00:00.000Z');
  });
});

describe('v0.6 era re-cut', () => {
  it('extends calibration back to the deployment floor', () => {
    expect(eraBounds('calibration').start).toBe('2024-03-15T00:00:00.000Z');
    expect(eraBounds('calibration').days).toBe(443);
  });

  it('declares the former held-out era burned', () => {
    // Read in aggregate while diagnosing v0.5, so it is design data now.
    expect(eraFor(at('2025-06-01T00:00:00Z'))).toBe('burned-a');
    expect(eraFor(at('2026-02-28T12:00:00Z'))).toBe('burned-a');
    expect(REGISTERED_ERAS['burned-a'].sealed).toBe(false);
  });

  it('seals heldout-c as the v0.6 validation era', () => {
    expect(eraFor(at('2026-03-01T00:00:00Z'))).toBe('heldout-c');
    expect(eraFor(at('2026-05-25T23:00:00Z'))).toBe('heldout-c');
    expect(REGISTERED_ERAS['heldout-c'].sealed).toBe(true);
    expect(eraBounds('heldout-c').days).toBe(86);
    expect(() => assertNotSealed('heldout-c', 'grid sweep')).toThrow(/sealed/i);
  });

  it('keeps every burned window out of every sealed era', () => {
    for (const burned of ['burned', 'burned-a'] as const) {
      const b = REGISTERED_ERAS[burned];
      for (const tag of SEALED_ERAS) {
        const e = REGISTERED_ERAS[tag];
        expect(e.endSeconds < b.startSeconds || e.startSeconds > b.endSeconds).toBe(true);
      }
    }
  });

  it("says in heldout-c's role that it is less burned, not pristine", () => {
    expect(REGISTERED_ERAS['heldout-c'].role).toMatch(/less burned, not pristine/i);
  });

  it('pins heldout-c to exactly 86 days, the whole statistical power v0.6 validation has', () => {
    // heldout-c is the ONLY sealed era with enough span to say anything about
    // a yield claim (heldout-b is a 16-day stub -- too short and too
    // dominated by one venue's liquidity failure, see disclosure 3). There is
    // no larger held-out pool behind this one: everything earlier is either
    // calibration or burned-a design data. A boundary edit that narrows this
    // further does not trade some spare margin away -- it shrinks the only
    // era that can adjudicate v0.6 at all, so the exact day count is pinned
    // here rather than left to whatever the start/end boundaries happen to
    // produce.
    expect(eraBounds('heldout-c').start).toBe('2026-03-01T00:00:00.000Z');
    expect(eraBounds('heldout-c').end).toBe('2026-05-25T23:59:59.000Z');
    expect(eraBounds('heldout-c').days).toBe(86);
  });
});
