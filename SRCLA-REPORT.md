# SRCLA Evaluation Report

**Generated:** 2026-09-09T08:14:25.586Z · **Code:** `cd5a04f79563ef76a17e19d68df09ae85b08b927` · **Artifact:** `5089c131b80a00671f8c83ece763ea7c8f74821a03694e2f92fbb365e3cb5013`

> Regenerated from `src/evaluation/report/`. It supersedes every earlier version of this file, which was produced by an untracked `evaluation-v2/*.mjs` harness that is not the code this repository ships.

## Verdict

- **heldout-c** (86d, 2064 origins): §11.5 release gate **FAIL** — blocked on: Safety: stressed liquid coverage; No inert ablation; Statistically distinguishable from every deployable baseline; Outperforms every deployable baseline; §11.1 pinned-prestate fork replay
- **heldout-b** (open-ended, 361 origins): §11.5 release gate **FAIL** — blocked on: Safety: stressed liquid coverage; No inert ablation; Statistically distinguishable from every deployable baseline; Outperforms every deployable baseline; §11.1 pinned-prestate fork replay

A `FAIL` here is a result, not an error. §11.5 requires publishing a negative result rather than retuning against held-out data.

## Read this before citing any number

### Registered eras

| Era | Start | End | Days | Sealed |
|---|---|---|---|---|
| `calibration` | 2024-03-15 | 2025-05-31 | 443 | — |
| `burned-a` | 2025-06-01 | 2026-02-28 | 273 | — |
| `heldout-c` | 2026-03-01 | 2026-05-25 | 86 | **sealed** |
| `burned` | 2026-05-26 | 2026-08-23 | 90 | — |
| `heldout-b` | 2026-08-24 | open | open | **sealed** |

An era with an End of `open` grows with the live collector; its effective end is whenever collection last ran, reported per era in the measured-coverage table below.

Each era's registered role, in full — none of this is abbreviated, because the caveats are the point:

- `calibration` — The ONLY data any artifact, quantile, grid point or no-trade band may be fit on. 443 days, extended back to the deployment floor for v0.6.
- `burned-a` — Former PRIMARY held-out era (was heldout-a). Its aggregate statistics were read while diagnosing v0.5, which burned it under paper §2.2 -- it is design data now, not held-out. Excluded from fitting and from evaluation alike, same as `burned`.
- `heldout-c` — v0.6 VALIDATION era, 86 days. Sealed until the registered run. LESS BURNED, NOT PRISTINE -- see disclosure 3. Used because heldout-b alone is too short and too dominated by one venue's liquidity failure to adjudicate a yield claim.
- `burned` — Paper §4.1 DESIGN DATA. Read and reasoned about while deriving amendments P1-P8, so it is in neither the calibration nor a held-out era. Excluded from fitting and from evaluation alike. See disclosure 1.
- `heldout-b` — SECONDARY held-out era, chronologically after everything including the burned window, and growing with the live collector. Low power; reported for temporal purity, not for significance.

**Three deviations are disclosed, not buried:**

1. Paper §4.1 says the burned window "lies inside the calibration era". Here it lies in **neither** era. Putting it in calibration would place fitting data *after* `heldout-c` in time, inverting walk-forward order and creating exactly the look-ahead §7.3 forbids. Excluding it satisfies §4.1's purpose — the window must never be held-out — strictly more than including it would. This is a paper-owner decision.
2. `heldout-c` (Mar–May 2026) **precedes** the burned window in time. The amendments P1–P8 and the code were designed with knowledge of May–Aug 2026, so a designer who knew the later period could in principle have chosen mechanisms that suit the earlier one. `heldout-b` is chronologically after everything, including the burned window, and carries no such caveat — but it is only 16 days. **Both sealed eras are reported: `heldout-c` for what statistical power exists, `heldout-b` for temporal purity. Neither alone is sufficient.**
3. `heldout-c` is **less burned, not pristine.** It was carved out of the era this project called held-out A in v0.5. That era's *aggregate* statistics — net APY, worst stressed coverage, total cost and turnover — were read while diagnosing v0.5, which is why the remainder of it is now `burned-a` and is reported by nothing. What was learned is that era's overall direction, not this 86-day period's structure, so `heldout-c` is weaker evidence than a never-seen era would be and stronger than `burned-a`. It is used because `heldout-b` alone cannot adjudicate a yield claim.

### Withdrawals are a registered schedule, not observed

`withdrawalSource` = `registered-schedule`. The Navy vault has no Base mainnet history, so §8.1's `W_H` has no real series over this window and `Q_β(W_H)` is computed against a registered schedule. No claim in this report is evidence about real user redemption behaviour.

### Quantities the decision needs that the dataset does not carry

