# SRCLA Evaluation Report

**Generated:** 2026-09-08T17:22:47.092Z · **Code:** `f01c8e099a351122a0b02855a503c793ae23e58c` · **Artifact:** `591f812fb99b60e98498f77fa84776ce3804dd7cde26fe7a9dacf85383e6635f`

> Regenerated from `src/evaluation/report/`. It supersedes every earlier version of this file, which was produced by an untracked `evaluation-v2/*.mjs` harness that is not the code this repository ships.

## Verdict

- **heldout-a** (267d, 6408 origins): §11.5 release gate **FAIL** — blocked on: Safety: stressed liquid coverage; No inert ablation; Statistically distinguishable from every deployable baseline; Outperforms every deployable baseline; §11.1 pinned-prestate fork replay
- **heldout-b** (26793d, 361 origins): §11.5 release gate **FAIL** — blocked on: Safety: stressed liquid coverage; No inert ablation; Statistically distinguishable from every deployable baseline; Outperforms every deployable baseline; §11.1 pinned-prestate fork replay

A `FAIL` here is a result, not an error. §11.5 requires publishing a negative result rather than retuning against held-out data.

## Read this before citing any number

### Registered eras

| Era | Start | End | Days | Sealed | Role |
|---|---|---|---|---|---|
| `calibration` | 2024-09-01 | 2025-08-31 | 365 | — | The ONLY data any artifact, quantile, grid point or no-trade band may be fit on. |
| `heldout-a` | 2025-09-01 | 2026-05-25 | 267 | **sealed** | PRIMARY held-out era, 267 days. |
| `burned` | 2026-05-26 | 2026-08-23 | 90 | — | Paper §4. |
| `heldout-b` | 2026-08-24 | 2099-12-31 | 26793 | **sealed** | SECONDARY held-out era, chronologically after everything including the burned window, and growing with the live collector. |

**Two deviations are disclosed, not buried:**

1. Paper §4.1 says the burned window "lies inside the calibration era". Here it lies in **neither** era. Putting it in calibration would place fitting data *after* held-out A in time, inverting walk-forward order and creating exactly the look-ahead §7.3 forbids. Excluding it satisfies §4.1's purpose — the window must never be held-out — strictly more than including it would. This is a paper-owner decision.
2. Held-out A **precedes** the burned window in time. The amendments P1–P8 and the code were designed with knowledge of May–Aug 2026. Nobody has looked at Sep 2025 – May 2026, so there is no direct contamination, but a designer who knew the later period could in principle have chosen mechanisms that suit the earlier one. Held-out B is chronologically clean and carries no such caveat. **Both are reported: A for statistical power, B for temporal purity. Neither alone is sufficient.**

### Withdrawals are a registered schedule, not observed

`withdrawalSource` = `registered-schedule`. The Navy vault has no Base mainnet history, so §8.1's `W_H` has no real series over this window and `Q_β(W_H)` is computed against a registered schedule. No claim in this report is evidence about real user redemption behaviour.

### Quantities the decision needs that the dataset does not carry

- per-venue absoluteCapBase / maxLossBps / dependencyGroupIds
- dependency group registry (id, capBps, absoluteCapBase, members)
- protocol supply-cap headroom (maxDeployableBase)
- vault adminReserveBase / minIdleBps

Each is supplied as a registered constant, never inferred from data. Gas and oracle observations are **no longer** on this list: they are measured per origin from the block header, the OP-Stack GasPriceOracle and the two Chainlink feeds (series digest `0x3a9a2d37a74058cefda1d77c0e38514378170a094ac623e375c5fee4a1310752`).

## The registered forecast artifact

Fit on the calibration era only (2024-09-01 → 2025-08-31, 365d). Selected by the registered grid: **rolling**, horizon **14d**, coverage target **0.9**.

Per-venue achieved coverage (amendment P1 — the quantile is solved per venue to the target):

| Venue | Achieved coverage |
|---|---|
| `aave-v3-usdc` | 90.00% |
| `compound-v3-usdc` | 90.00% |
| `moonwell-usdc` | 90.00% |

