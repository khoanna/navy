/**
 * Evaluation Manifest - Reproducible Evaluation Registry
 *
 * Implements §11 of the SRCLA paper:
 * - Fixes dataset bounds, calibration/held-out boundaries
 * - Records policies, market identities, vault tiers
 * - Captures code commit and content hashes for reproducibility
 *
 * The manifest is the single source of truth for an evaluation run:
 * - Before run: defines scope, methods, and success criteria
 * - After run: documents what was actually executed
 *
 * @example
 * ```typescript
 * const manifest = createEvaluationManifest({
 *   id: 'eval-2026-08-01',
 *   markets: [compoundMarket, aaveMarket],
 *   dataset: { startDate, endDate },
 * });
 * const frozen = freezeEvaluationManifest(manifest);
 * ```
 */
import { createHash, randomUUID } from 'crypto';
import { BASELINES, ABLATIONS } from './constants.js';
import type { BaselineId, AblationId } from './constants.js';

// ============================================================================
// Market Configuration
// ============================================================================

/**
 * Market configuration for evaluation
 *
 * Captures protocol identity, adapter address, and regime classification.
 */
export interface MarketConfig {
  marketId: string;
  protocol: 'aave-v3' | 'compound-v3' | 'moonwell';
  adapterAddress: string;
  deploymentDate?: Date | null;
  regimeDigest: string;
}

/**
 * Default market configurations for Navy ecosystem
 */
export const DEFAULT_MARKETS: MarketConfig[] = [
  {
    marketId: 'compound',
    protocol: 'compound-v3',
    adapterAddress: '0x24d4173e6b9734a52c20190a9c5681ef350D8fE2',
    deploymentDate: new Date('2026-07-28'),
    regimeDigest: 'compound-v3-sepolia',
  },
  {
    marketId: 'aave-v3',
    protocol: 'aave-v3',
    adapterAddress: '0x0000000000000000000000000000000000000000',
    regimeDigest: 'aave-v3-sepolia',
  },
  {
    marketId: 'moonwell',
    protocol: 'moonwell',
    adapterAddress: '0x0000000000000000000000000000000000000000',
    regimeDigest: 'moonwell-base',
  },
];

// ============================================================================
// Forecast Method
// ============================================================================

/**
 * Forecast method for calibration
 */
export interface ForecastMethod {
  id: string;
  name: string;
  config: Record<string, unknown>;
  lossMetrics?: {
    loss: number;
    coverage: number;
    mae: number;
    pinballLoss: number;
    sharpness: number;
  };
}

/**
 * Standard forecast methods
 */
export const FORECAST_METHODS: ForecastMethod[] = [
  { id: 'rolling', name: 'Rolling Quantile', config: { windowDays: 7, quantile: 0.05 } },
  { id: 'ew-residual', name: 'EW-Residual', config: { decay: 0.95, residualQuantile: 0.05 } },
  { id: 'arx', name: 'Autoregressive X', config: { lags: 7 } },
];

// ============================================================================
// Calibration Configuration
// ============================================================================

/**
 * Calibration configuration per §7.2
 */
export interface CalibrationConfig {
  methods: ForecastMethod[];
  horizonsDays: number[];
  coverageTargets: number[];
  selectedMethod?: string;
  selectedConfig?: Record<string, unknown>;
  artifactHash?: string;
  calibrationEndDate: Date;
  heldOutStartDate: Date;
}

/**
 * Default calibration configuration
 */
export const DEFAULT_CALIBRATION: Omit<CalibrationConfig, 'selectedMethod' | 'selectedConfig' | 'artifactHash' | 'calibrationEndDate' | 'heldOutStartDate'> = {
  methods: FORECAST_METHODS,
  horizonsDays: [1, 7, 30],
  coverageTargets: [0.90, 0.95, 0.99],
};

// ============================================================================
// Policy Version
// ============================================================================

/**
 * Policy version record
 */
export interface PolicyVersion {
  id: string;
  name: string;
  description: string;
  baselineIds: BaselineId[];
  ablationIds: AblationId[];
  codeCommit: string;
  artifactHash: string;
}

/**
 * Default policy versions
 */