- per-venue absoluteCapBase / maxLossBps / dependencyGroupIds
- dependency group registry (id, capBps, absoluteCapBase, members)
- protocol supply-cap headroom (maxDeployableBase)
- vault adminReserveBase / minIdleBps

Each is supplied as a registered constant, never inferred from data. Gas and oracle observations are **no longer** on this list: they are measured per origin from the block header, the OP-Stack GasPriceOracle and the two Chainlink feeds (series digest `0x0dea1516387012faeeddeb7cb5d44a8858e71ceec7da511b6899dbdec9f6c555`).

## The registered forecast artifact

Fit on the calibration era only (2024-03-15 → 2025-05-31, 443d). Selected by the registered grid: **rolling**, horizon **1d**, coverage target **0.99**.

Per-venue achieved coverage (amendment P1 — the quantile is solved per venue to the target):

| Venue | Achieved coverage |
|---|---|
| `aave-v3-usdc` | 99.01% |
| `compound-v3-usdc` | 99.01% |
| `moonwell-usdc` | 99.01% |

**P8's `k` did not resolve.** The sweep was inconclusive, so `k` remains at 1 as a registered default and every P8 result is provisional. A value chosen because it moves a gate would not be a registration.

## Dataset and provenance

Every figure below is read directly from **Base mainnet** (chainId **8453**) at historical blocks, never simulated or assumed. Each hourly origin is one Multicall3 `aggregate3` batch against `0xcA11bde05977b3631167028862bE2a173976CA11`, calling Compound III Comet, the Aave V3 Pool and the Moonwell mToken directly rather than through the Navy adapters, which have no Base mainnet history of their own. **A venue that could not be read at an origin is recorded as a gap and never interpolated** — a missing observation stays missing rather than being filled from a neighbour.

### Per-era dataset coverage (measured, not declared)

The registered era boundaries above are what was *declared*; this table is what the archive actually *holds* for each — derived from every `MarketSnapshot` row's own `blockNumber` and `timestamp`, not from the boundary dates.

| Era | First date | Last date | First block | Last block | Origins | Days | Sealed |
|---|---|---|---|---|---|---|---|
| `calibration` | 2024-03-15 | 2025-05-31 | 11,835,726 | 30,971,526 | 10,632 | 443 | — |
| `burned-a` | 2025-06-01 | 2026-02-28 | 30,973,326 | 42,765,126 | 6,552 | 273 | — |
| `heldout-c` | 2026-03-01 | 2026-05-25 | 42,766,926 | 46,480,326 | 2,064 | 86 | **sealed** |
| `burned` | 2026-05-26 | 2026-08-23 | 46,482,126 | 50,368,326 | 2,160 | 90 | — |
| `heldout-b` | 2026-08-24 | 2026-09-08 | 50,370,126 | 51,018,126 | 361 | 15 | **sealed** |

### Venue registry

The three allowlisted yield venues, and the asset moved between them. Addresses are verified on-chain, not copied from memory. Rate figures are the observed Comet/Aave/Moonwell supply rate at every origin over the evaluated era(s), annualized.

