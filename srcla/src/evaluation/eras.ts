/**
 * The registered evaluation eras, and the guard that makes the held-out seal
 * mechanical rather than a convention.
 *
 * ---------------------------------------------------------------------------
 * WHAT PROBLEM THIS SOLVES
 *
 * CLAUDE.md recorded the blocker: "There is no held-out data. The only dataset
 * in the repo spans exactly the paper's declared burned window (2026-05-26 ->
 * 2026-08-23)." Every number the §11.5 gate could produce was therefore
 * computed on data the design had already read, which §2.2 rejects.
 *
 * The fix is not to wait for wall-clock time. Base mainnet archive state for
 * all three venues is available and verified back to at least 2024-09-03
 * (probed at block 19_300_000: Comet getUtilization = 591542423036707633,
 * Aave getReserveData returns strategy 0x46Da..134E, Moonwell getCash =
 * 12571903786612), and this repository has never read any of it. That makes
 * ~20 months of genuinely unseen history available today, of which 267 days
 * are reserved below as the primary held-out era.
 *
 * ---------------------------------------------------------------------------
 * TWO DISCLOSED DEVIATIONS. Both belong in the report, not in a footnote.
 *
 * 1. Paper §4.1's LETTER says the burned window "lies inside the calibration
 *    era". Here it lies in NEITHER era. Putting it in calibration would place
 *    fitting data AFTER held-out A in time, inverting walk-forward order and
 *    creating exactly the look-ahead §7.3 forbids. Excluding it satisfies
 *    §4.1's actual purpose -- the window must never be held-out -- strictly
 *    more than including it would. This is a paper-owner decision recorded
 *    here; if the owner rules otherwise, held-out A must be abandoned and only
 *    held-out B survives.
 *
 * 2. Held-out A PRECEDES the burned window in time. The amendments P1-P8 and
 *    the code were designed with knowledge of what happened in May-Aug 2026.
 *    Nobody has looked at Sep 2025 - May 2026, so there is no direct
 *    contamination -- but a designer who knew the later period could in
 *    principle have chosen mechanisms that happen to suit the earlier one.
 *    Held-out B is chronologically clean and carries no such caveat, which is
 *    why BOTH are reported: A for statistical power, B for temporal purity.
 *    Neither alone is sufficient evidence.
 *
 * ---------------------------------------------------------------------------
 * 3. `heldout-c` is LESS BURNED, NOT PRISTINE. Aggregate statistics spanning
 *    it -- net APY, worst stressed coverage, total cost and turnover over the
 *    whole of former held-out A -- were read while diagnosing v0.5. What is
 *    known is the era-wide direction, not this period's structure. It is used
 *    because the alternative, the 16-day `heldout-b`, is too short and too
 *    dominated by a single venue's liquidity failure to adjudicate a yield
 *    claim.
 *
 * ---------------------------------------------------------------------------
 * PURE: no I/O, no Date.now(), no randomness.
 * UNITS: all boundaries are Unix seconds, inclusive at both ends.
 */

export type EraTag = 'calibration' | 'burned-a' | 'heldout-c' | 'burned' | 'heldout-b';

export interface RegisteredEra {
  tag: EraTag;
  /** Inclusive. */
  startSeconds: number;
  /** Inclusive. */
  endSeconds: number;
  /**
   * True when nothing may fit, tune, select or inspect against this era
   * before the registered run. `assertNotSealed` enforces it.
   */
  sealed: boolean;
  role: string;
}

const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/**
 * A far-future end for the forward-growing era. Held-out B's EFFECTIVE end is
 * whenever collection last ran; it is written open here so that adding
 * tomorrow's origins does not require editing a registered boundary.
 */
const OPEN_ENDED = at('2099-12-31T23:59:59Z');