export const DEFAULT_POLICY_VERSIONS: PolicyVersion[] = [
  {
    id: 'srcla-v1',
    name: 'SRCLA v1.0',
    description: 'Full SRCLA with Rolling Quantile forecaster',
    baselineIds: [...BASELINES],
    ablationIds: [...ABLATIONS],
    codeCommit: process.env.GIT_COMMIT_HASH ?? 'unknown',
    artifactHash: '5ed517d128bab909',
  },
];

// ============================================================================
// Baseline Configuration
// ============================================================================

/**
 * Baseline configuration for evaluation
 */
export interface BaselineConfig {
  id: BaselineId;
  name: string;
  deployable: boolean;
  description: string;
}

/**
 * Default baseline configurations
 */
export const DEFAULT_BASELINES: BaselineConfig[] = [
  { id: 'b0', name: 'Idle', deployable: false, description: 'Hold USDC idle — no deployments' },
  { id: 'b1', name: 'Highest Rate', deployable: true, description: 'Always deploy to highest displayed rate' },
  { id: 'b2', name: 'Capacity-Aware', deployable: true, description: 'Deploy with capacity constraints, no uncertainty' },
  { id: 'b3', name: 'Capacity + Cost', deployable: true, description: 'B2 with movement cost threshold' },
  { id: 'b4', name: 'Fixed Robust', deployable: true, description: 'Frozen 40/40/20 allocation' },
  { id: 'b5', name: 'Hindsight', deployable: false, description: 'Perfect foresight — non-deployable diagnostic' },
];

// ============================================================================
// Ablation Configuration
// ============================================================================

/**
 * Ablation configuration for component analysis
 */
export interface AblationConfig {
  id: AblationId;
  name: string;
  disabledComponent: string;
  description: string;
}

/**
 * Default ablation configurations (H1-H5)
 */
export const DEFAULT_ABLATIONS: AblationConfig[] = [
  { id: 'h1', name: 'No Forecast', disabledComponent: 'forecast', description: 'Disable forecasting — always use rolling mean' },
  { id: 'h2', name: 'No Capacity', disabledComponent: 'capacity', description: 'Disable capacity limits — ignore adapter caps' },
  { id: 'h3', name: 'No Cost Gate', disabledComponent: 'cost-gate', description: 'Disable cost gates — ignore movement cost threshold' },
  { id: 'h4', name: 'Weekly Rebalance', disabledComponent: 'rebalance-frequency', description: 'Disable rebalancing — rebalance only weekly' },
  { id: 'h5', name: 'No Uncertainty', disabledComponent: 'uncertainty', description: 'Disable uncertainty — ignore prediction interval width' },
];

// ============================================================================
// Tier Configuration
// ============================================================================

/**
 * Tier configuration for vault size-based evaluation
 *
 * USDC amounts are in base units (6 decimals).
 */
export interface TierConfig {
  amounts: bigint[];
  labels: string[];
}

/**
 * Default tier configuration
 */
export const DEFAULT_TIERS: TierConfig = {
  amounts: [
    1_000_000_000n,      // $1,000
    10_000_000_000n,     // $10,000
    100_000_000_000n,    // $100,000
    1_000_000_000_000n,  // $1,000,000
  ],
  labels: ['micro', 'small', 'medium', 'large'],
};

// ============================================================================
// Cost Model
// ============================================================================

/**
 * Cost model parameters for evaluation
 */
export interface CostModelParams {
  /** Fixed gas cost per transaction (wei) */
  fixedGasCost: bigint;
  /** Gas price multiplier (basis points) */
  gasPriceMultiplierBps: bigint;
  /** L1 data fee per byte */
  l1FeePerByte: bigint;
  /** Slippage tolerance (basis points) */
  slippageToleranceBps: bigint;
  /** Minimum economically viable action (USDC base) */
  minActionAmount: bigint;
}

/**
 * Default cost model for Base Sepolia
 */
export const DEFAULT_COST_MODEL: CostModelParams = {
  fixedGasCost: 200_000n,
  gasPriceMultiplierBps: 10_000n, // 1x (no markup)
  l1FeePerByte: 0n,
  slippageToleranceBps: 30n,
  minActionAmount: 1_000_000n, // $1 minimum
};

// ============================================================================
// Success Criteria
// ============================================================================

