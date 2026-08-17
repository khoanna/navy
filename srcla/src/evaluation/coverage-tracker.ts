/**
 * Coverage Tracking Module
 *
 * Implements §7.3 and §11 coverage tracking for forecast validation:
 * - Record forecast outcomes vs realized returns
 * - Calculate coverage rate per market
 * - Track shortfall statistics (avg, max)
 * - Verify 95% coverage target per market
 * - Export/import for persistence
 */

/**
 * Individual coverage record for a forecast outcome
 */
export interface CoverageRecord {
  marketId: string;
  timestamp: Date;
  lowerBound: bigint;    // Lower bound in WAD (E18)
  actualReturn: bigint; // Realized return in WAD (E18)
  covered: boolean;      // Whether actual >= lower bound
  horizon: number;       // Horizon in seconds
  shortfall: bigint | null; // How much actual missed lower bound (null if covered)
}

/**
 * Coverage metrics aggregated over a period
 */
export interface CoverageMetrics {
  coverage: number;           // Fraction of covered forecasts [0, 1]
  totalRecords: number;        // Total number of records
  coveredRecords: number;      // Number of covered forecasts
  averageShortfall: bigint;    // Average shortfall for uncovered (WAD)
  maxShortfall: bigint;        // Maximum shortfall observed (WAD)
  exceedsTarget: boolean;      // Whether coverage >= targetCoverage
}

/**
 * Complete coverage report with per-market breakdown
 */
export interface CoverageReport {
  generatedAt: Date;
  overallMetrics: CoverageMetrics;
  marketMetrics: Map<string, CoverageMetrics>;
  horizons: number[];
  targetCoverage: number;
  timeRange: { start: Date; end: Date } | null;
}

/**
 * Configuration for coverage tracking
 */
export interface CoverageConfig {
  targetCoverage: number;      // Target coverage rate (default: 0.95)
  maxShortfallWad: bigint;      // Maximum acceptable shortfall
  minSampleSize: number;       // Minimum records for valid coverage
}

/**
 * Default coverage configuration
 */
export const DEFAULT_COVERAGE_CONFIG: CoverageConfig = {
  targetCoverage: 0.95,
  maxShortfallWad: BigInt(1e18) * 100n, // 100 WAD = 10000% (generous)
  minSampleSize: 30,
};

/**
 * Coverage Tracker for forecast validation
 *
 * Tracks whether forecast lower bounds actually covered realized returns.
 * A forecast is "covered" if: actualReturn >= lowerBound
 *
 * Coverage Rate = (# covered forecasts) / (# total forecasts)
 */
export class CoverageTracker {
  private records: Map<string, CoverageRecord[]> = new Map();
  private config: CoverageConfig;

  constructor(config: Partial<CoverageConfig> = {}) {
    this.config = { ...DEFAULT_COVERAGE_CONFIG, ...config };
  }

  /**
   * Record a forecast outcome
   */
  recordOutcome(
    marketId: string,
    timestamp: Date,
    lowerBound: bigint,
    actualReturn: bigint,
    horizon: number,
  ): void {
    const covered = actualReturn >= lowerBound;
    const shortfall = covered ? null : lowerBound - actualReturn;

    const record: CoverageRecord = {
      marketId,
      timestamp,
      lowerBound,
      actualReturn,
      covered,
      horizon,
      shortfall,
    };

    if (!this.records.has(marketId)) {
      this.records.set(marketId, []);
    }
    this.records.get(marketId)!.push(record);
  }

  /**
   * Calculate coverage metrics for a market
   * @param marketId Market identifier
   * @param windowDays Optional window to filter recent records
   */
  calculateCoverage(marketId: string, windowDays?: number): CoverageMetrics {
    const allRecords = this.records.get(marketId) ?? [];

    // Filter by window if specified
    const records = windowDays
      ? this.filterByWindow(allRecords, windowDays)
      : allRecords;

    const totalRecords = records.length;

    if (totalRecords === 0) {
      return {
        coverage: 0,
        totalRecords: 0,
        coveredRecords: 0,
        averageShortfall: 0n,
        maxShortfall: 0n,
        exceedsTarget: false,
      };
    }

    const coveredRecords = records.filter((r) => r.covered).length;
    const coverage = coveredRecords / totalRecords;

    // Calculate shortfall statistics for uncovered forecasts
    const uncoveredRecords = records.filter((r) => !r.covered && r.shortfall !== null);
    const totalShortfall = uncoveredRecords.reduce(
      (sum, r) => sum + (r.shortfall ?? 0n),
      0n,
    );

    const averageShortfall =
      uncoveredRecords.length > 0
        ? totalShortfall / BigInt(uncoveredRecords.length)
        : 0n;

    const maxShortfall = uncoveredRecords.reduce(
      (max, r) => (r.shortfall !== null && r.shortfall > max ? r.shortfall : max),
      0n,
    );

    return {
      coverage,
      totalRecords,
      coveredRecords,
      averageShortfall,
      maxShortfall,
      exceedsTarget: coverage >= this.config.targetCoverage,
    };
  }

