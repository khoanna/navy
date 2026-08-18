/**
 * Evaluation report generation
 */
import { createHash } from 'crypto';
import type { ManifestConfig } from '../manifest/types.js';
import type { BaselineResult } from '../baselines/types.js';
import type { ForecastMetrics } from '../metrics/forecast.js';
import type { RiskMetrics } from '../metrics/risk.js';
import type { ReleaseGateResult } from './release-gate.js';

export interface EvaluationReport {
  meta: {
    evaluationId: string;
    generatedAt: string;
    manifestHash: string;
  };
  forecastCalibration: {
    method: string;
    config: Record<string, unknown>;
    metrics: ForecastMetrics;
  };
  baselines: BaselineResult[];
  risk: RiskMetrics;
  releaseGate: ReleaseGateResult;
}

export interface ReportParams {
  manifest: ManifestConfig;
  forecastMetrics: ForecastMetrics;
  baselineResults: BaselineResult[];
  riskMetrics: RiskMetrics;
  releaseGate: ReleaseGateResult;
}

/**
 * Generate evaluation report
 */
export function generateReport(params: ReportParams): EvaluationReport {
  return {
    meta: {
      evaluationId: params.manifest.evaluationId ?? 'unknown',
      generatedAt: new Date().toISOString(),
      manifestHash: hashManifest(params.manifest),
    },
    forecastCalibration: {
      // ManifestConfig does not include forecastMethod; use safe defaults
      method: 'rolling',
      config: {},
      metrics: params.forecastMetrics,
    },
    baselines: params.baselineResults,
    risk: params.riskMetrics,
    releaseGate: params.releaseGate,
  };
}

/**
 * Format report as markdown
 */
export function formatReportMarkdown(report: EvaluationReport): string {
  const lines: string[] = [
    `# SRCLA Evaluation Report`,
    ``,
    `**Evaluation ID:** ${report.meta.evaluationId}`,
    `**Generated:** ${report.meta.generatedAt}`,
    `**Manifest Hash:** \`${report.meta.manifestHash}\``,
    ``,
    `## Release Gate`,
    ``,
    `**${report.releaseGate.pass ? '✅ PASS' : '❌ FAIL'}** — ${report.releaseGate.overallReason}`,
    ``,
  ];

  for (const check of report.releaseGate.checks) {
    const status = check.pass ? '✅' : '❌';
    const value = typeof check.value === 'number' ? check.value.toFixed(4) : check.value;
    const threshold = typeof check.threshold === 'number' ? check.threshold.toFixed(4) : check.threshold;
    lines.push(`${status} ${check.name}: ${value} (threshold: ${threshold})`);
    if (check.reason) lines.push(`   → ${check.reason}`);
  }

  lines.push(``, `## Baselines`, ``);
  lines.push(`| ID | Name | Net APY | Deployable |`);
  lines.push(`|---|---|---|---|`);
  for (const b of report.baselines) {
    lines.push(`| ${b.id} | ${b.name} | ${(b.realizedNetApy * 100).toFixed(3)}% | ${b.deployable ? 'Yes' : 'No'} |`);
  }

  lines.push(``, `## Forecast Calibration`, ``);
  const fm = report.forecastCalibration.metrics;
  lines.push(`- **Coverage:** ${(fm.coverage * 100).toFixed(2)}%`);
  lines.push(`- **MAE:** ${fm.mae.toFixed(6)}`);
  lines.push(`- **RMSE:** ${fm.rmse.toFixed(6)}`);
  lines.push(`- **MASE:** ${fm.mase.toFixed(4)}`);
  lines.push(`- **Sharpness:** ${fm.sharpness.toFixed(6)}`);

  lines.push(``, `## Risk`, ``);
  const rm = report.risk;
  lines.push(`- **Max Drawdown:** ${(rm.maxDrawdown * 100).toFixed(3)}%`);
  lines.push(`- **Expected Shortfall:** ${(rm.expectedShortfall * 100).toFixed(4)}%`);
  lines.push(`- **Withdrawal Success Rate:** ${(rm.withdrawalSuccessRate * 100).toFixed(2)}%`);

  return lines.join(`\n`);
}

function hashManifest(manifest: ManifestConfig): string {
  return createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex');
}