/**
 * Success criteria for evaluation
 */
export interface SuccessCriteria {
  /** Minimum required forecast coverage (0-1) */
  minCoverage: number;
  /** Minimum required withdrawal success rate (0-1) */
  minWithdrawalSuccessRate: number;
  /** Maximum allowed max drawdown (0-1) */
  maxDrawdown: number;
  /** Minimum APY improvement over B1 (decimal) */
  minApyImprovementOverB1: number;
  /** Minimum APY improvement over B2 (decimal) */
  minApyImprovementOverB2: number;
  /** Maximum approximation regret (basis points) */
  maxApproximationRegretBps: bigint;
}

/**
 * Default success criteria
 */
export const DEFAULT_SUCCESS_CRITERIA: SuccessCriteria = {
  minCoverage: 0.95,
  minWithdrawalSuccessRate: 0.99,
  maxDrawdown: 0.05,
  minApyImprovementOverB1: 0.001, // 10 bps
  minApyImprovementOverB2: 0.0005, // 5 bps
  maxApproximationRegretBps: 100n, // 1%
};

// ============================================================================
// Evaluation Manifest
// ============================================================================

/**
 * Complete evaluation manifest per §11
 *
 * This is the main artifact that captures all configuration for a reproducible
 * evaluation run. The contentHash ensures the manifest hasn't been tampered with.
 */
export interface EvaluationManifest {
  /** Unique identifier for this evaluation */
  id: string;
  /** When the manifest was created */
  createdAt: Date;
  /** SHA-256 hash of manifest content (excluding this field) */
  contentHash: string;

  /** Dataset configuration */
  dataset: {
    startDate: Date;
    endDate: Date;
    snapshotCadenceMinutes: number;
    decisionCadenceMinutes: number;
  };

  /** Market configurations */
  markets: MarketConfig[];

  /** Calibration configuration */
  calibration: CalibrationConfig;

  /** Policy versions, baselines, and ablations */
  policies: {
    versions: PolicyVersion[];
    baselines: BaselineConfig[];
    ablations: AblationConfig[];
  };

  /** Vault tiers for size-based evaluation */
  tiers: TierConfig;

  /** Evaluation parameters */
  evaluation: {
    costModel: CostModelParams;
    successCriteria: SuccessCriteria;
  };

  /** Execution metadata */
  execution: {
    codeCommit: string;
    testDate: Date;
    runner: string;
  };
}

// ============================================================================
// Manifest Factory
// ============================================================================

/**
 * Configuration for creating an evaluation manifest
 */
export interface ManifestCreationConfig {
  id?: string;
  dataset: {
    startDate: Date;
    endDate: Date;
    snapshotCadenceMinutes?: number;
    decisionCadenceMinutes?: number;
  };
  markets?: MarketConfig[];
  calibration?: Partial<CalibrationConfig>;
  tiers?: Partial<TierConfig>;
  costModel?: Partial<CostModelParams>;
  successCriteria?: Partial<SuccessCriteria>;
  runner?: string;
}

/**
 * Create a new evaluation manifest
 *
 * @param config - Configuration for the manifest
 * @returns A complete, signed evaluation manifest
 *
 * @example
 * ```typescript
 * const manifest = createEvaluationManifest({
 *   dataset: {
 *     startDate: new Date('2026-06-01'),
 *     endDate: new Date('2026-08-01'),
 *   },
 *   markets: [compoundMarket],
 * });
 * console.log(manifest.contentHash);
 * ```
 */
