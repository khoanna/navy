/**
 * Ablation policy types and metadata
 *
 * H1-H5 are ablation studies based on B2 (capacity-aware baseline).
 * Each ablation removes or weakens one component to measure its contribution.
 */
import type { BaselinePolicy } from '../baselines/types.js';

/**
 * Ablation policy: same signature as BaselinePolicy, but carries
 * ablation metadata so the evaluation harness can record which component
 * was disabled.
 */
export interface AblationPolicy {
  policy: BaselinePolicy;
  id: string;
  description: string;
  /** Component(s) disabled by this ablation */
  disabledComponents: string[];
}

export interface AblationResult {
  ablationId: string;
  apy: number;
  totalCosts: bigint;
  totalTurnover: bigint;
  /** Which component was disabled */
  disabledComponent: string;
}

/** H1: Disable forecasting — always use rolling mean of historical rates */
export interface H1Policy extends AblationPolicy {
  id: 'h1';
  disabledComponents: ['forecast'];
}

/** H2: Disable capacity limits — ignore adapter caps */
export interface H2Policy extends AblationPolicy {
  id: 'h2';
  disabledComponents: ['capacity'];
}

/** H3: Disable cost gates — ignore movement cost threshold */
export interface H3Policy extends AblationPolicy {
  id: 'h3';
  disabledComponents: ['cost-gate'];
}

/** H4: Disable rebalancing — rebalance only at fixed intervals (weekly) */
export interface H4Policy extends AblationPolicy {
  id: 'h4';
  disabledComponents: ['rebalance-frequency'];
}

/** H5: Disable uncertainty — ignore prediction interval width */
export interface H5Policy extends AblationPolicy {
  id: 'h5';
  disabledComponents: ['uncertainty'];
}