| Venue | Market ID | Contract address | APY min | APY mean | APY max | Config regimes | IRM contracts |
|---|---|---|---|---|---|---|---|
| Aave V3 Pool | `aave-v3-usdc` | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | 2.31% | 3.05% | 13.05% | 3 | 1 |
| Compound III Comet | `compound-v3-usdc` | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | 2.19% | 3.77% | 14.41% | 1 | 1 |
| Moonwell mUSDC | `moonwell-usdc` | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` | 1.79% | 12.11% | 97.10% | 4 | 4 |

**Asset:** Circle native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals — the one unified USDC across every venue above.

### Measured execution-cost inputs

Gas and oracle values are **measured per origin, not assumed**: the L2 base fee comes from each block's own header; L1 fee parameters come from the OP-Stack GasPriceOracle predeploy at `0x420000000000000000000000000000000000000F`; ETH/USD and USDC/USD come from Chainlink at `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` and `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B` respectively. Ranges below are the min/max actually observed over each evaluated era, not a registered constant.

| Era | Observations | L2 base fee (wei) | L1 base fee (wei) | ETH/USD | USDC/USD | Gas-series digest |
|---|---|---|---|---|---|---|
| `heldout-c` | 2,088 | 5,000,000–83,554,996 | 24,660,517–14,616,020,080 | $1,839.6041–$2,451.6109 | $0.9997–$1.00 | `0x0dea1516387012faeeddeb7cb5d44a8858e71ceec7da511b6899dbdec9f6c555` |
| `heldout-b` | 385 | 5,000,000–15,990,769 | 34,783,083–5,127,002,769 | $2,367.1784–$2,534.7721 | $0.9998–$1.00 | `0xee69e179b08e3474e4597c6c74fad4e6ba0008aed4d24b541ca1ec08ac8f2d20` |


## Results — era `heldout-c`

2064 origins. Manifest `7aebdd94d57015f156b89af82b26b72bac26f1a4d15e81b8e72b6241f7ec31cd`, dataset `4040904b49976906969a94384031e4551bde91b0cbeada3ad8cc6fe8bbd05b23`, result `032881308a9c1f8c994c8e17758da30e4345b8aacf219550426580c472056641`. Reproduce with `pnpm run evaluation:verify`.

`stressedLiquidCoverage` is measured every origin; the §11.5 gate tests only the **minimum** over the whole run, so one market-wide dry hour scores identically to chronic illiquidity. The p05 and median columns below distinguish the two — neither is what the gate tests.

#### Tier 10,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 0.871% | 1 | 3,492 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b1` | 11.2 | 3.181% | 706 | 2,386,246 | 3 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b2` | 11.2 | 3.466% | 222 | 438,123 | 1 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b2u` | 11.2 | 3.668% | 809 | 393,182 | 0 | 100.0% | 99.965% | 100.000% | 100.000% | — |
| `b3` | 11.2 | 0.868% | 1 | 3,492 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b4` | 11.2 | 3.625% | 1896 | 13,613 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b5` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h1` | 11.3 | 1.546% | 1 | 4,000 | 0 | 100.0% | 91.112% | 100.000% | 100.000% | — |
| `h2` | 11.3 | 0.871% | 1 | 3,492 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h3` | 11.3 | 3.462% | 161 | 433,838 | 1 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h4` | 11.3 | 0.871% | 1 | 3,492 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h5` | 11.3 | 0.871% | 1 | 3,492 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h6` | 11.3 | 0.871% | 1 | 3,492 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h7` | 11.3 | 0.871% | 1 | 3,492 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |

#### Tier 100,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 0.871% | 1 | 34,917 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b1` | 11.2 | 3.369% | 706 | 23,862,465 | 3 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b2` | 11.2 | 3.511% | 249 | 3,829,225 | 1 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b2u` | 11.2 | 3.691% | 827 | 3,429,150 | 1 | 100.0% | 99.965% | 100.000% | 100.000% | — |
| `b3` | 11.2 | 0.869% | 1 | 34,917 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b4` | 11.2 | 3.627% | 1896 | 136,131 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b5` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h1` | 11.3 | 1.546% | 1 | 40,000 | 0 | 100.0% | 91.093% | 100.000% | 100.000% | — |
| `h2` | 11.3 | 0.871% | 1 | 34,917 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h3` | 11.3 | 3.506% | 188 | 3,786,380 | 1 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h4` | 11.3 | 0.871% | 1 | 34,917 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h5` | 11.3 | 0.871% | 1 | 34,917 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h6` | 11.3 | 0.871% | 1 | 34,917 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h7` | 11.3 | 0.871% | 1 | 34,917 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |

#### Tier 1,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 0.871% | 1 | 349,169 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b1` | 11.2 | 3.388% | 706 | 238,624,651 | 3 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b2` | 11.2 | 3.501% | 507 | 39,693,984 | 2 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b2u` | 11.2 | 3.670% | 921 | 31,781,799 | 2 | 100.0% | 99.965% | 100.000% | 100.000% | — |
| `b3` | 11.2 | 0.869% | 1 | 349,169 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b4` | 11.2 | 3.627% | 1896 | 1,361,313 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b5` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h1` | 11.3 | 1.309% | 2 | 340,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h2` | 11.3 | 0.871% | 1 | 349,169 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h3` | 11.3 | 3.492% | 446 | 39,291,792 | 2 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h4` | 11.3 | 0.871% | 1 | 349,169 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h5` | 11.3 | 0.871% | 1 | 349,169 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h6` | 11.3 | 0.871% | 1 | 349,169 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h7` | 11.3 | 0.871% | 1 | 349,169 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |

#### Tier 10,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b1` | 11.2 | 3.307% | 802 | 2,942,502,990 | 4 | 100.0% | 10.762% | 98.416% | 100.000% | — |
| `b2` | 11.2 | 2.667% | 1524 | 5,517,434,431 | 8 | 100.0% | 17.126% | 100.000% | 100.000% | — |
| `b2u` | 11.2 | 3.380% | 1901 | 4,773,882,931 | 7 | 100.0% | 6.588% | 99.908% | 100.000% | — |
| `b3` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b4` | 11.2 | 3.627% | 1896 | 13,613,128 | 0 | 100.0% | 0.000% | 0.000% | 88.894% | — |
| `b5` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h1` | 11.3 | 0.052% | 1 | 200,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h2` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h3` | 11.3 | 1.852% | 862 | 413,100,000 | 2 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h4` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h5` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h6` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h7` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |

