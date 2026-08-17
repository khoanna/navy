/**
 * Regime module exports
 *
 * Provides regime tracking, state classification, and cold start enforcement
 * per SRCLA design Section 6.2 and Section 7.3.
 */

// Types
export {
  RegimeState,
  type RegimeTransition,
  type ColdStartStatus,
  type RegimeThresholds,
  type RegimeConfig,
  type RegimeMetrics,
  type RegimeDetectorConfig,
} from './types.js';

// Classes
export { RegimeTracker, DEFAULT_REGIME_THRESHOLDS, DEFAULT_REGIME_DETECTOR_CONFIG } from './regime-tracker.js';
export { ColdStartEnforcer, DEFAULT_COLD_START_CONFIG, type ColdStartConfig, type ColdStartRecord } from './cold-start.js';