**P8's `k` did not resolve.** The sweep was inconclusive, so `k` remains at 1 as a registered default and every P8 result is provisional. A value chosen because it moves a gate would not be a registration.

## Results — era `heldout-a`

6408 origins. Manifest `e3ca8cf8ac1e3401d8285c589d8deba5e50907e3dcc2d3278733eb421b89074b`, dataset `e4784ed8ad64cf1389ef8a4427979238d83bde8737e1e528794e934fa7c0c48d`, result `a5ffede94fd2590f60a7a4c48467ad76dd636af9ffbe949d583403804d25cf9e`. Reproduce with `pnpm run evaluation:verify`.

#### Tier 10,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Ablation |
|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 4.180% | 301 | 61,652 | 0 | 100.0% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | — |
| `b1` | 11.2 | 4.376% | 3825 | 1,825,256 | 0 | 100.0% | — |
| `b2` | 11.2 | 4.271% | 2154 | 210,005 | 0 | 100.0% | — |
| `b2u` | 11.2 | 4.369% | 4984 | 163,838 | 0 | 100.0% | — |
| `b3` | 11.2 | 4.044% | 25 | 55,809 | 0 | 100.0% | — |
| `b4` | 11.2 | 3.695% | 6240 | 17,668 | 0 | 100.0% | — |
| `b5` | 11.2 | 4.101% | 6 | 28,014 | 0 | 100.0% | — |
| `h1` | 11.3 | 4.296% | 155 | 69,865 | 0 | 100.0% | — |
| `h2` | 11.3 | 4.180% | 301 | 61,652 | 0 | 100.0% | **INERT** |
| `h3` | 11.3 | 4.271% | 2154 | 210,005 | 0 | 100.0% | — |
| `h4` | 11.3 | 4.180% | 301 | 61,652 | 0 | 100.0% | — |
| `h5` | 11.3 | 4.180% | 301 | 61,652 | 0 | 100.0% | **INERT** |
| `h6` | 11.3 | 4.180% | 301 | 61,652 | 0 | 100.0% | **INERT** |
| `h7` | 11.3 | 4.180% | 301 | 61,652 | 0 | 100.0% | **INERT** |

#### Tier 100,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Ablation |
|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 4.182% | 297 | 594,634 | 0 | 100.0% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | — |
| `b1` | 11.2 | 4.381% | 3826 | 18,252,478 | 0 | 100.0% | — |
| `b2` | 11.2 | 4.272% | 2157 | 2,054,044 | 0 | 100.0% | — |
| `b2u` | 11.2 | 4.370% | 4984 | 1,595,278 | 0 | 100.0% | — |
| `b3` | 11.2 | 4.045% | 25 | 558,089 | 0 | 100.0% | — |
| `b4` | 11.2 | 3.695% | 6240 | 176,685 | 0 | 100.0% | — |
| `b5` | 11.2 | 4.095% | 10 | 363,317 | 0 | 100.0% | — |
| `h1` | 11.3 | 4.250% | 268 | 718,696 | 0 | 100.0% | — |
| `h2` | 11.3 | 4.182% | 297 | 594,634 | 0 | 100.0% | **INERT** |
| `h3` | 11.3 | 4.272% | 2157 | 2,054,044 | 0 | 100.0% | — |
| `h4` | 11.3 | 4.182% | 297 | 594,634 | 0 | 100.0% | — |
| `h5` | 11.3 | 4.182% | 297 | 594,634 | 0 | 100.0% | **INERT** |
| `h6` | 11.3 | 4.182% | 297 | 594,634 | 0 | 100.0% | **INERT** |
| `h7` | 11.3 | 4.182% | 297 | 594,634 | 0 | 100.0% | **INERT** |

