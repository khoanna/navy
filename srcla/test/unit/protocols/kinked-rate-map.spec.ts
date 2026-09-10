/**
 * Compound III and Moonwell rate-map golden vectors (E1b, 2026-09-10).
 *
 * WHY THIS FILE EXISTS. Two defects shipped together and neither was
 * detectable from the existing tests, because those tests checked each
 * formula against itself -- field presence, monotonicity, "a deposit lowers
 * the rate" -- rather than against the protocol:
 *
 *   1. NOTHING EVER POPULATED `MarketObservation.irmParams`. The seam existed
 *      and both drivers left it undefined, so every Compound and Moonwell
 *      curve came from `DEFAULT_COMPOUND_CONFIG` / `DEFAULT_MOONWELL_CONFIG`
 *      -- an 80% kink and a 6.25% slope against real values of 85-90% and
 *      ~3.6-6.7%, redeployed by governance repeatedly.
 *   2. `MoonwellSimulator` returned the BORROW rate as the supply rate and
 *      then clamped it into invented "Apollo oracle bounds". Moonwell is a
 *      Compound V2 fork: its stored coefficients are a borrow curve and
 *      supply = borrow * u * (1 - reserveFactor), with no bound of any kind.
 *
 * So the numbers below are READ FROM CHAIN, not derived from the code under
 * test. Each vector is one `MarketSnapshot` row of the registered archive --
 * the venue's own state, its own rate-model parameters and the supply rate it
 * itself reported, all at one pinned Base mainnet block. The assertions
 * require the simulator to reproduce the protocol's own number, and each
 * block ALSO shows the wrong forms missing it by orders of magnitude more
 * than the tolerance, so the test discriminates rather than agreeing with
 * itself.
 *
 * MEASURED, NOT ARGUED. Over the 10,632 calibration-era origins, each with
 * its own chain-read parameters and evaluated at the archive's own
 * `utilizationE18`:
 *
 *   compound  placeholder  7.5689 pp MAE / 14.7411 pp max  (mean rate 4.9411 pp)
 *   compound  chain-read   0        pp MAE / 0       pp max  -- EXACT
 *   moonwell  placeholder  7.2538 pp MAE / 55.8252 pp max  (mean rate 4.8575 pp)
 *   moonwell  chain-read   2.76e-9  pp MAE / 5.73e-9 pp max on the 7,370 rows
 *                          whose archive IRM address is correct
 *
 * TOLERANCE. Compound is expected to be EXACT: `collector/archive/calls.ts`
 * computes the stored rate from the per-second parameters and annualizes
 * afterwards, which is what `CompoundV3Simulator` does too, so every
 * truncation lands identically. Moonwell disagrees by a few tens of wei-per-
 * year because the annualize-then-convert order differs from the mToken's
 * convert-then-annualize; 1e9 wei (1e-9 WAD == 1e-7 pp) covers that and
 * excludes every formula error, which start at 1e15. The exact integers are
 * pinned as well, so a formula change is caught bit-for-bit.
 */
import { describe, it, expect } from '@jest/globals';
import { CompoundV3Simulator } from '../../../src/protocols/simulation/compound-simulator.js';
import { MoonwellSimulator } from '../../../src/protocols/simulation/moonwell-simulator.js';
import {
  DEFAULT_COMPOUND_CONFIG,
  DEFAULT_MOONWELL_CONFIG,
  type CompoundSimulatorConfig,
  type MoonwellSimulatorConfig,
} from '../../../src/protocols/simulation/types.js';
import { SECONDS_PER_YEAR } from '../../../src/protocols/math.js';

const compound = new CompoundV3Simulator();
const moonwell = new MoonwellSimulator();

const RAY_PER_WAD = 10n ** 9n;
/** 1e-9 WAD == 1e-7 pp. See TOLERANCE above. */
const TOLERANCE_WAD = 10n ** 9n;

const absDiff = (a: bigint, b: bigint): bigint => (a > b ? a - b : b - a);