export function createEvaluationManifest(config: ManifestCreationConfig): EvaluationManifest {
  const id = config.id ?? `eval-${randomUUID()}`;
  const createdAt = new Date();
  const codeCommit = process.env.GIT_COMMIT_HASH ?? 'unknown';

  const manifest: EvaluationManifest = {
    id,
    createdAt,
    contentHash: '', // Computed below

    dataset: {
      startDate: config.dataset.startDate,
      endDate: config.dataset.endDate,
      snapshotCadenceMinutes: config.dataset.snapshotCadenceMinutes ?? 15,
      decisionCadenceMinutes: config.dataset.decisionCadenceMinutes ?? 60,
    },

    markets: config.markets ?? DEFAULT_MARKETS,

    calibration: {
      ...DEFAULT_CALIBRATION,
      ...config.calibration,
      calibrationEndDate: config.calibration?.calibrationEndDate ?? new Date(
        config.dataset.startDate.getTime() + (config.dataset.endDate.getTime() - config.dataset.startDate.getTime()) * 0.7
      ),
      heldOutStartDate: config.calibration?.heldOutStartDate ?? new Date(
        config.dataset.startDate.getTime() + (config.dataset.endDate.getTime() - config.dataset.startDate.getTime()) * 0.7
      ),
    },

    policies: {
      versions: DEFAULT_POLICY_VERSIONS.map((v) => ({
        ...v,
        codeCommit,
      })),
      baselines: DEFAULT_BASELINES,
      ablations: DEFAULT_ABLATIONS,
    },

    tiers: {
      ...DEFAULT_TIERS,
      ...config.tiers,
    },

    evaluation: {
      costModel: {
        ...DEFAULT_COST_MODEL,
        ...config.costModel,
      },
      successCriteria: {
        ...DEFAULT_SUCCESS_CRITERIA,
        ...config.successCriteria,
      },
    },

    execution: {
      codeCommit,
      testDate: new Date(),
      runner: config.runner ?? 'srcla-evaluation',
    },
  };

  // Compute content hash
  manifest.contentHash = computeManifestHash(manifest);

  return manifest;
}

/**
 * Compute SHA-256 hash of manifest content
 *
 * Excludes the contentHash field itself to allow self-referential hashing.
 */