#### Tier 1,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Ablation |
|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 4.202% | 289 | 6,099,854 | 0 | 100.0% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | — |
| `b1` | 11.2 | 4.382% | 3826 | 182,524,707 | 0 | 100.0% | — |
| `b2` | 11.2 | 4.273% | 2164 | 18,660,916 | 0 | 100.0% | — |
| `b2u` | 11.2 | 4.371% | 4984 | 15,244,740 | 0 | 100.0% | — |
| `b3` | 11.2 | 4.085% | 21 | 5,350,923 | 0 | 100.0% | — |
| `b4` | 11.2 | 3.695% | 6240 | 1,766,850 | 0 | 100.0% | — |
| `b5` | 11.2 | 4.103% | 11 | 3,729,852 | 0 | 100.0% | — |
| `h1` | 11.3 | 4.250% | 268 | 7,186,962 | 0 | 100.0% | — |
| `h2` | 11.3 | 4.202% | 289 | 6,099,854 | 0 | 100.0% | — |
| `h3` | 11.3 | 4.273% | 2162 | 18,580,925 | 0 | 100.0% | — |
| `h4` | 11.3 | 4.202% | 289 | 6,099,854 | 0 | 100.0% | — |
| `h5` | 11.3 | 4.202% | 289 | 6,099,854 | 0 | 100.0% | **INERT** |
| `h6` | 11.3 | 4.202% | 289 | 6,099,854 | 0 | 100.0% | **INERT** |
| `h7` | 11.3 | 4.202% | 289 | 6,099,854 | 0 | 100.0% | — |

#### Tier 10,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Ablation |
|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 4.029% | 182 | 45,030,087 | 0 | 100.0% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | — |
| `b1` | 11.2 | 4.382% | 3826 | 1,825,246,993 | 0 | 100.0% | — |
| `b2` | 11.2 | 3.975% | 2903 | 642,811,009 | 0 | 100.0% | — |
| `b2u` | 11.2 | 4.386% | 5566 | 390,411,748 | 0 | 100.0% | — |
| `b3` | 11.2 | 4.128% | 12 | 29,520,991 | 0 | 100.0% | — |
| `b4` | 11.2 | 3.695% | 6240 | 17,668,499 | 0 | 100.0% | — |
| `b5` | 11.2 | 4.201% | 6 | 18,076,407 | 0 | 100.0% | — |
| `h1` | 11.3 | 4.141% | 7 | 17,146,758 | 0 | 100.0% | — |
| `h2` | 11.3 | 4.030% | 182 | 44,630,028 | 0 | 100.0% | — |
| `h3` | 11.3 | 3.959% | 2620 | 414,170,153 | 0 | 100.0% | — |
| `h4` | 11.3 | 4.029% | 182 | 45,030,087 | 0 | 100.0% | — |
| `h5` | 11.3 | 4.029% | 182 | 45,030,087 | 0 | 100.0% | **INERT** |
| `h6` | 11.3 | 4.029% | 182 | 45,030,087 | 0 | 100.0% | **INERT** |
| `h7` | 11.3 | 4.012% | 69 | 35,660,708 | 0 | 100.0% | — |

### SRCLA against each deployable baseline