### SRCLA against each deployable baseline

| Tier | Baseline | SRCLA | Baseline | paired HAC p | bootstrap 95% CI of difference |
|---|---|---|---|---|---|
| 10,000 | `b0` | 0.871% | 0.000% | 0.0000 | [7.95e-7, 1.18e-6] |
| 10,000 | `b1` | 0.871% | 3.181% | 0.0000 | [-2.77e-6, -2.40e-6] |
| 10,000 | `b2` | 0.871% | 3.466% | 0.0000 | [-3.10e-6, -2.72e-6] |
| 10,000 | `b3` | 0.871% | 0.868% | 0.0000 | [1.88e-9, 4.39e-9] |
| 10,000 | `b4` | 0.871% | 3.625% | 0.0000 | [-3.24e-6, -2.92e-6] |
| 10,000 | `h1` | 0.871% | 1.546% | 0.0000 | [-9.51e-7, -5.87e-7] |
| 10,000 | `h2` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h3` | 0.871% | 3.462% | 0.0000 | [-3.09e-6, -2.71e-6] |
| 10,000 | `h4` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h5` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h6` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h7` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `b0` | 0.871% | 0.000% | 0.0000 | [7.95e-7, 1.18e-6] |
| 100,000 | `b1` | 0.871% | 3.369% | 0.0000 | [-2.96e-6, -2.63e-6] |
| 100,000 | `b2` | 0.871% | 3.511% | 0.0000 | [-3.15e-6, -2.77e-6] |
| 100,000 | `b3` | 0.871% | 0.869% | 0.0000 | [1.88e-9, 4.39e-9] |
| 100,000 | `b4` | 0.871% | 3.627% | 0.0000 | [-3.24e-6, -2.92e-6] |
| 100,000 | `h1` | 0.871% | 1.546% | 0.0000 | [-9.51e-7, -5.86e-7] |
| 100,000 | `h2` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h3` | 0.871% | 3.506% | 0.0000 | [-3.14e-6, -2.76e-6] |
| 100,000 | `h4` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h5` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h6` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h7` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `b0` | 0.871% | 0.000% | 0.0000 | [7.95e-7, 1.18e-6] |
| 1,000,000 | `b1` | 0.871% | 3.388% | 0.0000 | [-2.97e-6, -2.65e-6] |
| 1,000,000 | `b2` | 0.871% | 3.501% | 0.0000 | [-3.14e-6, -2.75e-6] |
| 1,000,000 | `b3` | 0.871% | 0.869% | 0.0000 | [1.88e-9, 4.39e-9] |
| 1,000,000 | `b4` | 0.871% | 3.627% | 0.0000 | [-3.24e-6, -2.92e-6] |
| 1,000,000 | `h1` | 0.871% | 1.309% | 0.0000 | [-6.55e-7, -3.48e-7] |
| 1,000,000 | `h2` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h3` | 0.871% | 3.492% | 0.0000 | [-3.13e-6, -2.74e-6] |
| 1,000,000 | `h4` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h5` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h6` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h7` | 0.871% | 0.871% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `b0` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `b1` | 0.000% | 3.307% | 0.0000 | [-3.88e-6, -3.56e-6] |
| 10,000,000 | `b2` | 0.000% | 2.667% | 0.0000 | [-3.17e-6, -2.86e-6] |
| 10,000,000 | `b3` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `b4` | 0.000% | 3.627% | 0.0000 | [-4.25e-6, -3.87e-6] |
| 10,000,000 | `h1` | 0.000% | 0.052% | 0.0000 | [-7.09e-8, -4.77e-8] |
| 10,000,000 | `h2` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h3` | 0.000% | 1.852% | 0.0000 | [-2.22e-6, -1.97e-6] |
| 10,000,000 | `h4` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h5` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h6` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h7` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |

## Ablation contributions

Each row below removes exactly one component from SRCLA (§11.3) and reports what that component was measured to be worth: `contribution = SRCLA net APY − ablation net APY` at the same tier. **Positive** means removing the component made the policy worse — the component was earning its keep. **Negative** means removing it made the policy BETTER — the component cost more than it earned on this data.

#### Tier 10,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 0.871% | 1.546% | **-0.675 pp** | 1 | 1 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 0.871% | 0.871% | +0.000 pp | 1 | 1 |
| `h3` | remove the complete-cost gate and the no-trade band. | 0.871% | 3.462% | **-2.591 pp** | 161 | 1 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 0.871% | 0.871% | +0.000 pp | 1 | 1 |
| `h5` | remove shared-dependency caps. | 0.871% | 0.871% | **INERT** (identical decisions — not a measured contribution) | 1 | 1 |
| `h6` | remove c_i^liquidity. | 0.871% | 0.871% | **INERT** (identical decisions — not a measured contribution) | 1 | 1 |
| `h7` | remove the phi_i weighting. | 0.871% | 0.871% | **INERT** (identical decisions — not a measured contribution) | 1 | 1 |

