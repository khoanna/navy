/**
 * Release Gates Tests
 */

import {
  evaluateForecastGate,
  evaluatePolicyGate,
  EvaluationResults,
  PolicyComparison,
} from './release-gates';

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
      expect(result.checks.every(c => c.passed)).toBe(true);
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
      const coverageCheck = result.checks.find(c => c.name === 'Calibration Coverage');
      expect(coverageCheck?.metrics).toBeDefined();
      expect(coverageCheck?.metrics?.coverage).toBe(0.96);
    });
  });

  describe('Policy Gate', () => {
    it('should pass when SRCLA outperforms B0 with good Sharpe', () => {
      const comparison: PolicyComparison = {
        safetyViolations: 0,
        pValue: 0.10,
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
        pValue: 0.10,
        srclaAPY: 5.5,
        b0APY: 5.0,
        srclaSharpe: 0.8,
      };

      const result = evaluatePolicyGate(comparison);
      expect(result.passed).toBe(false);
      expect(result.blockedReason).toBe('No Safety Violations');
    });

    it('should fail when p-value below 0.05', () => {
      const comparison: PolicyComparison = {
        safetyViolations: 0,
        pValue: 0.03,
        srclaAPY: 5.5,
        b0APY: 5.0,
        srclaSharpe: 0.8,
      };

      const result = evaluatePolicyGate(comparison);
      expect(result.passed).toBe(false);
      expect(result.blockedReason).toBe('Statistical Indistinguishability');
    });

    it('should fail when SRCLA does not outperform B0', () => {
      const comparison: PolicyComparison = {
        safetyViolations: 0,
        pValue: 0.10,
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
        pValue: 0.10,
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
        pValue: 0.10,
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
        pValue: 0.10,
        srclaAPY: 5.5,
        b0APY: 5.0,
        srclaSharpe: 0.8,
      };

      const result = evaluatePolicyGate(comparison);
      const sharpeCheck = result.checks.find(c => c.name === 'Acceptable Sharpe Ratio');
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

      // Test exact p-value 0.05
      const comp05: PolicyComparison = {
        safetyViolations: 0,
        pValue: 0.05,
        srclaAPY: 5.5,
        b0APY: 5.0,
        srclaSharpe: 0.5,
      };
      expect(evaluatePolicyGate(comp05).passed).toBe(true);
    });
  });
});