describe('Compound III: Comet\'s SUPPLY curve, reproduced exactly', () => {
  /**
   * Base mainnet Comet USDC 0xb125E6687d4313864e53df431d5425969c15Eb2F.
   * Each vector is one archive origin: `supplyKink()` and the three
   * `supplyPerSecondInterestRate*` getters annualized (x 365.25 days), the
   * `getUtilization()` reading Comet feeds its own model, and the supply rate
   * that model produced.
   */
  const VECTORS: ReadonlyArray<{
    label: string;
    blockNumber: number;
    utilizationWad: bigint;
    storedSupplyRateWad: bigint;
    config: CompoundSimulatorConfig;
  }> = [
    {
      // ABOVE the kink (86.77% against an 85% kink) -- the steep branch.
      label: '2024-07-04T16:00Z, block 16,659,726',
      blockNumber: 16_659_726,
      utilizationWad: 867_723_772_394_906_465n,
      storedSupplyRateWad: 69_205_404_310_610_400n,
      config: {
        baseRate: 0n,
        kink: 850_000_000_000_000_000_000_000_000n,
        slopeLow: 48_032_876_705_364_000n,
        slopeHigh: 1_601_095_890_410_222_400n,
      },
    },
    {
      // BELOW the kink (62.03% against a 90% kink), and a DIFFERENT
      // parameter set -- Comet was re-parameterized between the two blocks,
      // which is exactly why a placeholder cannot stand in for either.
      label: '2025-04-01T12:00Z, block 28,359,726',
      blockNumber: 28_359_726,
      utilizationWad: 620_318_747_190_558_657n,
      storedSupplyRateWad: 33_520_155_625_476_000n,
      config: {
        baseRate: 0n,
        kink: 900_000_000_000_000_000_000_000_000n,
        slopeLow: 54_036_986_297_479_200n,
        slopeHigh: 3_036_078_082_168_372_800n,
      },
    },
  ];

  it.each(VECTORS.map((v) => [v.label, v] as const))(
    'reproduces the stored supply rate EXACTLY at %s',
    (_label, v) => {
      const utilRay = v.utilizationWad * RAY_PER_WAD;
      const annualWad = compound.calculateRateFromUtilization(utilRay, v.config) * SECONDS_PER_YEAR;
      // Not "within a tolerance": bit-for-bit. Comet's arithmetic and this
      // simulator's are the same arithmetic.
      expect(annualWad).toBe(v.storedSupplyRateWad);
    }
  );

  it.each(VECTORS.map((v) => [v.label, v] as const))(
    'DEFAULT_COMPOUND_CONFIG misses that stored rate by percentage points at %s',
    (_label, v) => {
      const utilRay = v.utilizationWad * RAY_PER_WAD;
      const placeholder =
        compound.calculateRateFromUtilization(utilRay, DEFAULT_COMPOUND_CONFIG) * SECONDS_PER_YEAR;
      // The discriminating half. If this ever passes within tolerance, the
      // placeholder has been quietly edited to match the chain and the test
      // above has stopped proving anything.
      expect(absDiff(placeholder, v.storedSupplyRateWad)).toBeGreaterThan(TOLERANCE_WAD);
      // At least 1 pp off, in fact -- 7.85 pp and 3.52 pp respectively.
      expect(absDiff(placeholder, v.storedSupplyRateWad)).toBeGreaterThan(10n ** 16n);
    }
  );

  it('pins the placeholder outputs, so a change to DEFAULT_COMPOUND_CONFIG is visible', () => {
    const at = (uWad: bigint): bigint =>
      compound.calculateRateFromUtilization(uWad * RAY_PER_WAD, DEFAULT_COMPOUND_CONFIG) *
      SECONDS_PER_YEAR;
    expect(at(867_723_772_394_906_465n)).toBe(147_723_772_335_912_000n); // 14.77% vs a real 6.92%
    expect(at(620_318_747_190_558_657n)).toBe(68_769_921_674_959_200n); //  6.88% vs a real 3.35%
  });
});