#### Tier 100,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 0.871% | 1.546% | **-0.675 pp** | 1 | 1 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 0.871% | 0.871% | +0.000 pp | 1 | 1 |
| `h3` | remove the complete-cost gate and the no-trade band. | 0.871% | 3.506% | **-2.634 pp** | 188 | 1 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 0.871% | 0.871% | +0.000 pp | 1 | 1 |
| `h5` | remove shared-dependency caps. | 0.871% | 0.871% | **INERT** (identical decisions — not a measured contribution) | 1 | 1 |
| `h6` | remove c_i^liquidity. | 0.871% | 0.871% | +0.000 pp | 1 | 1 |
| `h7` | remove the phi_i weighting. | 0.871% | 0.871% | **INERT** (identical decisions — not a measured contribution) | 1 | 1 |

#### Tier 1,000,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 0.871% | 1.309% | **-0.438 pp** | 2 | 1 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 0.871% | 0.871% | +0.000 pp | 1 | 1 |
| `h3` | remove the complete-cost gate and the no-trade band. | 0.871% | 3.492% | **-2.621 pp** | 446 | 1 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 0.871% | 0.871% | +0.000 pp | 1 | 1 |
| `h5` | remove shared-dependency caps. | 0.871% | 0.871% | **INERT** (identical decisions — not a measured contribution) | 1 | 1 |
| `h6` | remove c_i^liquidity. | 0.871% | 0.871% | +0.000 pp | 1 | 1 |
| `h7` | remove the phi_i weighting. | 0.871% | 0.871% | **INERT** (identical decisions — not a measured contribution) | 1 | 1 |