export function computeManifestHash(manifest: EvaluationManifest): string {
  const content = extractManifestContent(manifest);
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * Extract canonical manifest content for hashing
 */
function extractManifestContent(manifest: EvaluationManifest): Record<string, unknown> {
  return {
    id: manifest.id,
    createdAt: manifest.createdAt.toISOString(),
    dataset: {
      startDate: manifest.dataset.startDate.toISOString(),
      endDate: manifest.dataset.endDate.toISOString(),
      snapshotCadenceMinutes: manifest.dataset.snapshotCadenceMinutes,
      decisionCadenceMinutes: manifest.dataset.decisionCadenceMinutes,
    },
    markets: manifest.markets.map((m) => ({
      marketId: m.marketId,
      protocol: m.protocol,
      adapterAddress: m.adapterAddress,
      deploymentDate: m.deploymentDate?.toISOString(),
      regimeDigest: m.regimeDigest,
    })),
    calibration: {
      methods: manifest.calibration.methods.map((m) => ({
        id: m.id,
        name: m.name,
        config: m.config,
      })),
      horizonsDays: manifest.calibration.horizonsDays,
      coverageTargets: manifest.calibration.coverageTargets,
      selectedMethod: manifest.calibration.selectedMethod,
      selectedConfig: manifest.calibration.selectedConfig,
      artifactHash: manifest.calibration.artifactHash,
      calibrationEndDate: manifest.calibration.calibrationEndDate.toISOString(),
      heldOutStartDate: manifest.calibration.heldOutStartDate.toISOString(),
    },
    policies: {
      versions: manifest.policies.versions.map((v) => ({
        id: v.id,
        name: v.name,
        baselineIds: v.baselineIds,
        ablationIds: v.ablationIds,
        codeCommit: v.codeCommit,
        artifactHash: v.artifactHash,
      })),
      baselines: manifest.policies.baselines,
      ablations: manifest.policies.ablations,
    },
    tiers: {
      amounts: manifest.tiers.amounts.map((a) => a.toString()),
      labels: manifest.tiers.labels,
    },
    evaluation: {
      costModel: {
        fixedGasCost: manifest.evaluation.costModel.fixedGasCost.toString(),
        gasPriceMultiplierBps: manifest.evaluation.costModel.gasPriceMultiplierBps.toString(),
        l1FeePerByte: manifest.evaluation.costModel.l1FeePerByte.toString(),
        slippageToleranceBps: manifest.evaluation.costModel.slippageToleranceBps.toString(),
        minActionAmount: manifest.evaluation.costModel.minActionAmount.toString(),
      },
      successCriteria: manifest.evaluation.successCriteria,
    },
    execution: {
      codeCommit: manifest.execution.codeCommit,
      testDate: manifest.execution.testDate.toISOString(),
      runner: manifest.execution.runner,
    },
  };
}

// ============================================================================
// Manifest Serialization
// ============================================================================

/**
 * Freeze manifest to JSON for storage/transmission
 */
export function freezeEvaluationManifest(manifest: EvaluationManifest): string {
  const content = extractManifestContent(manifest);
  return JSON.stringify({
    ...content,
    contentHash: manifest.contentHash,
    createdAt: manifest.createdAt.toISOString(),
  }, null, 2);
}

/**
 * Thaw manifest from JSON
 */
export function thawEvaluationManifest(json: string): EvaluationManifest {
  const parsed = JSON.parse(json) as Record<string, unknown>;

  const manifest: EvaluationManifest = {
    id: parsed.id as string,
    createdAt: new Date(parsed.createdAt as string),
    contentHash: parsed.contentHash as string,

    dataset: {
      startDate: new Date((parsed.dataset as Record<string, unknown>).startDate as string),
      endDate: new Date((parsed.dataset as Record<string, unknown>).endDate as string),
      snapshotCadenceMinutes: (parsed.dataset as Record<string, unknown>).snapshotCadenceMinutes as number,
      decisionCadenceMinutes: (parsed.dataset as Record<string, unknown>).decisionCadenceMinutes as number,
    },

    markets: (parsed.markets as Array<Record<string, unknown>>).map((m) => ({
      marketId: m.marketId as string,
      protocol: m.protocol as 'aave-v3' | 'compound-v3' | 'moonwell',
      adapterAddress: m.adapterAddress as string,
      deploymentDate: m.deploymentDate ? new Date(m.deploymentDate as string) : null,
      regimeDigest: m.regimeDigest as string,
    })),

    calibration: {
      methods: ((parsed.calibration as Record<string, unknown>).methods as Array<Record<string, unknown>>).map((m) => ({
        id: m.id as string,
        name: m.name as string,
        config: m.config as Record<string, unknown>,
      })),
      horizonsDays: (parsed.calibration as Record<string, unknown>).horizonsDays as number[],
      coverageTargets: (parsed.calibration as Record<string, unknown>).coverageTargets as number[],
      selectedMethod: (parsed.calibration as Record<string, unknown>).selectedMethod as string,
      selectedConfig: (parsed.calibration as Record<string, unknown>).selectedConfig as Record<string, unknown>,
      artifactHash: (parsed.calibration as Record<string, unknown>).artifactHash as string,
      calibrationEndDate: new Date((parsed.calibration as Record<string, unknown>).calibrationEndDate as string),
      heldOutStartDate: new Date((parsed.calibration as Record<string, unknown>).heldOutStartDate as string),
    },

    policies: {
      versions: ((parsed.policies as Record<string, unknown>).versions as Array<Record<string, unknown>>).map((v) => ({
        id: v.id as string,
        name: v.name as string,
        description: v.description as string,
        baselineIds: v.baselineIds as BaselineId[],
        ablationIds: v.ablationIds as AblationId[],
        codeCommit: v.codeCommit as string,
        artifactHash: v.artifactHash as string,
      })),
      baselines: (parsed.policies as Record<string, unknown>).baselines as BaselineConfig[],
      ablations: (parsed.policies as Record<string, unknown>).ablations as AblationConfig[],
    },

    tiers: {
      amounts: ((parsed.tiers as Record<string, unknown>).amounts as string[]).map((a) => BigInt(a)),
      labels: (parsed.tiers as Record<string, unknown>).labels as string[],
    },

    evaluation: {
      costModel: {
        fixedGasCost: BigInt(((parsed.evaluation as Record<string, unknown>).costModel as Record<string, unknown>).fixedGasCost as string),
        gasPriceMultiplierBps: BigInt(((parsed.evaluation as Record<string, unknown>).costModel as Record<string, unknown>).gasPriceMultiplierBps as string),
        l1FeePerByte: BigInt(((parsed.evaluation as Record<string, unknown>).costModel as Record<string, unknown>).l1FeePerByte as string),
        slippageToleranceBps: BigInt(((parsed.evaluation as Record<string, unknown>).costModel as Record<string, unknown>).slippageToleranceBps as string),
        minActionAmount: BigInt(((parsed.evaluation as Record<string, unknown>).costModel as Record<string, unknown>).minActionAmount as string),
      },
      successCriteria: (parsed.evaluation as Record<string, unknown>).successCriteria as SuccessCriteria,
    },

    execution: {
      codeCommit: (parsed.execution as Record<string, unknown>).codeCommit as string,
      testDate: new Date((parsed.execution as Record<string, unknown>).testDate as string),
      runner: (parsed.execution as Record<string, unknown>).runner as string,
    },
  };

  // Verify hash
  const computedHash = computeManifestHash(manifest);
  if (computedHash !== manifest.contentHash) {
    throw new Error(`Manifest hash mismatch: expected ${manifest.contentHash}, got ${computedHash}`);
  }

  return manifest;
}

// ============================================================================
// Manifest Validation
// ============================================================================

/**
 * Validate manifest integrity and completeness
 */
export function validateManifest(manifest: EvaluationManifest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check required fields
  if (!manifest.id) errors.push('Missing manifest id');
  if (!manifest.createdAt) errors.push('Missing createdAt');
  if (!manifest.contentHash) errors.push('Missing contentHash');

  // Check dataset dates
  if (manifest.dataset.startDate >= manifest.dataset.endDate) {
    errors.push('Dataset startDate must be before endDate');
  }

  // Check calibration boundary
  if (manifest.calibration.calibrationEndDate > manifest.dataset.endDate) {
    errors.push('Calibration end date exceeds dataset end date');
  }
  if (manifest.calibration.heldOutStartDate <= manifest.dataset.startDate) {
    errors.push('Held-out start date must be after dataset start date');
  }
  if (manifest.calibration.heldOutStartDate !== manifest.calibration.calibrationEndDate) {
    errors.push('Held-out start date must equal calibration end date (boundary)');
  }

  // Check markets
  if (manifest.markets.length === 0) {
    errors.push('At least one market is required');
  }

  // Check success criteria
  const sc = manifest.evaluation.successCriteria;
  if (sc.minCoverage <= 0 || sc.minCoverage > 1) {
    errors.push('minCoverage must be between 0 and 1');
  }
  if (sc.maxDrawdown < 0 || sc.maxDrawdown > 1) {
    errors.push('maxDrawdown must be between 0 and 1');
  }

  // Verify hash
  const computedHash = computeManifestHash(manifest);
  if (computedHash !== manifest.contentHash) {
    errors.push(`Content hash mismatch: expected ${manifest.contentHash}, computed ${computedHash}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Manifest Query Helpers
// ============================================================================

/**
 * Get calibration dataset boundary
 */
export function getCalibrationBoundary(manifest: EvaluationManifest): {
  calibrationEnd: Date;
  heldOutStart: Date;
  evaluationEnd: Date;
} {
  return {
    calibrationEnd: manifest.calibration.calibrationEndDate,
    heldOutStart: manifest.calibration.heldOutStartDate,
    evaluationEnd: manifest.dataset.endDate,
  };
}

/**
 * Get evaluation date range
 */
export function getEvaluationRange(manifest: EvaluationManifest): {
  start: Date;
  end: Date;
  durationDays: number;
} {
  const durationMs = manifest.dataset.endDate.getTime() - manifest.dataset.startDate.getTime();
  const durationDays = durationMs / (24 * 60 * 60 * 1000);

  return {
    start: manifest.dataset.startDate,
    end: manifest.dataset.endDate,
    durationDays,
  };
}

/**
 * Find market by ID
 */
export function findMarket(manifest: EvaluationManifest, marketId: string): MarketConfig | undefined {
  return manifest.markets.find((m) => m.marketId === marketId);
}

/**
 * Find tier by label
 */
export function findTier(manifest: EvaluationManifest, label: string): bigint | undefined {
  const index = manifest.tiers.labels.indexOf(label);
  return index >= 0 ? manifest.tiers.amounts[index] : undefined;
}

/**
 * Get all deployable baselines
 */
export function getDeployableBaselines(manifest: EvaluationManifest): BaselineConfig[] {
  return manifest.policies.baselines.filter((b) => b.deployable);
}