describe('Moonwell: a Compound V2 BORROW curve, converted to the supply rate', () => {
  /**
   * Base mainnet mUSDC 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22.
   * `kink()` / `baseRatePerTimestamp()` / `multiplierPerTimestamp()` /
   * `jumpMultiplierPerTimestamp()` off the mToken's own
   * `interestRateModel()` at that block, annualized, plus
   * `reserveFactorMantissa()` in bps; utilization is
   * borrows / (cash + borrows - reserves), which is what the mToken computes.
   *
   * BOTH VECTORS ARE FROM WINDOWS THE ARCHIVE RESOLVED THE IRM ADDRESS
   * CORRECTLY IN. `collector/archive/backfill.ts` re-reads that address only
   * once per `addressRefreshEvery` (500) origins, so the 500 origins before
   * any recorded address change may carry the PREVIOUS model's coefficients;
   * all 3,262 calibration rows this map fails to reproduce lie in such a
   * window, and none outside one. Vectors are chosen outside them so this
   * test measures the formula, not that defect.
   */
  const VECTORS: ReadonlyArray<{
    label: string;
    blockNumber: number;
    utilizationWad: bigint;
    storedSupplyRateWad: bigint;
    /** The annualized borrow rate the same parameters imply at that u. */
    borrowRateWad: bigint;
    config: MoonwellSimulatorConfig;
  }> = [
    {
      // ABOVE the kink (92.34% against 90%), IRM 0x54dC...2445, and a real
      // supply rate of 20.83 pp -- above the 20% ceiling the removed "Apollo
      // oracle bound" would have clipped it to.
      label: '2024-07-04T16:00Z, block 16,659,726',
      blockNumber: 16_659_726,
      utilizationWad: 923_373_231_345_656_583n,
      storedSupplyRateWad: 208_335_763_386_684_000n,
      borrowRateWad: 265_440_766_365_086_400n,
      config: {
        baseRate: 0n,
        kink: 900_000_000_000_000_000_000_000_000n,
        slopeLow: 61_041_780_821_613_600n,
        slopeHigh: 9_006_164_383_533_832_800n,
        reserveFactorBps: 1500,
      },
    },
    {
      // BELOW the kink (80.80% against 90%), a DIFFERENT model deployment
      // (IRM 0x0f36...95B7) with a different multiplier.
      label: '2024-05-15T12:00Z, block 14,492,526',
      blockNumber: 14_492_526,
      utilizationWad: 808_046_561_132_280_370n,
      storedSupplyRateWad: 37_210_359_044_700_000n,
      borrowRateWad: 54_176_201_135_114_400n,
      config: {
        baseRate: 0n,
        kink: 900_000_000_000_000_000_000_000_000n,
        slopeLow: 67_045_890_382_171_200n,
        slopeHigh: 9_006_164_383_533_832_800n,
        reserveFactorBps: 1500,
      },
    },
  ];

  it.each(VECTORS.map((v) => [v.label, v] as const))(
    'reproduces the mToken\'s own stored supply rate at %s',
    (_label, v) => {
      const utilRay = v.utilizationWad * RAY_PER_WAD;
      const annualWad = moonwell.calculateRateFromUtilization(utilRay, v.config);
      expect(absDiff(annualWad, v.storedSupplyRateWad)).toBeLessThanOrEqual(TOLERANCE_WAD);
    }
  );

  it.each(VECTORS.map((v) => [v.label, v] as const))(
    'the raw BORROW rate -- what shipped -- misses it by percentage points at %s',
    (_label, v) => {
      const utilRay = v.utilizationWad * RAY_PER_WAD;
      const borrowAnnual =
        moonwell.calculateBorrowRateFromUtilization(utilRay, v.config) * SECONDS_PER_YEAR;
      // First: the borrow rate itself is pinned, so the kinked half of the
      // model is checked independently of the conversion.
      expect(borrowAnnual).toBe(v.borrowRateWad);
      // Then: returning it as the supply rate -- the pre-fix behaviour -- is
      // off by 5.7 pp and 1.7 pp on these two vectors.
      expect(absDiff(borrowAnnual, v.storedSupplyRateWad)).toBeGreaterThan(10n ** 16n);
    }
  );

  it('DEFAULT_MOONWELL_CONFIG misses the stored rate, and the removed clamp would have too', () => {
    const v = VECTORS[0]!;
    const utilRay = v.utilizationWad * RAY_PER_WAD;
    const placeholder = moonwell.calculateRateFromUtilization(utilRay, DEFAULT_MOONWELL_CONFIG);
    expect(absDiff(placeholder, v.storedSupplyRateWad)).toBeGreaterThan(10n ** 16n);
    // The clamp this fix removed asserted a 20% ceiling. This venue really
    // paid 20.83% at this block, so the ceiling was not a harmless guard: it
    // would have understated the truth by 0.83 pp on its own, on top of
    // everything else.
    expect(v.storedSupplyRateWad).toBeGreaterThan((20n * 10n ** 18n) / 100n);
    // And the simulator does NOT clamp: it reports the real 20.83%.
    const real = moonwell.calculateRateFromUtilization(utilRay, v.config);
    expect(real).toBeGreaterThan((20n * 10n ** 18n) / 100n);
  });

  it('the reserve factor is a real term, not decoration', () => {
    const v = VECTORS[0]!;
    const utilRay = v.utilizationWad * RAY_PER_WAD;
    const at15 = moonwell.calculateRateFromUtilization(utilRay, v.config);
    const at10 = moonwell.calculateRateFromUtilization(utilRay, { ...v.config, reserveFactorBps: 1000 });
    const at0 = moonwell.calculateRateFromUtilization(utilRay, { ...v.config, reserveFactorBps: 0 });
    // 15% -> 10% is a 5.9% relative uplift; 15% -> 0% is 17.6%. A reserve
    // factor silently read as 0 -- the failure an optional field invites --
    // overstates this venue's supply rate by 3.7 pp.
    expect(at10).toBeGreaterThan(at15);
    expect(at0).toBeGreaterThan(at10);
    expect(at0 - at15).toBeGreaterThan(3n * 10n ** 16n);
  });
});