#### Tier 10,000,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 0.000% | 0.052% | **-0.052 pp** | 1 | 0 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h3` | remove the complete-cost gate and the no-trade band. | 0.000% | 1.852% | **-1.852 pp** | 862 | 0 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h5` | remove shared-dependency caps. | 0.000% | 0.000% | **INERT** (identical decisions — not a measured contribution) | 0 | 0 |
| `h6` | remove c_i^liquidity. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h7` | remove the phi_i weighting. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |

> **Negative contribution: removing the component helped, not hurt.** This is the report's most important measured signal — the component cost more than it earned on this data.
>
> - `h1` (remove post-deposit simulation; rank on displayed rate.) at tier 10,000 USDC: contribution **-0.675 pp**.
> - `h3` (remove the complete-cost gate and the no-trade band.) at tier 10,000 USDC: contribution **-2.591 pp**.
> - `h1` (remove post-deposit simulation; rank on displayed rate.) at tier 100,000 USDC: contribution **-0.675 pp**.
> - `h3` (remove the complete-cost gate and the no-trade band.) at tier 100,000 USDC: contribution **-2.634 pp**.
> - `h1` (remove post-deposit simulation; rank on displayed rate.) at tier 1,000,000 USDC: contribution **-0.438 pp**.
> - `h3` (remove the complete-cost gate and the no-trade band.) at tier 1,000,000 USDC: contribution **-2.621 pp**.
> - `h1` (remove post-deposit simulation; rank on displayed rate.) at tier 10,000,000 USDC: contribution **-0.052 pp**.
> - `h3` (remove the complete-cost gate and the no-trade band.) at tier 10,000,000 USDC: contribution **-1.852 pp**.


### §11.5 gate

| Verdict | Check | Detail |
|---|---|---|
| PASS | Every registered tier ran | all 4 of §11.1's tiers |
| PASS | Every registered policy ran at every tier | all 60 required (policy, tier) runs |
| PASS | Calibrated artifact | 5089c131b80a00671f8c83ece763ea7c8f74821a03694e2f92fbb365e3cb5013 |
| PASS | Safety: withdrawal success measured and met | >= 99% across 60 runs |
| **FAIL** | Safety: stressed liquid coverage | h1@10000000000 0.911, h1@100000000000 0.911 |
| **FAIL** | No inert ablation | these made byte-identical decisions to SRCLA: h5, h6, h7 |
| **FAIL** | Statistically distinguishable from every deployable baseline | test not usable for h2@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h4@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h5@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h6@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h7@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h2@100000000000 (DEGENERATE: the paired difference series has zero long-run variance), h4@100000000000 (DEGENERATE: the paired difference series has… |
| **FAIL** | Outperforms every deployable baseline | b1@10000000000: SRCLA 0.871% vs 3.181%, b2@10000000000: SRCLA 0.871% vs 3.466%, b4@10000000000: SRCLA 0.871% vs 3.625%, h1@10000000000: SRCLA 0.871% vs 1.546%, h2@10000000000: SRCLA 0.871% vs 0.871%, h3@10000000000: SRCLA 0.871% vs 3.462%, h4@10000000000: SRCLA 0.871% vs 0.871%, h5@10000000000: SRCLA 0.871% vs 0.871%, h6@10000000000: SRCLA 0.871% vs 0.871%, h7@10000000000: SRCLA 0.871% vs 0.871%, b1@100000000000: SRCLA 0.871% vs 3.369%, b2@100000000000: SRCLA 0.871% vs 3.511%, b4@100000000000: SRCLA 0.871% vs 3.627%, h1@100000000000: SRCLA 0.871% vs 1.546%, h2@100000000000: SRCLA 0.871% vs… |
| **NOT PRODUCED** | §11.1 pinned-prestate fork replay | NOT PRODUCED: no fork replay was supplied. src/evaluation/fork-runner.ts is the scaffold for this and is wired to nothing. |

## Results — era `heldout-b`

361 origins. Manifest `f75c0fa189251a4b4a0aaa57e915112fa42528d96bc2e8d512b59e650571ed65`, dataset `a2e5906b805ef53da46de5978c1be4c273f1fa6c09f01bd92ff67bb5241009ad`, result `d37f41344ff17ad404dda4685c56dc361d63eec88e532e8be19d7cd6ea6adacb`. Reproduce with `pnpm run evaluation:verify`.

`stressedLiquidCoverage` is measured every origin; the §11.5 gate tests only the **minimum** over the whole run, so one market-wide dry hour scores identically to chronic illiquidity. The p05 and median columns below distinguish the two — neither is what the gate tests.

#### Tier 10,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b1` | 11.2 | 39.156% | 291 | 57,384 | 0 | 100.0% | 87.802% | 87.820% | 94.161% | — |
| `b2` | 11.2 | 39.157% | 288 | 22,184 | 0 | 100.0% | 87.802% | 87.820% | 94.161% | — |
| `b2u` | 11.2 | 39.313% | 225 | 10,984 | 0 | 100.0% | 87.797% | 87.815% | 94.156% | — |
| `b3` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b4` | 11.2 | 24.951% | 193 | 9,981 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b5` | 11.2 | 18.781% | 1 | 5,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h1` | 11.3 | 18.665% | 1 | 5,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h2` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h3` | 11.3 | 39.157% | 288 | 22,184 | 0 | 100.0% | 87.802% | 87.820% | 94.161% | — |
| `h4` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h5` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h6` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h7` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |

#### Tier 100,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b1` | 11.2 | 39.182% | 291 | 573,838 | 0 | 100.0% | 87.801% | 87.819% | 94.160% | — |
| `b2` | 11.2 | 39.177% | 290 | 221,838 | 0 | 100.0% | 87.802% | 87.819% | 94.160% | — |
| `b2u` | 11.2 | 39.315% | 225 | 109,839 | 0 | 100.0% | 87.797% | 87.814% | 94.156% | — |
| `b3` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b4` | 11.2 | 24.953% | 193 | 99,809 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b5` | 11.2 | 18.783% | 1 | 50,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h1` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h2` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h3` | 11.3 | 39.177% | 290 | 221,838 | 0 | 100.0% | 87.802% | 87.819% | 94.160% | — |
| `h4` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h5` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h6` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h7` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |

