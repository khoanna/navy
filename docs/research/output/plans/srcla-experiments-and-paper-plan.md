# SRCLA Experiments and Paper Plan

## Frozen comparisons

B0 Hold; B1 highest current APR; B2 capacity-aware post-deposit; B3 cost threshold; B4 robust static; B5 hindsight diagnostic; SRCLA full controller. All use identical snapshots, eligible sets, safety policy, execution delay, costs, and rewards.

## Hypothesis mapping

- **H1:** paired out-of-sample net-yield difference SRCLA vs B0–B4 by tier.
- **H2:** turnover, rebalance count, and 24h reversal count vs B2–B4.
- **H3:** immediate/24h/7d withdrawal success under common stress scenarios.
- **H4:** marginal value of exact post-deposit modeling across four tiers.
- **H5:** forecast calibration and net value vs deterministic/rolling/DRO alternatives.
- **H6:** interaction test for algorithm × portfolio tier without tier-specific tuning.

Report paired effect sizes, block-bootstrap confidence intervals, and multiplicity-adjusted comparisons. B5 is an upper diagnostic, never a deployable performance claim.

## Walk-forward protocol

Chronological train, validation, and frozen test blocks. Model selection and constraint calibration end before the test start. Every run stores the manifest, decision logs, share ledger, user cash flows, and output hash.

## Stress scenarios

Borrow-demand spike; supplier run; one market zero liquidity; supply/withdraw pause; oracle/collateral shock; incentive collapse; gas spike; governance parameter change; forecast regime shift; coordinated ERC-4626 redemptions.

## Generated artifacts

- `results/prior-work-table.csv` from evidence matrix.
- `results/calibration.csv` and calibration plot.
- `results/net-yield-by-tier.csv`.
- `results/turnover-reversals.csv`.
- `results/withdrawal-stress.csv`.
- `results/dependency-exposure.csv`.
- `results/ablations.csv`.
- `results/fork-replay.csv`.
- Figures generated only from these tables and manifest hashes.

## Ablations

Remove post-deposit rates, forecast model, calibration, dynamic reserve, stress liquidity, dependency caps, no-trade region, reversal penalty, and passive deposit correction one at a time.

## Completion tests

- Every result row resolves to an experiment manifest.
- Every manifest resolves to dataset, registry, model, and policy hashes.
- Share-price growth reconciles to vault assets and user-profit ledger.
- No deployable run accesses future blocks or B5.
- Paper claims include effect size and uncertainty.
