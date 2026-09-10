#!/usr/bin/env tsx
/**
 * Measure how well the shipped rate maps reproduce each venue's OWN stored
 * `supplyRateE18`, over the calibration era only.
 *
 * WHY THIS IS A SCRIPT AND NOT A NOTE IN A REPORT
 *
 * Every number the archive work has been judged on -- E1's Aave residue, E1b's
 * Compound/Moonwell figures, E2's archive-staleness fix -- is this measurement
 * at a different commit. Re-deriving it by hand each time is how two earlier
 * passes were lost: both recomputed utilization from `cash + borrows` instead
 * of reading the archive's own `utilizationE18`, which silently changes the
 * quantity being measured. This file fixes the methodology in code:
 *
 *   - the row's OWN stored `utilizationE18` (never recomputed),
 *   - the row's OWN stored IRM parameters (never a DEFAULT_*_CONFIG),
 *   - the shipped simulator map, not a re-implementation.
 *
 * It reads ONLY the calibration era. Sealed eras are refused outright.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:password@localhost:5433/srcla \
 *     pnpm tsx scripts/measure-rate-map-fidelity.ts [--json]
 *
 * UNITS: rates are WAD annualized; errors are reported in PERCENTAGE POINTS.
 */
import { PrismaClient } from '@prisma/client';
import { REGISTERED_ERAS } from '../src/evaluation/eras.js';
import { CompoundV3Simulator } from '../src/protocols/simulation/compound-simulator.js';
import { MoonwellSimulator } from '../src/protocols/simulation/moonwell-simulator.js';
import { AaveV3Simulator } from '../src/protocols/simulation/aave-simulator.js';
import { resolveReserveFactorBps } from '../src/evaluation/dataset.js';
import type {
  AaveSimulatorConfig,
  CompoundSimulatorConfig,
  MoonwellSimulatorConfig,
} from '../src/protocols/simulation/types.js';

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31_557_600n;

const ERA = 'calibration' as const;
if (REGISTERED_ERAS[ERA].sealed) throw new Error('refusing to measure a sealed era');

const compound = new CompoundV3Simulator();
const moonwell = new MoonwellSimulator();
const aave = new AaveV3Simulator();

/** WAD -> percentage points, as a float, for reporting only. */
const pp = (wad: bigint): number => Number(wad) / 1e18 * 100;

interface Row {
  marketId: string;
  timestamp: Date;
  supplyRateE18: string;
  utilizationE18: string;
  reserveFactorBps: number | null;
  irmAddress: string | null;
  irmBaseRateWad: string | null;
  irmKinkRay: string | null;
  irmSlopeLowWad: string | null;
  irmSlopeHighWad: string | null;
  irmOptimalUtilizationRay: string | null;
  irmMaxUtilizationRay: string | null;
  configDigest: string;
}

/** The mapped supply rate for one row, or null when the row carries no IRM. */
function mappedRate(r: Row): bigint | null {
  if (r.irmBaseRateWad === null || r.irmSlopeLowWad === null || r.irmSlopeHighWad === null) {
    return null;
  }
  const utilWad = BigInt(r.utilizationE18);
  const utilRay = utilWad * (RAY / WAD);
  const rfBps = resolveReserveFactorBps(r.marketId, r.reserveFactorBps);

  if (r.marketId.includes('aave')) {
    if (r.irmOptimalUtilizationRay === null || r.irmMaxUtilizationRay === null) return null;
    if (rfBps === undefined) return null;
    const cfg: AaveSimulatorConfig = {
      baseRate: BigInt(r.irmBaseRateWad),
      variableRateSlope1: BigInt(r.irmSlopeLowWad),
      variableRateSlope2: BigInt(r.irmSlopeHighWad),
      optimalUtilization: BigInt(r.irmOptimalUtilizationRay),
      maxUtilization: BigInt(r.irmMaxUtilizationRay),
      reserveFactorBps: rfBps,
    };
    return aave.calculateRateFromUtilization(utilRay, cfg);
  }

  if (r.irmKinkRay === null) return null;
  const kinked: CompoundSimulatorConfig = {
    baseRate: BigInt(r.irmBaseRateWad),
    kink: BigInt(r.irmKinkRay),
    slopeLow: BigInt(r.irmSlopeLowWad),
    slopeHigh: BigInt(r.irmSlopeHighWad),
  };
  if (r.marketId.includes('moonwell')) {
    if (rfBps === undefined) return null;
    const cfg: MoonwellSimulatorConfig = { ...kinked, reserveFactorBps: rfBps };
    return moonwell.calculateRateFromUtilization(utilRay, cfg);
  }
  // Compound's map is per-second; annualize to the stored scale.
  return compound.calculateRateFromUtilization(utilRay, kinked) * SECONDS_PER_YEAR;
}

