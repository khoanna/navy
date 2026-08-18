/**
 * Baseline policies for evaluation (§11)
 *
 * Exports all baseline policies (B0-B5) and supporting types.
 */
export type { BaselinePolicy, BaselineResult, BaselineInfo } from './types.js';
export { BASELINE_INFO } from './types.js';

// Policy implementations
import { b0Policy } from './policies.js';
import { b1Policy } from './b1-highest-rate.js';
import { b2Policy } from './b2-capacity.js';
import { b3Policy } from './b3-capacity-cost.js';
import { b4Policy } from './b4-fixed-robust.js';
import { b5Policy } from './b5-hindsight.js';

export { b0Policy } from './policies.js';
export { b1Policy } from './b1-highest-rate.js';
export { b2Policy } from './b2-capacity.js';
export { b3Policy } from './b3-capacity-cost.js';
export { b4Policy } from './b4-fixed-robust.js';
export { b5Policy } from './b5-hindsight.js';

/**
 * All baseline policies in order
 */
export const ALL_BASELINES = [
  { id: 'b0', policy: b0Policy },
  { id: 'b1', policy: b1Policy },
  { id: 'b2', policy: b2Policy },
  { id: 'b3', policy: b3Policy },
  { id: 'b4', policy: b4Policy },
  { id: 'b5', policy: b5Policy },
] as const;