#### Tier 1,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b1` | 11.2 | 39.185% | 291 | 5,738,384 | 0 | 100.0% | 87.800% | 87.818% | 94.155% | — |
| `b2` | 11.2 | 38.684% | 308 | 5,658,373 | 0 | 100.0% | 87.816% | 87.833% | 94.164% | — |
| `b2u` | 11.2 | 39.027% | 313 | 5,258,381 | 0 | 100.0% | 87.805% | 87.822% | 94.157% | — |
| `b3` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b4` | 11.2 | 24.953% | 193 | 998,095 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b5` | 11.2 | 18.783% | 1 | 500,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h1` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h2` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h3` | 11.3 | 11.684% | 308 | 5,017,798 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h4` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h5` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h6` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h7` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |

#### Tier 10,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b1` | 11.2 | 38.551% | 292 | 93,783,699 | 0 | 100.0% | 87.820% | 87.837% | 94.168% | — |
| `b2` | 11.2 | 14.342% | 29 | 30,600,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b2u` | 11.2 | 18.820% | 22 | 35,400,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b3` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `b4` | 11.2 | 24.953% | 193 | 9,980,948 | 0 | 100.0% | 58.975% | 58.984% | 66.379% | — |
| `b5` | 11.2 | 6.582% | 1 | 1,600,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h1` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h2` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h3` | 11.3 | 2.328% | 19 | 8,800,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h4` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h5` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | **INERT** |
| `h6` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |
| `h7` | 11.3 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | — |

### SRCLA against each deployable baseline

| Tier | Baseline | SRCLA | Baseline | paired HAC p | bootstrap 95% CI of difference |
|---|---|---|---|---|---|
| 10,000 | `b0` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `b1` | 0.000% | 39.156% | 0.0000 | [-4.42e-5, -3.14e-5] |
| 10,000 | `b2` | 0.000% | 39.157% | 0.0000 | [-4.42e-5, -3.14e-5] |
| 10,000 | `b3` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `b4` | 0.000% | 24.951% | 0.0000 | [-2.96e-5, -2.14e-5] |
| 10,000 | `h1` | 0.000% | 18.665% | 0.0000 | [-2.32e-5, -1.60e-5] |
| 10,000 | `h2` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h3` | 0.000% | 39.157% | 0.0000 | [-4.42e-5, -3.14e-5] |
| 10,000 | `h4` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h5` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h6` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000 | `h7` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `b0` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `b1` | 0.000% | 39.182% | 0.0000 | [-4.42e-5, -3.14e-5] |
| 100,000 | `b2` | 0.000% | 39.177% | 0.0000 | [-4.42e-5, -3.14e-5] |
| 100,000 | `b3` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `b4` | 0.000% | 24.953% | 0.0000 | [-2.96e-5, -2.14e-5] |
| 100,000 | `h1` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h2` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h3` | 0.000% | 39.177% | 0.0000 | [-4.42e-5, -3.14e-5] |
| 100,000 | `h4` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h5` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h6` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 100,000 | `h7` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `b0` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `b1` | 0.000% | 39.185% | 0.0000 | [-4.42e-5, -3.14e-5] |
| 1,000,000 | `b2` | 0.000% | 38.684% | 0.0000 | [-4.37e-5, -3.11e-5] |
| 1,000,000 | `b3` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `b4` | 0.000% | 24.953% | 0.0000 | [-2.96e-5, -2.14e-5] |
| 1,000,000 | `h1` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h2` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h3` | 0.000% | 11.684% | 0.0000 | [-1.42e-5, -1.11e-5] |
| 1,000,000 | `h4` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h5` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h6` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 1,000,000 | `h7` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `b0` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `b1` | 0.000% | 38.551% | 0.0000 | [-4.36e-5, -3.10e-5] |
| 10,000,000 | `b2` | 0.000% | 14.342% | 0.0000 | [-1.77e-5, -1.30e-5] |
| 10,000,000 | `b3` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `b4` | 0.000% | 24.953% | 0.0000 | [-2.96e-5, -2.14e-5] |
| 10,000,000 | `h1` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h2` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h3` | 0.000% | 2.328% | 0.0000 | [-2.86e-6, -2.41e-6] |
| 10,000,000 | `h4` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h5` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h6` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |
| 10,000,000 | `h7` | 0.000% | 0.000% | not usable (DEGENERATE: the paired difference series has zero long-run variance) | [0.00e+0, 0.00e+0] |

## Ablation contributions

Each row below removes exactly one component from SRCLA (§11.3) and reports what that component was measured to be worth: `contribution = SRCLA net APY − ablation net APY` at the same tier. **Positive** means removing the component made the policy worse — the component was earning its keep. **Negative** means removing it made the policy BETTER — the component cost more than it earned on this data.

#### Tier 10,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 0.000% | 18.665% | **-18.665 pp** | 1 | 0 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 0.000% | 0.000% | **INERT** (identical decisions — not a measured contribution) | 0 | 0 |
| `h3` | remove the complete-cost gate and the no-trade band. | 0.000% | 39.157% | **-39.157 pp** | 288 | 0 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h5` | remove shared-dependency caps. | 0.000% | 0.000% | **INERT** (identical decisions — not a measured contribution) | 0 | 0 |
| `h6` | remove c_i^liquidity. | 0.000% | 0.000% | **INERT** (identical decisions — not a measured contribution) | 0 | 0 |
| `h7` | remove the phi_i weighting. | 0.000% | 0.000% | **INERT** (identical decisions — not a measured contribution) | 0 | 0 |

#### Tier 100,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 0.000% | 0.000% | **INERT** (identical decisions — not a measured contribution) | 0 | 0 |
| `h3` | remove the complete-cost gate and the no-trade band. | 0.000% | 39.177% | **-39.177 pp** | 290 | 0 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h5` | remove shared-dependency caps. | 0.000% | 0.000% | **INERT** (identical decisions — not a measured contribution) | 0 | 0 |
| `h6` | remove c_i^liquidity. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h7` | remove the phi_i weighting. | 0.000% | 0.000% | **INERT** (identical decisions — not a measured contribution) | 0 | 0 |

#### Tier 1,000,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h3` | remove the complete-cost gate and the no-trade band. | 0.000% | 11.684% | **-11.684 pp** | 308 | 0 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h5` | remove shared-dependency caps. | 0.000% | 0.000% | **INERT** (identical decisions — not a measured contribution) | 0 | 0 |
| `h6` | remove c_i^liquidity. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h7` | remove the phi_i weighting. | 0.000% | 0.000% | **INERT** (identical decisions — not a measured contribution) | 0 | 0 |