  /**
   * Calculate coverage across all markets
   */
  calculateOverallCoverage(windowDays?: number): CoverageMetrics {
    const allRecords: CoverageRecord[] = [];
    for (const records of this.records.values()) {
      if (windowDays) {
        allRecords.push(...this.filterByWindow(records, windowDays));
      } else {
        allRecords.push(...records);
      }
    }

    const totalRecords = allRecords.length;

    if (totalRecords === 0) {
      return {
        coverage: 0,
        totalRecords: 0,
        coveredRecords: 0,
        averageShortfall: 0n,
        maxShortfall: 0n,
        exceedsTarget: false,
      };
    }

    const coveredRecords = allRecords.filter((r) => r.covered).length;
    const coverage = coveredRecords / totalRecords;

    const uncoveredRecords = allRecords.filter((r) => !r.covered && r.shortfall !== null);
    const totalShortfall = uncoveredRecords.reduce(
      (sum, r) => sum + (r.shortfall ?? 0n),
      0n,
    );

    const averageShortfall =
      uncoveredRecords.length > 0
        ? totalShortfall / BigInt(uncoveredRecords.length)
        : 0n;

    const maxShortfall = uncoveredRecords.reduce(
      (max, r) => (r.shortfall !== null && r.shortfall > max ? r.shortfall : max),
      0n,
    );

    return {
      coverage,
      totalRecords,
      coveredRecords,
      averageShortfall,
      maxShortfall,
      exceedsTarget: coverage >= this.config.targetCoverage,
    };
  }

  /**
   * Generate comprehensive coverage report
   */
  generateCoverageReport(windowDays?: number): CoverageReport {
    const marketMetrics = new Map<string, CoverageMetrics>();
    const horizons = new Set<number>();

    for (const marketId of this.records.keys()) {
      const metrics = this.calculateCoverage(marketId, windowDays);
      marketMetrics.set(marketId, metrics);

      // Collect horizons
      const records = this.records.get(marketId) ?? [];
      for (const record of records) {
        horizons.add(record.horizon);
      }
    }

    const overallMetrics = this.calculateOverallCoverage(windowDays);

    // Calculate time range
    let timeRange: { start: Date; end: Date } | null = null;
    const allRecords: CoverageRecord[] = [];
    for (const records of this.records.values()) {
      allRecords.push(...records);
    }

    if (allRecords.length > 0) {
      const sorted = [...allRecords].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      );
      timeRange = {
        start: sorted[0]!.timestamp,
        end: sorted[sorted.length - 1]!.timestamp,
      };
    }

    return {
      generatedAt: new Date(),
      overallMetrics,
      marketMetrics,
      horizons: Array.from(horizons).sort((a, b) => a - b),
      targetCoverage: this.config.targetCoverage,
      timeRange,
    };
  }

  /**
   * Export all records for persistence
   */
  export(): Map<string, CoverageRecord[]> {
    const exported = new Map<string, CoverageRecord[]>();
    for (const [marketId, records] of this.records) {
      exported.set(marketId, [...records]);
    }
    return exported;
  }

  /**
   * Import records from persistence
   */
  import(records: Map<string, CoverageRecord[]>): void {
    for (const [marketId, marketRecords] of records) {
      const existing = this.records.get(marketId) ?? [];
      this.records.set(marketId, [...existing, ...marketRecords]);
    }
  }

  /**
   * Clear all records for a market or all markets
   */
  clear(marketId?: string): void {
    if (marketId) {
      this.records.delete(marketId);
    } else {
      this.records.clear();
    }
  }

  /**
   * Get record count for a market
   */
  getRecordCount(marketId?: string): number {
    if (marketId) {
      return this.records.get(marketId)?.length ?? 0;
    }
    let total = 0;
    for (const records of this.records.values()) {
      total += records.length;
    }
    return total;
  }

  /**
   * Get all market IDs with records
   */
  getMarketIds(): string[] {
    return Array.from(this.records.keys());
  }

  /**
   * Filter records by time window
   */
  private filterByWindow(records: CoverageRecord[], windowDays: number): CoverageRecord[] {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    return records.filter((r) => r.timestamp >= cutoff);
  }
}

/**
 * Create a coverage tracker from exported data
 */
export function fromExported(
  data: Map<string, CoverageRecord[]>,
  config?: Partial<CoverageConfig>,
): CoverageTracker {
  const tracker = new CoverageTracker(config);
  tracker.import(data);
  return tracker;
}
