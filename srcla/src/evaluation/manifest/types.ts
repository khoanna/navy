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

  /** Policies evaluated */
  policies: {
    baselines: readonly ('b0' | 'b1' | 'b2' | 'b3' | 'b4' | 'b5')[];
    ablations: readonly ('h1' | 'h2' | 'h3' | 'h4' | 'h5')[];
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
  };

  /** Content hashes for reproducibility */
  contentHashes: {
    manifest: string;
    dataset: string;
    codeCommit: string;
  };
}

/**
 * Content hash type (SHA-256 hex string)
 */
export type ContentHash = string;

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
    baselines: readonly ('b0' | 'b1' | 'b2' | 'b3' | 'b4' | 'b5')[];
    ablations: readonly ('h1' | 'h2' | 'h3' | 'h4' | 'h5')[];
    srcla: boolean;
  };
  costs: {
    l2GasPrice: string;
    l1GasPrice: string;
    ethPrice: string;
    slippageBps: number;
    mevBps: number;
  };
  codeCommit?: string;
}