#### Tier 10,000,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h3` | remove the complete-cost gate and the no-trade band. | 0.000% | 2.328% | **-2.328 pp** | 19 | 0 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h5` | remove shared-dependency caps. | 0.000% | 0.000% | **INERT** (identical decisions — not a measured contribution) | 0 | 0 |
| `h6` | remove c_i^liquidity. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |
| `h7` | remove the phi_i weighting. | 0.000% | 0.000% | +0.000 pp | 0 | 0 |

> **Negative contribution: removing the component helped, not hurt.** This is the report's most important measured signal — the component cost more than it earned on this data.
>
> - `h1` (remove post-deposit simulation; rank on displayed rate.) at tier 10,000 USDC: contribution **-18.665 pp**.
> - `h3` (remove the complete-cost gate and the no-trade band.) at tier 10,000 USDC: contribution **-39.157 pp**.
> - `h3` (remove the complete-cost gate and the no-trade band.) at tier 100,000 USDC: contribution **-39.177 pp**.
> - `h3` (remove the complete-cost gate and the no-trade band.) at tier 1,000,000 USDC: contribution **-11.684 pp**.
> - `h3` (remove the complete-cost gate and the no-trade band.) at tier 10,000,000 USDC: contribution **-2.328 pp**.


### §11.5 gate

| Verdict | Check | Detail |
|---|---|---|
| PASS | Every registered tier ran | all 4 of §11.1's tiers |
| PASS | Every registered policy ran at every tier | all 60 required (policy, tier) runs |
| PASS | Calibrated artifact | 5089c131b80a00671f8c83ece763ea7c8f74821a03694e2f92fbb365e3cb5013 |
| PASS | Safety: withdrawal success measured and met | >= 99% across 60 runs |
| **FAIL** | Safety: stressed liquid coverage | b1@10000000000 0.878, b2@10000000000 0.878, b2u@10000000000 0.878, h3@10000000000 0.878, b1@100000000000 0.878, b2@100000000000 0.878, b2u@100000000000 0.878, h3@100000000000 0.878, b1@1000000000000 0.878, b2@1000000000000 0.878, b2u@1000000000000 0.878, b1@10000000000000 0.878, b4@10000000000000 0.590 |
| **FAIL** | No inert ablation | these made byte-identical decisions to SRCLA: h2, h5, h6, h7 |
| **FAIL** | Statistically distinguishable from every deployable baseline | test not usable for b0@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), b3@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h2@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h4@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h5@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h6@10000000000 (DEGENERATE: the paired difference series has zero long-run variance), h7@10000000000 (DEGENERATE: the paired difference series has… |
| **FAIL** | Outperforms every deployable baseline | b0@10000000000: SRCLA 0.000% vs 0.000%, b1@10000000000: SRCLA 0.000% vs 39.156%, b2@10000000000: SRCLA 0.000% vs 39.157%, b3@10000000000: SRCLA 0.000% vs 0.000%, b4@10000000000: SRCLA 0.000% vs 24.951%, h1@10000000000: SRCLA 0.000% vs 18.665%, h2@10000000000: SRCLA 0.000% vs 0.000%, h3@10000000000: SRCLA 0.000% vs 39.157%, h4@10000000000: SRCLA 0.000% vs 0.000%, h5@10000000000: SRCLA 0.000% vs 0.000%, h6@10000000000: SRCLA 0.000% vs 0.000%, h7@10000000000: SRCLA 0.000% vs 0.000%, b0@100000000000: SRCLA 0.000% vs 0.000%, b1@100000000000: SRCLA 0.000% vs 39.182%, b2@100000000000: SRCLA 0.000%… |
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
DATABASE_URL='...' pnpm evaluation:run --era heldout-c --artifact config/registered-artifact.json --out evaluation-heldout-c.json
DATABASE_URL='...' pnpm evaluation:run --era heldout-b --artifact config/registered-artifact.json --out evaluation-heldout-b.json
```

