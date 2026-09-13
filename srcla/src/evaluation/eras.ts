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
 * The fix is not to wait for wall-clock time. Base mainnet archive state is
 * available back to the DEPLOYMENT FLOOR, block 11_707_031 =
 * 2024-03-12T00:30:09Z, found by binary search as the earliest block at
 * which all seven required contracts have code (Comet USDC, Aave Pool,
 * mToken, Multicall3, GasPriceOracle, and both Chainlink feeds) -- Comet
 * USDC has no code before it. The dataset was collected from 2024-03-15 and
 * verified: full hourly coverage, 0 rows missing IRM parameters, 21_769
 * origins in total. Of that, 86 days are reserved below (`heldout-c`) as
 * the primary held-out era; see disclosure 3 for why that number is small
 * and why it is used anyway.
 *
 * ---------------------------------------------------------------------------
 * THREE DISCLOSED DEVIATIONS. All belong in the report, not in a footnote.
 *
 * 1. Paper §4.1's LETTER says the burned window "lies inside the calibration
 *    era". Here it lies in NEITHER era. Putting it in calibration would place
 *    fitting data AFTER `heldout-c` in time, inverting walk-forward order and
 *    creating exactly the look-ahead §7.3 forbids. Excluding it satisfies
 *    §4.1's actual purpose -- the window must never be held-out -- strictly
 *    more than including it would. This is a paper-owner decision recorded
 *    here; if the owner rules otherwise, `heldout-c` must be abandoned and
 *    only `heldout-b` survives.
 *
 * 2. `heldout-c` PRECEDES the burned window in time. The amendments P1-P8
 *    and the code were designed with knowledge of what happened in May-Aug
 *    2026, and `heldout-c` is Mar-May 2026 -- earlier. There is no direct
 *    contamination from that knowledge, but a designer who knew the later
 *    period could in principle have chosen mechanisms that happen to suit the
 *    earlier one. `heldout-b` was chronologically after everything, including
 *    the burned window, and carried no such caveat -- until Amendment P37
 *    (paper v0.11) read its per-venue and per-policy results to design G1, G3
 *    and G5, which makes it design data too (the fourth burned-window
 *    declaration). Since P37, only `heldout-d` carries none. All THREE sealed
 *    eras (`heldout-c`, `heldout-b`, `heldout-d`) are reported for the
 *    registered v0.10 verdict; only `heldout-d` decides release.
 *
 *    (In v0.5 this disclosure was about `heldout-a`, 2025-09-01 -> 2026-05-25.
 *    Reading that era's aggregates while diagnosing v0.5 burned it; it is now
 *    `burned-a`, is design data, and is reported by nothing. Disclosure 3 is
 *    the residue of that burn.)
 *
 * ---------------------------------------------------------------------------
 * 3. `heldout-c` is LESS BURNED, NOT PRISTINE. Aggregate statistics spanning
 *    it -- net APY, worst stressed coverage, total cost and turnover over the
 *    whole of former held-out A (now `burned-a`) -- were read while diagnosing
 *    v0.5. What is known is the era-wide direction, not this period's
 *    structure. It is used because the alternative, `heldout-b`, is too
 *    short (16 days) and too
 *    dominated by a single venue's liquidity failure to adjudicate a yield
 *    claim.
 *
 * ---------------------------------------------------------------------------
 * PURE: no I/O, no Date.now(), no randomness.
 * UNITS: all boundaries are Unix seconds, inclusive at both ends.
 */

export type EraTag = 'calibration' | 'burned-a' | 'heldout-c' | 'burned' | 'heldout-b' | 'heldout-d';

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
 * A far-future end for the forward-growing era. Held-out D's EFFECTIVE end is
 * whenever collection last ran; it is written open here so that adding
 * tomorrow's origins does not require editing a registered boundary.
 */
const OPEN_ENDED = at('2099-12-31T23:59:59Z');

/**
 * The sentinel itself, exported so that a consumer can recognise it rather
 * than re-deriving `2099-12-31` from memory. Nothing outside this module
 * should ever compare against a hardcoded far-future date.
 */
export const OPEN_ENDED_END_SECONDS = OPEN_ENDED;

/**
 * P37's freeze time `T` (paper v0.11): the first full hour after the commit
 * that lands P37's gate code with C6's outcome. Nothing after that commit may
 * change a gate, a threshold, the policy or the artifact before the release
 * verdict. `heldout-b` ends at the last hourly origin at or before `T` — `T`
 * itself, since `T` is on the hour — and `heldout-d` starts one second later.
 *
 * Fixed IN CODE, not read from git, so the boundaries reproduce from the tree
 * alone. This is the DEVELOPMENT value; Task 10 sets the real `T` and it MUST
 * stay >= 2026-09-23T00:00:00Z: `testableHorizons` measures a sealed era by
 * its registered span, and a `heldout-b` shorter than 30 days (from
 * 2026-08-24) would make the 1-day horizon untestable (see `eras.spec.ts`).
 */
export const P37_FREEZE_SECONDS = at('2026-09-23T00:00:00Z');

/**
 * Origins `heldout-d` must hold, with zero gaps, before the release verdict is
 * graded: the size of `heldout-c`, the one era with statistical power. Below it
 * the release verdict reads NOT YET POWERED and blocks.
 */
