/**
 * Release Gates Tests
 */

import {
  evaluateForecastGate,
  evaluatePolicyGate,
  EvaluationResults,
  PolicyComparison,
  GateCheck,
} from '../../../src/evaluation/release-gates.js';

describe('Release Gates', () => {
  describe('Forecast Gate', () => {
    it('should pass when all checks pass', () => {
      const evaluation: EvaluationResults = {
        calibrationCoverage: 0.96,
        labelCompleteness: 0.995,
        regimeContamination: false,
        totalObservations: 400,
      };

      const result = evaluateForecastGate(evaluation);
      expect(result.passed).toBe(true);
      expect(result.checks.every((c: GateCheck) => c.passed)).toBe(true);
      expect(result.blockedReason).toBeUndefined();
    });

    it('should fail when coverage below 95%', () => {
      const evaluation: EvaluationResults = {
        calibrationCoverage: 0.94,
        labelCompleteness: 0.99,
        regimeContamination: false,
        totalObservations: 400,
      };

      const result = evaluateForecastGate(evaluation);
      expect(result.passed).toBe(false);
      expect(result.blockedReason).toBe('Calibration Coverage');
    });

    it('should fail when completeness below 99%', () => {
      const evaluation: EvaluationResults = {
        calibrationCoverage: 0.96,
        labelCompleteness: 0.98,
        regimeContamination: false,
        totalObservations: 400,
      };

      const result = evaluateForecastGate(evaluation);
      expect(result.passed).toBe(false);
      expect(result.blockedReason).toBe('Label Completeness');
    });

    it('should fail on regime contamination', () => {
      const evaluation: EvaluationResults = {
        calibrationCoverage: 0.96,
        labelCompleteness: 0.99,
        regimeContamination: true,
        totalObservations: 400,
      };

      const result = evaluateForecastGate(evaluation);
      expect(result.passed).toBe(false);
      expect(result.blockedReason).toBe('No Regime Contamination');
    });

    it('should fail when observations below 365', () => {
      const evaluation: EvaluationResults = {
        calibrationCoverage: 0.96,
        labelCompleteness: 0.99,
        regimeContamination: false,
        totalObservations: 200,
      };

      const result = evaluateForecastGate(evaluation);
      expect(result.passed).toBe(false);
      expect(result.blockedReason).toBe('Minimum Observations');
    });

    it('should have 4 checks', () => {
      const evaluation: EvaluationResults = {
        calibrationCoverage: 0.96,
        labelCompleteness: 0.99,
        regimeContamination: false,
        totalObservations: 400,
      };

      const result = evaluateForecastGate(evaluation);
      expect(result.checks).toHaveLength(4);
    });

    it('should include metrics in checks', () => {
      const evaluation: EvaluationResults = {
        calibrationCoverage: 0.96,
        labelCompleteness: 0.99,
        regimeContamination: false,
        totalObservations: 400,
      };

      const result = evaluateForecastGate(evaluation);
      const coverageCheck = result.checks.find((c: GateCheck) => c.name === 'Calibration Coverage');
      expect(coverageCheck?.metrics).toBeDefined();
      expect(coverageCheck?.metrics?.coverage).toBe(0.96);
    });
  });

  describe('Policy Gate', () => {
    it('should pass when SRCLA outperforms B0 with good Sharpe', () => {
      const comparison: PolicyComparison = {
        safetyViolations: 0,
        pValue: 0.01,
        srclaAPY: 5.5,
        b0APY: 5.0,
        srclaSharpe: 0.8,
      };

      const result = evaluatePolicyGate(comparison);
      expect(result.passed).toBe(true);
      expect(result.blockedReason).toBeUndefined();
    });

    it('should fail when safety violations occur', () => {
      const comparison: PolicyComparison = {
        safetyViolations: 2,
        pValue: 0.01,
        srclaAPY: 5.5,
        b0APY: 5.0,
        srclaSharpe: 0.8,
      };

      const result = evaluatePolicyGate(comparison);
      expect(result.passed).toBe(false);
      expect(result.blockedReason).toBe('No Safety Violations');
    });

    it('should fail when the difference is not significant (p >= 0.05)', () => {
      // Paper 11.5 fails the policy gate ON statistical indistinguishability.
      // This test previously asserted the inverse - p = 0.03 was expected to
      // FAIL - which is how the inverted `pValue >= 0.05` survived review.
      const comparison: PolicyComparison = {
        safetyViolations: 0,
        pValue: 0.20,
        srclaAPY: 5.5,
        b0APY: 5.0,
        srclaSharpe: 0.8,
      };

      const result = evaluatePolicyGate(comparison);
      expect(result.passed).toBe(false);
      expect(result.blockedReason).toBe('Statistically Distinguishable from Baseline');
    });

    it('should fail when SRCLA does not outperform B0', () => {
      const comparison: PolicyComparison = {
        safetyViolations: 0,
        pValue: 0.01,
        srclaAPY: 4.5,
        b0APY: 5.0,
        srclaSharpe: 0.8,
      };

      const result = evaluatePolicyGate(comparison);
      expect(result.passed).toBe(false);
      expect(result.blockedReason).toBe('Outperforms B0');
    });

    it('should fail when Sharpe ratio below 0.5', () => {
      const comparison: PolicyComparison = {
        safetyViolations: 0,
        pValue: 0.01,
        srclaAPY: 5.5,
        b0APY: 5.0,
        srclaSharpe: 0.3,
      };

      const result = evaluatePolicyGate(comparison);
      expect(result.passed).toBe(false);
      expect(result.blockedReason).toBe('Acceptable Sharpe Ratio');
    });

    it('should have 4 checks', () => {
      const comparison: PolicyComparison = {
        safetyViolations: 0,
        pValue: 0.01,
        srclaAPY: 5.5,
        b0APY: 5.0,
        srclaSharpe: 0.8,
      };

      const result = evaluatePolicyGate(comparison);
      expect(result.checks).toHaveLength(4);
    });

    it('should include metrics in checks', () => {
      const comparison: PolicyComparison = {
        safetyViolations: 0,
        pValue: 0.01,
        srclaAPY: 5.5,
        b0APY: 5.0,
        srclaSharpe: 0.8,
      };

      const result = evaluatePolicyGate(comparison);
      const sharpeCheck = result.checks.find((c: GateCheck) => c.name === 'Acceptable Sharpe Ratio');
      expect(sharpeCheck?.metrics).toBeDefined();
      expect(sharpeCheck?.metrics?.sharpe).toBe(0.8);
    });

    it('should pass at exact threshold boundaries', () => {
      // Test exact 95% coverage
      const eval95: EvaluationResults = {
        calibrationCoverage: 0.95,
        labelCompleteness: 0.99,
        regimeContamination: false,
        totalObservations: 365,
      };
      expect(evaluateForecastGate(eval95).passed).toBe(true);

      // Test exact 99% completeness
      const eval99: EvaluationResults = {
        calibrationCoverage: 0.96,
        labelCompleteness: 0.99,
        regimeContamination: false,
        totalObservations: 400,
      };
      expect(evaluateForecastGate(eval99).passed).toBe(true);

      // Exact p = 0.05 is the EXCLUSIVE boundary: the gate requires p < 0.05,
      // so a result sitting exactly on alpha does not clear it.
      const comp05: PolicyComparison = {
        safetyViolations: 0,
        pValue: 0.05,
        srclaAPY: 5.5,
        b0APY: 5.0,
        srclaSharpe: 0.5,
      };
      expect(evaluatePolicyGate(comp05).passed).toBe(false);

      // One step inside alpha clears it, with every other input unchanged.
      expect(evaluatePolicyGate({ ...comp05, pValue: 0.049 }).passed).toBe(true);
    });
  });
});
