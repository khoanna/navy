/**
 * SRCLA Evaluation Engine Module
 * Unified domain engine combining proposal reviews, paper §11 release gates,
 * reproducible manifest verification, cohort profit tracking, and benchmark runners.
 */
export * from '../evaluation/proposal-evaluator.js';
export * from '../evaluation/release-gates.js';
export * from '../evaluation/cohort-tracker.js';
export * from '../evaluation/coverage-tracker.js';
export { LateDepositorCalculator, type LateDepositorResult } from '../evaluation/late-depositor.js';
export * from '../evaluation/srcla-policy.js';
export * from '../evaluation/dataset.js';
export * from '../evaluation/fork-runner.js';