interface VenueStat {
  marketId: string;
  n: number;
  unmapped: number;
  maePp: number;
  maxPp: number;
  meanStoredPp: number;
  /** Rows reproduced to better than 1e-7 pp. */
  exact: number;
  distinctDigests: number;
  distinctIrmAddresses: number;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const era = REGISTERED_ERAS[ERA];
    const rows = (await prisma.marketSnapshot.findMany({
      where: {
        eraTag: ERA,
        timestamp: {
          gte: new Date(era.startSeconds * 1000),
          lte: new Date(era.endSeconds * 1000),
        },
      },
      select: {
        marketId: true, timestamp: true, supplyRateE18: true, utilizationE18: true,
        reserveFactorBps: true, irmAddress: true, irmBaseRateWad: true, irmKinkRay: true,
        irmSlopeLowWad: true, irmSlopeHighWad: true, irmOptimalUtilizationRay: true,
        irmMaxUtilizationRay: true, configDigest: true,
      },
      orderBy: { timestamp: 'asc' },
    })) as Row[];

    const byVenue = new Map<string, Row[]>();
    for (const r of rows) {
      const list = byVenue.get(r.marketId);
      if (list === undefined) byVenue.set(r.marketId, [r]);
      else list.push(r);
    }

    const stats: VenueStat[] = [];
    for (const [marketId, venueRows] of [...byVenue.entries()].sort()) {
      let sumErr = 0;
      let maxErr = 0;
      let sumStored = 0;
      let n = 0;
      let unmapped = 0;
      let exact = 0;
      const digests = new Set<string>();
      const irms = new Set<string>();
      for (const r of venueRows) {
        digests.add(r.configDigest);
        if (r.irmAddress !== null) irms.add(r.irmAddress.toLowerCase());
        const mapped = mappedRate(r);
        if (mapped === null) { unmapped += 1; continue; }
        const stored = BigInt(r.supplyRateE18);
        const err = Math.abs(pp(mapped) - pp(stored));
        sumErr += err;
        if (err > maxErr) maxErr = err;
        sumStored += pp(stored);
        if (err < 1e-7) exact += 1;
        n += 1;
      }
      stats.push({
        marketId, n, unmapped,
        maePp: n === 0 ? NaN : sumErr / n,
        maxPp: maxErr,
        meanStoredPp: n === 0 ? NaN : sumStored / n,
        exact,
        distinctDigests: digests.size,
        distinctIrmAddresses: irms.size,
      });
    }

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }
    console.log(`era ${ERA}: ${rows.length} rows`);
    console.log(
      'venue'.padEnd(18) + 'n'.padStart(7) + 'MAE pp'.padStart(14) + 'max pp'.padStart(12) +
      'mean pp'.padStart(10) + 'exact'.padStart(8) + 'digests'.padStart(9) + 'irms'.padStart(6) +
      'unmapped'.padStart(10),
    );
    for (const s of stats) {
      console.log(
        s.marketId.padEnd(18) + String(s.n).padStart(7) +
        s.maePp.toExponential(4).padStart(14) + s.maxPp.toFixed(4).padStart(12) +
        s.meanStoredPp.toFixed(4).padStart(10) + String(s.exact).padStart(8) +
        String(s.distinctDigests).padStart(9) + String(s.distinctIrmAddresses).padStart(6) +
        String(s.unmapped).padStart(10),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[measure] FAILED:', err);
  process.exit(1);
});
