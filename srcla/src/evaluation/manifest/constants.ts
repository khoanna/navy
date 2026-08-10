/**
 * Baseline and ablation IDs
 */
export const BASELINES = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'] as const;
export const ABLATIONS = ['h1', 'h2', 'h3', 'h4', 'h5'] as const;

export type BaselineId = (typeof BASELINES)[number];
export type AblationId = (typeof ABLATIONS)[number];
