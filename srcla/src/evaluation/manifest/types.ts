/**
 * Evaluation Manifest Types for Reproducibility
 *
 * Per SRCLA design §12: Evaluation Manifest System
 *
 * These types define the manifest structure that captures all configuration
 * for a reproducible evaluation run.
 */

/**
 * Evaluation manifest - captures all configuration for reproducible evaluation
 */
export interface EvaluationManifest {
  /** Unique identifier for this evaluation */
  id: string;
  /** Manifest version */
  version: string;
  /** When the manifest was created */
  createdAt: string;

  /** Dataset configuration */
  dataset: {
    startDate: string;
    endDate: string;
    snapshotCadenceMinutes: number;
    marketIds: string[];
  };

  /** Calibration windows with held-out periods */
  calibration: {
    windows: Array<{
      startDate: string;
      endDate: string;
      heldOutStart: string;
      heldOutEnd: string;
    }>;
  };

  /** Vault tiers evaluated */
  vaultTiers: string[];

  /**
   * Policies evaluated. Ids are free-form strings, not a closed union: the
   * registered set in `evaluation/kernel/registry.ts` includes B2u, H6 and
   * H7, and a manifest that structurally could not name them would silently
   * under-record what was run.
   */
  policies: {
    baselines: readonly string[];
    ablations: readonly string[];
    srcla: boolean;
  };

  /** Market configurations */
  markets: Record<string, {
    adapters: string[];
    coldStartDays: number;
    minObservations: number;
  }>;

  /** Cost parameters at time of evaluation */
  costs: {
    l2GasPrice: string;
    l1GasPrice: string;
    ethPrice: string;
    slippageBps: number;
    mevBps: number;
    /**
     * Present when the run priced §9.1 from MEASURED per-origin observations
     * rather than the three registered constants above (which are then the
     * series' value at the first origin, recorded for continuity).
     *
     * `digest` is load-bearing: the manifest's dataset hash covers snapshots
     * and withdrawals only, so without it a swapped gas series over the same
     * window would reproduce the same dataset hash while changing every
     * cost-gate decision.
     */
    measuredSeries?: {
      digest: string;
      observations: number;
      firstIso: string;
      lastIso: string;
      minL2BaseFeeWei: string;
      maxL2BaseFeeWei: string;
      minEthUsdE8: string;
      maxEthUsdE8: string;
    };
  };

  /** Content hashes for reproducibility */
  contentHashes: {
    manifest: string;
    dataset: string;
    codeCommit: string;
  };
}

/**
 * Configuration for manifest generation
 */
export interface ManifestConfig {
  evaluationId?: string;
  version: string;
  dataset: {
    startDate: Date;
    endDate: Date;
    snapshotCadenceMinutes: number;
    marketIds: string[];
  };
  calibrationWindows: Array<{
    startDate: Date;
    endDate: Date;
    heldOutStart: Date;
    heldOutEnd: Date;
  }>;
  vaultTiers: string[];
  markets: Record<string, {
    adapters: string[];
    coldStartDays: number;
    minObservations: number;
  }>;
  policies: {
    baselines: readonly string[];
    ablations: readonly string[];
    srcla: boolean;
  };
  costs: {
    l2GasPrice: string;
    l1GasPrice: string;
    ethPrice: string;
    slippageBps: number;
    mevBps: number;
    measuredSeries?: {
      digest: string;
      observations: number;
      firstIso: string;
      lastIso: string;
      minL2BaseFeeWei: string;
      maxL2BaseFeeWei: string;
      minEthUsdE8: string;
      maxEthUsdE8: string;
    };
  };
  codeCommit?: string;
}