export const HELDOUT_D_MIN_ORIGINS = 2_064;

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
    endSeconds: P37_FREEZE_SECONDS,
    sealed: true,
    role:
      'SECONDARY held-out era, chronologically after everything including the burned ' +
      'window. Registered open-ended; P37 closed it at P37_FREEZE_SECONDS (disclosed), and ' +
      'it is DESIGN DATA for P37 (fourth burned-window declaration, paper v0.11). Low ' +
      'power; reported alongside `heldout-c` for the registered v0.10 verdict, not as ' +
      'release evidence -- only `heldout-d` decides release.',
  },
  'heldout-d': {
    tag: 'heldout-d',
    startSeconds: P37_FREEZE_SECONDS + 1,
    endSeconds: OPEN_ENDED,
    sealed: true,
    role:
      'P37 RELEASE era, open-ended from one second after P37_FREEZE_SECONDS and growing with ' +
      'collection. Nothing in P37 was designed, fit or tuned with any of it in view. The ' +
      `release verdict is graded on it only once it holds ${HELDOUT_D_MIN_ORIGINS} hourly ` +
      'origins with zero gaps.',
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

/**
 * True when the era's end is the forward-growing sentinel rather than a real
 * boundary.
 *
 * `eraBounds` deliberately still returns the sentinel arithmetic — it is used
 * by the backfill and the manifest, which want a concrete upper bound. A
 * PRESENTATION layer must not print it: "ends 2099-12-31, 26,793 days long"
 * is a sentinel leaking into a published document. Ask here instead.
 */
export function isOpenEnded(tag: EraTag): boolean {
  return REGISTERED_ERAS[tag].endSeconds === OPEN_ENDED;
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

/**
 * Horizons whose calibration can actually be TESTED on the sealed eras.
 *
 * §11.5's forecast gate tests independence (Christoffersen) on NON-OVERLAPPING
 * horizon windows, because overlapping residuals are serially dependent by
 * construction and running the test on them would reject clustering the
 * overlap put there. Thinning an era of length `T` to non-overlapping windows
 * of length `H` leaves `T/H` observations, so a long horizon on a short era
 * leaves too few to test at all.
 *
 * Measured on the registered eras: at H=14d, `heldout-c` (86d) thinned to 9
 * windows and `heldout-b` (17d) to 4, against a 30-observation minimum, so
 * BOTH eras reported Christoffersen NOT PRODUCED for every venue. Regime
 * purity degrades the same way for the same reason -- a 14x longer label
 * window straddles roughly 14x more governance changes, measured at 33.4%
 * against 5.2% at H=1d.
 *
 * THIS RULE RAISES THE BAR; it does not lower one. A candidate whose
 * calibration cannot be falsified on the data the study registered has not
 * earned a release, however well it scores on the selection loss. §7.3's loss
 * rewards a long horizon (better signal-to-noise, less turnover) and §11.5's
 * gate requires a short one; nothing in the paper reconciled them, and this is
 * that reconciliation, resolved in favour of testability.
 *
 * THE COST IS REAL AND MUST BE DISCLOSED: on the current eras this admits
 * ONE horizon, so P18's co-selection of the horizon with the movement rule is
 * vacuous for this release. That is a limitation of the DATASET -- the sealed
 * eras are too short to validate a longer horizon -- not a finding about the
 * forecast. A longer `heldout-b` re-admits the longer horizons on its own.
 */
export function testableHorizons(
  horizons: readonly number[],
  minWindows: number,
  eras: readonly EraTag[],
): number[] {
  const spans = eras.map((e) => {
    const b = eraBounds(e);
    return (Date.parse(b.end) - Date.parse(b.start)) / 1000;
  });
  if (spans.length === 0) return [...horizons];
  return horizons.filter((h) => spans.every((span) => Math.floor(span / h) >= minWindows));
}

/**
 * Missing hourly origins on the registered 3,600 s cadence, counted from the
 * first EXPECTED origin of the era through the last LOADED one, inclusive.
 *
 * `timestampsSeconds` sees only what was actually loaded, so a gap between
 * the era's start and the first loaded origin -- collection starting late, or
 * a query that silently dropped the opening rows -- would go uncounted if
 * this only looked at internal gaps between loaded rows. `eraStartSeconds`
 * fixes the first expected origin independently of what arrived, so a
 * late-starting era cannot read as gap-free. A gap AFTER the last loaded
 * origin (collection stopping early) is not counted here; it is covered by
 * comparing the origin count itself against `HELDOUT_D_MIN_ORIGINS`.
 *
 * ASSUMES every timestamp in `timestampsSeconds` is already on an hour
 * boundary (a multiple of 3,600) -- the registered collector guarantees this;
 * this function does not re-validate it. Duplicates are counted once. Returns
 * 0 for an empty array.
 */
export function hourlyOriginGaps(
  timestampsSeconds: readonly number[],
  eraStartSeconds: number,
): number {
  if (timestampsSeconds.length === 0) return 0;
  const sorted = [...new Set(timestampsSeconds)].sort((a, b) => a - b);
  const firstExpected = Math.ceil(eraStartSeconds / 3_600) * 3_600;
  const last = sorted[sorted.length - 1]!;
  if (last < firstExpected) return 0;
  const expectedCount = (last - firstExpected) / 3_600 + 1;
  const loadedFromFirstExpected = sorted.filter((t) => t >= firstExpected).length;
  return Math.max(0, expectedCount - loadedFromFirstExpected);
}

/** P37: whether an era run is powered for the release verdict. */
export function releasePowered(origins: number, gaps: number): boolean {
  return origins >= HELDOUT_D_MIN_ORIGINS && gaps === 0;
}
