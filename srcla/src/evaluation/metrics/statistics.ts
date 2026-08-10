/**
 * Statistical tests: Welch's t-test, bootstrap confidence intervals
 */

export interface TTestResult {
  tStatistic: number;
  pValue: number;
  significant: boolean;
  degreesOfFreedom: number;
}

/**
 * Welch's t-test for unequal variances
 */
export function welchTTest(
  sample1: number[],
  sample2: number[],
  alpha: number = 0.05,
): TTestResult {
  const n1 = sample1.length;
  const n2 = sample2.length;

  if (n1 === 0 || n2 === 0) {
    return { tStatistic: 0, pValue: 1, significant: false, degreesOfFreedom: 0 };
  }

  const mean1 = sample1.reduce((a, b) => a + b, 0) / n1;
  const mean2 = sample2.reduce((a, b) => a + b, 0) / n2;

  const var1 = variance(sample1);
  const var2 = variance(sample2);

  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) {
    return { tStatistic: mean1 === mean2 ? 0 : Infinity, pValue: mean1 === mean2 ? 1 : 0, significant: false, degreesOfFreedom: 0 };
  }

  const t = (mean1 - mean2) / se;

  // Welch-Satterthwaite degrees of freedom
  const dfNum = Math.pow(var1 / n1 + var2 / n2, 2);
  const dfDenom = Math.pow(var1 / n1, 2) / (n1 - 1) + Math.pow(var2 / n2, 2) / (n2 - 1);
  const df = dfDenom > 0 ? dfNum / dfDenom : 0;

  // Approximate p-value using normal distribution
  const pValue = 2 * (1 - normalCDF(Math.abs(t)));
  const significant = pValue < alpha;

  return { tStatistic: t, pValue, significant, degreesOfFreedom: df };
}

function mean(sample: number[]): number {
  return sample.reduce((a, b) => a + b, 0) / sample.length;
}

function variance(sample: number[]): number {
  const m = mean(sample);
  return sample.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / (sample.length - 1);
}

/**
 * Normal CDF approximation (Abramowitz and Stegun)
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Bootstrap confidence interval
 */
export interface BootstrapCI {
  lower: number;
  upper: number;
  mean: number;
  std: number;
}

export function bootstrapCI(
  data: number[],
  statistic: (sample: number[]) => number,
  alpha: number = 0.05,
  iterations: number = 10000,
): BootstrapCI {
  if (data.length === 0) {
    return { lower: 0, upper: 0, mean: 0, std: 0 };
  }

  const estimates: number[] = [];
  const n = data.length;

  for (let i = 0; i < iterations; i++) {
    const sample: number[] = [];
    for (let j = 0; j < n; j++) {
      sample.push(data[Math.floor(Math.random() * n)]!);
    }
    estimates.push(statistic(sample));
  }

  estimates.sort((a, b) => a - b);

  const mean_ = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  const std = Math.sqrt(estimates.reduce((sum, x) => sum + Math.pow(x - mean_, 2), 0) / estimates.length);

  const lowerIdx = Math.floor(iterations * alpha / 2);
  const upperIdx = Math.floor(iterations * (1 - alpha / 2));

  return {
    lower: estimates[lowerIdx] ?? 0,
    upper: estimates[upperIdx] ?? 0,
    mean: mean_,
    std,
  };
}
