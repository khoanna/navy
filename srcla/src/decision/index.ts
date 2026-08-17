/**
 * Decision module exports
 *
 * Provides decision engines for allocation and movement evaluation.
 */

// Types
export {
  type CostGateConfig,
  type CostBreakdown,
  type CostGateDecision,
  MovementType,
  type MovementCosts,
  type GainParameters,
  type CostGateContext,
  type CostGateStats,
  DEFAULT_COST_GATE_CONFIG,
} from './cost-gate-types.js';

// Classes
export { CostGate } from './cost-gate.js';

// Re-export action decision
export {
  type ActionDecisionConfig,
  type ActionDecision,
  ActionKind,
  ActionDecisionEngine,
} from './action-decision.js';