| Tier | Baseline | SRCLA | Baseline | paired HAC p | bootstrap 95% CI of difference |
|---|---|---|---|---|---|
| 10,000 | `b0` | 4.180% | 0.000% | 0.0000 | [4.51e-6, 4.83e-6] |
| 10,000 | `b1` | 4.180% | 4.376% | 0.0346 | [-4.88e-7, -1.80e-8] |
| 10,000 | `b2` | 4.180% | 4.271% | 0.3028 | [-3.54e-7, 8.49e-8] |
| 10,000 | `b3` | 4.180% | 4.044% | 0.0000 | [9.74e-8, 1.98e-7] |
| 10,000 | `b4` | 4.180% | 3.695% | 0.0000 | [4.14e-7, 6.70e-7] |
| 10,000 | `h1` | 4.180% | 4.296% | 0.0062 | [-2.44e-7, -3.55e-8] |
| 10,000 | `h2` | 4.180% | 4.180% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h3` | 4.180% | 4.271% | 0.3028 | [-3.54e-7, 8.49e-8] |
| 10,000 | `h4` | 4.180% | 4.180% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h5` | 4.180% | 4.180% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h6` | 4.180% | 4.180% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h7` | 4.180% | 4.180% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `b0` | 4.182% | 0.000% | 0.0000 | [4.52e-6, 4.83e-6] |
| 100,000 | `b1` | 4.182% | 4.381% | 0.0284 | [-4.86e-7, -2.93e-8] |
| 100,000 | `b2` | 4.182% | 4.272% | 0.3032 | [-3.49e-7, 8.51e-8] |
| 100,000 | `b3` | 4.182% | 4.045% | 0.0000 | [1.03e-7, 1.94e-7] |
| 100,000 | `b4` | 4.182% | 3.695% | 0.0000 | [4.23e-7, 6.64e-7] |
| 100,000 | `h1` | 4.182% | 4.250% | 0.1506 | [-2.08e-7, 3.55e-8] |
| 100,000 | `h2` | 4.182% | 4.182% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h3` | 4.182% | 4.272% | 0.3032 | [-3.49e-7, 8.51e-8] |
| 100,000 | `h4` | 4.182% | 4.182% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h5` | 4.182% | 4.182% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h6` | 4.182% | 4.182% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h7` | 4.182% | 4.182% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `b0` | 4.202% | 0.000% | 0.0000 | [4.53e-6, 4.86e-6] |
| 1,000,000 | `b1` | 4.202% | 4.382% | 0.0491 | [-4.68e-7, -5.63e-9] |
| 1,000,000 | `b2` | 4.202% | 4.273% | 0.4139 | [-3.29e-7, 1.07e-7] |
| 1,000,000 | `b3` | 4.202% | 4.085% | 0.0000 | [9.21e-8, 1.64e-7] |
| 1,000,000 | `b4` | 4.202% | 3.695% | 0.0000 | [4.38e-7, 6.92e-7] |
| 1,000,000 | `h1` | 4.202% | 4.250% | 0.3034 | [-1.86e-7, 5.53e-8] |
| 1,000,000 | `h2` | 4.202% | 4.202% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h3` | 4.202% | 4.273% | 0.4145 | [-3.29e-7, 1.07e-7] |
| 1,000,000 | `h4` | 4.202% | 4.202% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h5` | 4.202% | 4.202% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h6` | 4.202% | 4.202% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h7` | 4.202% | 4.202% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `b0` | 4.029% | 0.000% | 0.0000 | [4.31e-6, 4.72e-6] |
| 10,000,000 | `b1` | 4.029% | 4.382% | 0.0000 | [-4.96e-7, -2.83e-7] |
| 10,000,000 | `b2` | 4.029% | 3.975% | 0.1900 | [-5.23e-8, 1.56e-7] |
| 10,000,000 | `b3` | 4.029% | 4.128% | 0.0179 | [-2.27e-7, -7.73e-9] |
| 10,000,000 | `b4` | 4.029% | 3.695% | 0.0000 | [1.94e-7, 5.82e-7] |
| 10,000,000 | `h1` | 4.029% | 4.141% | 0.0007 | [-2.08e-7, -4.88e-8] |
| 10,000,000 | `h2` | 4.029% | 4.030% | 0.1325 | [-1.65e-9, 3.62e-11] |
| 10,000,000 | `h3` | 4.029% | 3.959% | 0.0006 | [2.50e-8, 1.27e-7] |
| 10,000,000 | `h4` | 4.029% | 4.029% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h5` | 4.029% | 4.029% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h6` | 4.029% | 4.029% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h7` | 4.029% | 4.012% | 0.5030 | [-4.74e-8, 7.93e-8] |

### §11.5 gate

| Verdict | Check | Detail |
|---|---|---|
| PASS | Every registered tier ran | all 4 of §11.1's tiers |
| PASS | Every registered policy ran at every tier | all 60 required (policy, tier) runs |
| PASS | Calibrated artifact | 591f812fb99b60e98498f77fa84776ce3804dd7cde26fe7a9dacf85383e6635f |
| PASS | Safety: withdrawal success measured and met | >= 99% across 60 runs |
| **FAIL** | Safety: stressed liquid coverage | b1@10000000000 0.905, b2@10000000000 0.906, b2u@10000000000 0.905, b5@10000000000 0.013, h1@10000000000 0.241, h3@10000000000 0.906, b1@100000000000 0.905, b2@100000000000 0.906, b2u@100000000000 0.905, b5@100000000000 0.000, h1@100000000000 0.243, h3@100000000000 0.906, srcla@1000000000000 0.836, b |
| **FAIL** | No inert ablation | these made byte-identical decisions to SRCLA: h2, h5, h6, h7 |
| **FAIL** | Statistically distinguishable from every deployable baseline | test not usable for h2@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h4@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h5@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h6@10000000000 (DEGENE |
| **FAIL** | Outperforms every deployable baseline | b1@10000000000: SRCLA 4.180% vs 4.376%, b2@10000000000: SRCLA 4.180% vs 4.271%, h1@10000000000: SRCLA 4.180% vs 4.296%, h2@10000000000: SRCLA 4.180% vs 4.180%, h3@10000000000: SRCLA 4.180% vs 4.271%, h4@10000000000: SRCLA 4.180% vs 4.180%, h5@10000000000: SRCLA 4.180% vs 4.180%, h6@10000000000: SRCL |
| **NOT PRODUCED** | §11.1 pinned-prestate fork replay | NOT PRODUCED: no fork replay was supplied. src/evaluation/fork-runner.ts is the scaffold for this and is wired to nothing. |

## Results — era `heldout-b`

361 origins. Manifest `77543ec1d885119802b4c949430cc0880d0640807c33f86fa4a3e176d699124d`, dataset `a2e5906b805ef53da46de5978c1be4c273f1fa6c09f01bd92ff67bb5241009ad`, result `72372c979e1ebed965e282579dd7604e5ad200764bdf4d7e8b940b830aa8261a`. Reproduce with `pnpm run evaluation:verify`.

#### Tier 10,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Ablation |
|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 11.891% | 6 | 19,345 | 0 | 100.0% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | — |
| `b1` | 11.2 | 39.160% | 291 | 56,984 | 0 | 100.0% | — |
| `b2` | 11.2 | 39.162% | 288 | 21,784 | 0 | 100.0% | — |
| `b2u` | 11.2 | 39.313% | 222 | 10,984 | 0 | 100.0% | — |
| `b3` | 11.2 | 11.891% | 6 | 19,345 | 0 | 100.0% | — |
| `b4` | 11.2 | 24.951% | 193 | 9,981 | 0 | 100.0% | — |
| `b5` | 11.2 | 38.945% | 2 | 9,784 | 0 | 100.0% | — |
| `h1` | 11.3 | 34.300% | 3 | 10,983 | 0 | 100.0% | — |
| `h2` | 11.3 | 11.891% | 6 | 19,345 | 0 | 100.0% | **INERT** |
| `h3` | 11.3 | 39.162% | 288 | 21,784 | 0 | 100.0% | — |
| `h4` | 11.3 | 11.891% | 6 | 19,345 | 0 | 100.0% | — |
| `h5` | 11.3 | 11.891% | 6 | 19,345 | 0 | 100.0% | **INERT** |
| `h6` | 11.3 | 11.891% | 6 | 19,345 | 0 | 100.0% | **INERT** |
| `h7` | 11.3 | 11.891% | 6 | 19,345 | 0 | 100.0% | **INERT** |

#### Tier 100,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Ablation |
|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 11.899% | 6 | 193,447 | 0 | 100.0% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | — |
| `b1` | 11.2 | 39.185% | 291 | 569,838 | 0 | 100.0% | — |
| `b2` | 11.2 | 39.181% | 290 | 217,838 | 0 | 100.0% | — |
| `b2u` | 11.2 | 39.315% | 222 | 109,839 | 0 | 100.0% | — |
| `b3` | 11.2 | 11.899% | 6 | 193,447 | 0 | 100.0% | — |
| `b4` | 11.2 | 24.953% | 193 | 99,809 | 0 | 100.0% | — |
| `b5` | 11.2 | 38.948% | 2 | 97,838 | 0 | 100.0% | — |
| `h1` | 11.3 | 34.304% | 3 | 109,829 | 0 | 100.0% | — |
| `h2` | 11.3 | 11.899% | 6 | 193,447 | 0 | 100.0% | **INERT** |
| `h3` | 11.3 | 39.181% | 290 | 217,838 | 0 | 100.0% | — |
| `h4` | 11.3 | 11.899% | 6 | 193,447 | 0 | 100.0% | — |
| `h5` | 11.3 | 11.899% | 6 | 193,447 | 0 | 100.0% | **INERT** |
| `h6` | 11.3 | 11.899% | 6 | 193,447 | 0 | 100.0% | **INERT** |
| `h7` | 11.3 | 11.899% | 6 | 193,447 | 0 | 100.0% | **INERT** |

#### Tier 1,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Ablation |
|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 8.856% | 6 | 2,169,009 | 0 | 100.0% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | — |
| `b1` | 11.2 | 39.187% | 291 | 5,698,384 | 0 | 100.0% | — |
| `b2` | 11.2 | 38.657% | 310 | 5,738,373 | 0 | 100.0% | — |
| `b2u` | 11.2 | 39.027% | 313 | 5,258,381 | 0 | 100.0% | — |
| `b3` | 11.2 | 11.837% | 6 | 2,174,466 | 0 | 100.0% | — |
| `b4` | 11.2 | 24.953% | 193 | 998,095 | 0 | 100.0% | — |
| `b5` | 11.2 | 38.951% | 4 | 1,218,378 | 0 | 100.0% | — |
| `h1` | 11.3 | 34.305% | 3 | 1,098,287 | 0 | 100.0% | — |
| `h2` | 11.3 | 8.856% | 6 | 2,169,009 | 0 | 100.0% | — |
| `h3` | 11.3 | 9.165% | 310 | 5,417,738 | 0 | 100.0% | — |
| `h4` | 11.3 | 8.856% | 6 | 2,169,009 | 0 | 100.0% | — |
| `h5` | 11.3 | 8.856% | 6 | 2,169,009 | 0 | 100.0% | **INERT** |
| `h6` | 11.3 | 8.856% | 6 | 2,169,009 | 0 | 100.0% | **INERT** |
| `h7` | 11.3 | 11.837% | 6 | 2,174,466 | 0 | 100.0% | — |

#### Tier 10,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Ablation |
|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 5.993% | 3 | 6,600,000 | 0 | 100.0% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | — |
| `b1` | 11.2 | 39.187% | 291 | 56,983,844 | 0 | 100.0% | — |
| `b2` | 11.2 | 14.619% | 20 | 19,400,000 | 0 | 100.0% | — |
| `b2u` | 11.2 | 18.924% | 21 | 35,200,000 | 0 | 100.0% | — |
| `b3` | 11.2 | 14.347% | 4 | 12,796,585 | 0 | 100.0% | — |
| `b4` | 11.2 | 24.953% | 193 | 9,980,948 | 0 | 100.0% | — |
| `b5` | 11.2 | 8.641% | 3 | 6,600,000 | 0 | 100.0% | — |
| `h1` | 11.3 | 7.308% | 2 | 6,400,000 | 0 | 100.0% | — |
| `h2` | 11.3 | 5.993% | 3 | 6,600,000 | 0 | 100.0% | — |
| `h3` | 11.3 | 3.477% | 14 | 9,800,000 | 0 | 100.0% | — |
| `h4` | 11.3 | 5.993% | 3 | 6,600,000 | 0 | 100.0% | — |
| `h5` | 11.3 | 5.993% | 3 | 6,600,000 | 0 | 100.0% | **INERT** |
| `h6` | 11.3 | 5.993% | 3 | 6,600,000 | 0 | 100.0% | **INERT** |
| `h7` | 11.3 | 12.947% | 2 | 7,600,000 | 0 | 100.0% | — |

### SRCLA against each deployable baseline

| Tier | Baseline | SRCLA | Baseline | paired HAC p | bootstrap 95% CI of difference |
|---|---|---|---|---|---|
| 10,000 | `b0` | 11.891% | 0.000% | 0.0000 | [1.11e-5, 1.49e-5] |
| 10,000 | `b1` | 11.891% | 39.160% | 0.0000 | [-2.99e-5, -2.01e-5] |
| 10,000 | `b2` | 11.891% | 39.162% | 0.0000 | [-2.99e-5, -2.01e-5] |
| 10,000 | `b3` | 11.891% | 11.891% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `b4` | 11.891% | 24.951% | 0.0000 | [-1.53e-5, -9.97e-6] |
| 10,000 | `h1` | 11.891% | 34.300% | 0.0000 | [-2.52e-5, -1.67e-5] |
| 10,000 | `h2` | 11.891% | 11.891% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h3` | 11.891% | 39.162% | 0.0000 | [-2.99e-5, -2.01e-5] |
| 10,000 | `h4` | 11.891% | 11.891% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h5` | 11.891% | 11.891% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h6` | 11.891% | 11.891% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h7` | 11.891% | 11.891% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `b0` | 11.899% | 0.000% | 0.0000 | [1.11e-5, 1.49e-5] |
| 100,000 | `b1` | 11.899% | 39.185% | 0.0000 | [-2.99e-5, -2.01e-5] |
| 100,000 | `b2` | 11.899% | 39.181% | 0.0000 | [-2.99e-5, -2.01e-5] |
| 100,000 | `b3` | 11.899% | 11.899% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `b4` | 11.899% | 24.953% | 0.0000 | [-1.53e-5, -9.96e-6] |
| 100,000 | `h1` | 11.899% | 34.304% | 0.0000 | [-2.51e-5, -1.67e-5] |
| 100,000 | `h2` | 11.899% | 11.899% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h3` | 11.899% | 39.181% | 0.0000 | [-2.99e-5, -2.01e-5] |
| 100,000 | `h4` | 11.899% | 11.899% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h5` | 11.899% | 11.899% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h6` | 11.899% | 11.899% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h7` | 11.899% | 11.899% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `b0` | 8.856% | 0.000% | 0.0000 | [8.48e-6, 1.12e-5] |
| 1,000,000 | `b1` | 8.856% | 39.187% | 0.0000 | [-3.37e-5, -2.27e-5] |
| 1,000,000 | `b2` | 8.856% | 38.657% | 0.0000 | [-3.32e-5, -2.23e-5] |
| 1,000,000 | `b3` | 8.856% | 11.837% | 0.0000 | [-3.69e-6, -2.51e-6] |
| 1,000,000 | `b4` | 8.856% | 24.953% | 0.0000 | [-1.91e-5, -1.26e-5] |
| 1,000,000 | `h1` | 8.856% | 34.305% | 0.0000 | [-2.89e-5, -1.93e-5] |
| 1,000,000 | `h2` | 8.856% | 8.856% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h3` | 8.856% | 9.165% | 0.4594 | [-1.11e-6, 7.17e-7] |
| 1,000,000 | `h4` | 8.856% | 8.856% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h5` | 8.856% | 8.856% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h6` | 8.856% | 8.856% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h7` | 8.856% | 11.837% | 0.0000 | [-3.69e-6, -2.51e-6] |
| 10,000,000 | `b0` | 5.993% | 0.000% | 0.0000 | [5.87e-6, 7.45e-6] |
| 10,000,000 | `b1` | 5.993% | 39.187% | 0.0000 | [-3.67e-5, -2.56e-5] |
| 10,000,000 | `b2` | 5.993% | 14.619% | 0.0000 | [-1.05e-5, -7.43e-6] |
| 10,000,000 | `b3` | 5.993% | 14.347% | 0.0000 | [-1.02e-5, -7.14e-6] |
| 10,000,000 | `b4` | 5.993% | 24.953% | 0.0000 | [-2.21e-5, -1.56e-5] |
| 10,000,000 | `h1` | 5.993% | 7.308% | 0.0000 | [-1.67e-6, -1.16e-6] |
| 10,000,000 | `h2` | 5.993% | 5.993% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h3` | 5.993% | 3.477% | 0.0000 | [2.22e-6, 3.29e-6] |
| 10,000,000 | `h4` | 5.993% | 5.993% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h5` | 5.993% | 5.993% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h6` | 5.993% | 5.993% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h7` | 5.993% | 12.947% | 0.0000 | [-8.56e-6, -6.00e-6] |

### §11.5 gate

| Verdict | Check | Detail |
|---|---|---|
| PASS | Every registered tier ran | all 4 of §11.1's tiers |
| PASS | Every registered policy ran at every tier | all 60 required (policy, tier) runs |
| PASS | Calibrated artifact | 591f812fb99b60e98498f77fa84776ce3804dd7cde26fe7a9dacf85383e6635f |
| PASS | Safety: withdrawal success measured and met | >= 99% across 60 runs |
| **FAIL** | Safety: stressed liquid coverage | b1@10000000000 0.878, b2@10000000000 0.878, b2u@10000000000 0.878, b5@10000000000 0.878, h3@10000000000 0.878, b1@100000000000 0.878, b2@100000000000 0.878, b2u@100000000000 0.878, b5@100000000000 0.878, h3@100000000000 0.878, b1@1000000000000 0.878, b2@1000000000000 0.878, b2u@1000000000000 0.878,  |
| **FAIL** | No inert ablation | these made byte-identical decisions to SRCLA: h2, h5, h6, h7 |
| **FAIL** | Statistically distinguishable from every deployable baseline | test not usable for b3@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h2@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h4@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h5@10000000000 (DEGENE |
| **FAIL** | Outperforms every deployable baseline | b1@10000000000: SRCLA 11.891% vs 39.160%, b2@10000000000: SRCLA 11.891% vs 39.162%, b3@10000000000: SRCLA 11.891% vs 11.891%, b4@10000000000: SRCLA 11.891% vs 24.951%, h1@10000000000: SRCLA 11.891% vs 34.300%, h2@10000000000: SRCLA 11.891% vs 11.891%, h3@10000000000: SRCLA 11.891% vs 39.162%, h4@100 |
| **NOT PRODUCED** | §11.1 pinned-prestate fork replay | NOT PRODUCED: no fork replay was supplied. src/evaluation/fork-runner.ts is the scaffold for this and is wired to nothing. |

## Limitations

- **§11.1's pinned-prestate fork replay is not produced.** `src/evaluation/fork-runner.ts` is the scaffold for it and is wired to nothing, so the gate reports NOT PRODUCED and blocks. No allocation in this report has been shown to be one the chain would have accepted.
- **Withdrawals are synthetic** (see above), so the withdrawal-success and stressed-coverage figures describe the registered schedule, not observed demand.
- **An INERT ablation removed nothing** on this dataset: its decision sequence is byte-identical to SRCLA's, so any delta reported for it is noise and attributing it to the removed component would be a misattribution. Inert rows are marked in the tables above.
- **Reward emissions** contribute whatever the measured probe found, which may be zero. A zero is reported as zero rather than omitted.

## Reproducing this report

```bash
cd srcla && docker compose up -d
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm prisma:push
DATABASE_URL='...' pnpm backfill:history            # ~18k hourly origins
DATABASE_URL='...' pnpm exec tsx scripts/freeze-artifact.ts
DATABASE_URL='...' pnpm evaluation:run --era heldout-a --artifact config/registered-artifact.json --out evaluation-heldout-a.json
DATABASE_URL='...' pnpm evaluation:run --era heldout-b --artifact config/registered-artifact.json --out evaluation-heldout-b.json
```