export const REGISTERED_ERAS: Readonly<Record<EraTag, RegisteredEra>> = Object.freeze({
  calibration: {
    tag: 'calibration',
    startSeconds: at('2024-03-15T00:00:00Z'),
    endSeconds: at('2025-05-31T23:59:59Z'),
    sealed: false,
    role:
      'The ONLY data any artifact, quantile, grid point or no-trade band may be fit on. ' +
      '443 days, extended back to the deployment floor for v0.6.',
  },
  'burned-a': {
    tag: 'burned-a',
    startSeconds: at('2025-06-01T00:00:00Z'),
    endSeconds: at('2026-02-28T23:59:59Z'),
    sealed: false,
    role:
      'Former PRIMARY held-out era (was heldout-a). Its aggregate statistics were read ' +
      'while diagnosing v0.5, which burned it under paper §2.2 -- it is design data now, ' +
      'not held-out. Excluded from fitting and from evaluation alike, same as `burned`.',
  },
  'heldout-c': {
    tag: 'heldout-c',
    startSeconds: at('2026-03-01T00:00:00Z'),
    endSeconds: at('2026-05-25T23:59:59Z'),
    sealed: true,
    role:
      'v0.6 VALIDATION era, 86 days. Sealed until the registered run. LESS BURNED, NOT ' +
      'PRISTINE -- see disclosure 3. Used because heldout-b alone is too short and too ' +
      'dominated by one venue\'s liquidity failure to adjudicate a yield claim.',
  },
  burned: {
    tag: 'burned',
    startSeconds: at('2026-05-26T00:00:00Z'),
    endSeconds: at('2026-08-23T23:59:59Z'),
    sealed: false,
    role:
      'Paper §4.1 DESIGN DATA. Read and reasoned about while deriving amendments P1-P8, ' +
      'so it is in neither the calibration nor a held-out era. Excluded from fitting and ' +
      'from evaluation alike. See disclosure 1.',
  },
  'heldout-b': {
    tag: 'heldout-b',
    startSeconds: at('2026-08-24T00:00:00Z'),
    endSeconds: OPEN_ENDED,
    sealed: true,
    role:
      'SECONDARY held-out era, chronologically after everything including the burned ' +
      'window, and growing with the live collector. Low power; reported for temporal ' +
      'purity, not for significance.',
  },
});

/** The eras in chronological order. */
export const ERAS_IN_ORDER: readonly RegisteredEra[] = Object.freeze(
  Object.values(REGISTERED_ERAS).sort((a, b) => a.startSeconds - b.startSeconds),
);

/** Every era whose data must not be touched before the registered run. */
export const SEALED_ERAS: readonly EraTag[] = Object.freeze(
  ERAS_IN_ORDER.filter((e) => e.sealed).map((e) => e.tag),
);

/**
 * The era an origin belongs to, or `null` when it predates the registered
 * window.
 *
 * `null` is not an error: the backfill may fetch a block outside the window
 * while resolving a boundary, and such a row is simply not part of any era.
 * It must never be silently folded into the nearest one.
 */
export function eraFor(timestampSeconds: number): EraTag | null {
  for (const era of ERAS_IN_ORDER) {
    if (timestampSeconds >= era.startSeconds && timestampSeconds <= era.endSeconds) {
      return era.tag;
    }
  }
  return null;
}

/**
 * Throw if `tag` names a sealed era.
 *
 * This is the whole point of the module. A rule that says "do not look at the
 * held-out data" is followed until someone writes a convenient query; a
 * function that throws is followed always. `purpose` is echoed in the message
 * so the stack trace names what tried to peek.
 */
export function assertNotSealed(tag: EraTag, purpose: string): void {
  const era = REGISTERED_ERAS[tag];
  if (era.sealed) {
    throw new Error(
      `Era '${tag}' is SEALED and cannot be used for "${purpose}". ${era.role} ` +
        `Fitting, tuning or inspecting sealed data before the registered run invalidates ` +
        `the entire result under paper §2.2, and there is no way to undo it. Use ` +
        `'calibration' instead.`,
    );
  }
}

/** ISO bounds, for a manifest or a report table. */
export function eraBounds(tag: EraTag): { start: string; end: string; days: number } {
  const era = REGISTERED_ERAS[tag];
  return {
    start: new Date(era.startSeconds * 1000).toISOString(),
    end: new Date(era.endSeconds * 1000).toISOString(),
    days: Math.round((era.endSeconds - era.startSeconds) / 86_400),
  };
}

/**
 * The full registered window, for the backfill's default bounds.
 *
 * Held-out B's open end is clamped by the caller to collection time; the
 * sentinel is not a claim that data exists that far ahead.
 */
export const REGISTERED_WINDOW = Object.freeze({
  startSeconds: REGISTERED_ERAS.calibration.startSeconds,
  endSecondsSentinel: OPEN_ENDED,
});
