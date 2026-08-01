# SRCLA Research and Evaluation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the novelty, reproducibility, economic performance, safety, and on-chain executability of the Safe Robust Cost-aware Lending Allocator for a pooled Base USDC ERC-4626 vault.

**Architecture:** Separate evidence, historical data, protocol-exact simulation, probabilistic forecasting, constrained allocation, impulse execution, vault enforcement, and paper reporting. Each layer emits versioned artifacts so every decision and result can be reproduced without proprietary services.

**Tech Stack:** IEEE/BibTeX research corpus; Python 3.12 with `uv`, Polars, DuckDB, PyArrow, Web3.py, SciPy, CVXPY, scikit-learn, LightGBM, and pytest; Solidity 0.8.24 with Foundry; existing NestJS/ethers keeper; Base archive RPC and pinned fork blocks.

## Global Constraints

- Unleveraged USDC supplied directly on Base to Aave V3, Compound III, Moonwell, and eligible Morpho Blue markets.
- ERC-4626 is the pooled ownership and accounting boundary.
- Curated allocator vaults are related work, not destinations.
- Maximize realized net yield subject to deterministic hard safety constraints.
- Use identical markets, information, costs, delay, and safety policy for every baseline.
- Evaluate \$10,000, \$100,000, \$1 million, and \$10 million with one policy.
- Use chronological walk-forward evaluation and Base-fork replay.
- Forecasts cannot override on-chain eligibility, caps, reserves, losses, or destinations.
- Factual prior-work claims require IEEE citations to primary sources; code and on-chain evidence require pinned versions and blocks.
- Markdown mathematics uses Obsidian-compatible `$...$` and `$$...$$`.

---

## Workstream boundaries

| Workstream | Independent deliverable | Gate |
|---|---|---|
| A. Evidence | Registered search, screened corpus, IEEE bibliography, novelty matrix | Closest prior methods are pinned |
| B. Base data | Versioned registry and normalized historical dataset | Block reconstruction tests pass |
| C. Controller | Exact adapters, baselines, forecasts, optimizer, impulse policy | Unit, property, and walk-forward tests pass |
| D. Execution | On-chain safety interface and fork replay | Accounting and safety invariants pass |
| E. Paper | Frozen experiments, results, figures, manuscript | All claims regenerate from artifacts |

Workstreams B–E receive separate detailed execution plans after Workstream A freezes definitions and sources.

### Task 1: Register the systematic-review protocol

**Files:**
- Create: `docs/research/output/systematic-review-protocol.md`
- Create: `docs/research/output/search-log.csv`
- Create: `docs/research/output/screening-log.csv`
- Create: `docs/research/output/references.bib`

**Interfaces:**
- Consumes: the approved design and two landscape reviews.
- Produces: frozen inclusion criteria, searches, status vocabulary, and bibliography keys.

- [ ] **Step 1: Define the review question**

Use Population–Intervention–Comparator–Outcome: direct unleveraged stablecoin lending; allocation/rebalancing controller; current-rate, capacity-aware, cost-threshold, robust-static, and disclosed production comparators; realized net yield, turnover, withdrawal success, and safety violations.

- [ ] **Step 2: Register exact source searches**

Cover IEEE Xplore, ACM DL, SpringerLink, ScienceDirect, SSRN, arXiv, protocol repositories, official documentation, and governance forums. Combine: `DeFi lending`, `yield allocation`, `endogenous utilization`, `transaction cost`, `no-trade region`, `impulse control`, `robust optimization`, `withdrawal liquidity`, and `systemic dependency`.

- [ ] **Step 3: Define screening statuses**

Use only `include`, `exclude-out-of-scope`, `exclude-secondary`, `exclude-no-policy`, `exclude-duplicate`, and `awaiting-full-text`. Every exclusion records one reason and review date.

- [ ] **Step 4: Add current primary sources to BibTeX**

Each record includes author/corporate author, title, venue/type, year, DOI or persistent identifier, version, URL, and access date. Repositories include pinned commits; protocol parameters include chain, address, and block.

- [ ] **Step 5: Validate artifacts**

Run:

```bash
python - <<'PY'
import csv
from pathlib import Path
for name in ("search-log.csv", "screening-log.csv"):
    with (Path("docs/research/output") / name).open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
        assert rows
        assert all(all(value.strip() for value in row.values()) for row in rows)
bib = Path("docs/research/output/references.bib").read_text(encoding="utf-8")
assert "doi" in bib.lower()
assert "urldate" in bib.lower()
PY
```

- [ ] **Step 6: Commit**

```bash
git add -f docs/research/output/systematic-review-protocol.md docs/research/output/search-log.csv docs/research/output/screening-log.csv docs/research/output/references.bib
git commit -m "research: register lending rebalance review protocol"
```

### Task 2: Complete the primary-source evidence corpus

**Files:**
- Create: `docs/research/output/evidence-matrix.csv`
- Create: `docs/research/output/closest-prior-work.md`
- Modify: `docs/research/output/references.bib`
- Modify: `docs/research/output/search-log.csv`
- Modify: `docs/research/output/screening-log.csv`

**Interfaces:**
- Consumes: Task 1.
- Produces: one evidence row per disclosed policy or mathematical method and a bounded novelty conclusion.

- [ ] **Step 1: Screen academic methods**

Cover endogenous-return allocation, decision-dependent uncertainty, robust/DRO control, transaction-cost impulse control, OCO with switching costs, liquidity-run constraints, and dependency/network risk.

- [ ] **Step 2: Screen production policies**

Inspect Idle, Yearn allocators, Morpho/MetaMorpho, Aave allocation products, Compound allocators, Moonwell/Seamless, Instadapp/Fluid, Euler Earn, Enzyme, CIAN, ZyfAI, Yield Seeker, Mamo, Giza, Surf, Sail, and Almanak. Retain evidence exposing an objective, transformation, constraint, trigger, execution rule, or emergency policy.

- [ ] **Step 3: Normalize evidence**

Use columns: `citation_key`, `source_type`, `review_status`, `objective`, `decision_variables`, `state_inputs`, `rate_impact`, `uncertainty`, `constraints`, `rebalance_trigger`, `cost_model`, `liquidity_model`, `dependency_model`, `execution`, `emergency_policy`, `published_parameters`, `code_available`, `data_available`, `reproducibility`, `limitations`, and `primary_url`.

- [ ] **Step 4: Write closest-prior-work analysis**

For every SRCLA component, identify the closest academic antecedent and production disclosure. Classify it as `identical`, `adapted`, `integrated`, or `not found in bounded review`. Never infer novelty from `not found` alone.

- [ ] **Step 5: Validate evidence**

```bash
python - <<'PY'
import csv
from pathlib import Path
with Path("docs/research/output/evidence-matrix.csv").open(newline="", encoding="utf-8") as handle:
    rows = list(csv.DictReader(handle))
required = {"citation_key", "source_type", "objective", "constraints", "rebalance_trigger", "reproducibility", "limitations", "primary_url"}
assert rows and required <= set(rows[0])
keys = [row["citation_key"] for row in rows]
assert len(keys) == len(set(keys))
assert all(row["primary_url"] for row in rows)
PY
```

- [ ] **Step 6: Commit**

```bash
git add -f docs/research/output/evidence-matrix.csv docs/research/output/closest-prior-work.md docs/research/output/references.bib docs/research/output/search-log.csv docs/research/output/screening-log.csv
git commit -m "research: complete lending algorithm evidence matrix"
```

### Task 3: Freeze the Base market and data specification

**Files:**
- Create: `docs/research/output/base-usdc-market-registry.csv`
- Create: `docs/research/output/data-dictionary.md`
- Create: `docs/research/output/dataset-manifest.schema.json`
- Create: `docs/research/output/dependency-taxonomy.md`

**Interfaces:**
- Consumes: verified addresses, contracts, and evidence definitions.
- Produces: versioned identifiers and schemas for the data pipeline.

- [ ] **Step 1: Pin deployments**

Record chain ID, USDC, lending contract, implementation, rate model, rewards, oracle, collateral, LLTV, governance/admin, deployment block, observation block, code commit, and citation for each protocol and Morpho market.

- [ ] **Step 2: Define eligibility and state fields**

Include verification, data coverage, supply, borrows, liquidity, utilization, pauses, caps, oracle state, collateral liquidity, liquidation venue, governance delay, and incident exclusions.

- [ ] **Step 3: Define normalized time series**

Specify units and sampling for block, timestamp, utilization, base/incentive rate, reward price, liquidity, gas, parameters, flows, governance events, and stress observations.

- [ ] **Step 4: Define dependency groups**

Create identifiers for implementation, upgrade authority, oracle/feed, collateral family, liquidation venue, incentive token, USDC, Base sequencer, keeper, and data provider.

- [ ] **Step 5: Validate registry**

```bash
python - <<'PY'
import csv
from pathlib import Path
with Path("docs/research/output/base-usdc-market-registry.csv").open(newline="", encoding="utf-8") as handle:
    rows = list(csv.DictReader(handle))
assert rows
ids = [row["market_id"] for row in rows]
assert len(ids) == len(set(ids))
assert all(row["chain_id"] == "8453" for row in rows)
assert all(row["loan_asset_symbol"] == "USDC" for row in rows)
assert all(row["observation_block"] and row["primary_evidence"] for row in rows)
PY
```

- [ ] **Step 6: Commit**

```bash
git add -f docs/research/output/base-usdc-market-registry.csv docs/research/output/data-dictionary.md docs/research/output/dataset-manifest.schema.json docs/research/output/dependency-taxonomy.md
git commit -m "research: pin Base USDC market specifications"
```

### Task 4: Plan the reproducible Base data pipeline

**Files:**
- Create: `docs/research/output/plans/base-lending-data-pipeline-plan.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: exact TDD steps for `research-engine/` RPC ingestion, state reconstruction, Parquet output, manifests, and integrity tests.

- [ ] **Step 1:** Map focused modules for RPC calls, logs, timestamps, per-protocol state, rewards, gas, dependencies, schemas, and hashes.
- [ ] **Step 2:** Pin one or more Base fixture blocks per protocol with expected values from direct calls.
- [ ] **Step 3:** Require idempotence, monotonic blocks, unique market/block keys, exact units, no future leakage, hashes, and on-chain reconciliation.
- [ ] **Step 4:** Scan for placeholders, run Markdown checks, and commit the plan.

### Task 5: Plan the SRCLA research controller

**Files:**
- Create: `docs/research/output/plans/srcla-controller-plan.md`

**Interfaces:**
- Consumes: frozen data and evidence definitions.
- Produces: exact TDD steps for adapters, B0–B5, forecasts, constraints, reserve policy, optimizer, and impulse controller.

- [ ] **Step 1:** Define immutable types for market state, forecast distribution, constraint result, transition cost, target, action plan, and decision log.
- [ ] **Step 2:** Specify hand-calculated Aave/Moonwell kink, Compound supply curve, Morpho IRM path, post-deposit utilization, reserve, dependency, boundary-trade, cooldown-bypass, and tier-invariance tests.
- [ ] **Step 3:** Require chronological features, no leakage, quantile calibration, deterministic seeds, fallback behavior, and ablations.
- [ ] **Step 4:** Ensure every baseline consumes identical snapshots and feasibility sets and B5 is unavailable to deployable paths.
- [ ] **Step 5:** Scan for placeholders, verify interface consistency, and commit.

### Task 6: Plan ERC-4626 safety execution

**Files:**
- Create: `docs/research/output/plans/erc4626-safety-execution-plan.md`

**Interfaces:**
- Consumes: `contract/src/NavyVault.sol`, adapters, keeper services, and the action-plan schema.
- Produces: exact Foundry/NestJS TDD steps for bounded proposals, liquidity limits, accounting, safety exits, and Base forks.

- [ ] **Step 1:** Reconcile current registration-order withdrawals, advisory targets, static `minIdleBps`, reverting adapters valued at zero, absent deadlines/state tolerances, and current Compound/Morpho adapters with the design.
- [ ] **Step 2:** Specify fair pricing, non-dilution, asset conservation, caps, destination restrictions, reserve, loss, honest `maxWithdraw`/`maxRedeem`, pause, stale proposal, and safety authority invariants.
- [ ] **Step 3:** Pin fork cases for deposit, passive deploy, economic move, ordered withdrawal, stale state, cap failure, pause, illiquidity, and emergency divestment.
- [ ] **Step 4:** Scan for placeholders, verify contract/keeper interface consistency, and commit.

### Task 7: Freeze experiments and the paper

**Files:**
- Create: `docs/research/output/experiment-manifest.schema.json`
- Create: `docs/research/output/plans/srcla-experiments-and-paper-plan.md`
- Create: `docs/research/output/paper-outline.md`

**Interfaces:**
- Consumes: Workstreams A–D.
- Produces: predeclared hypotheses, metrics, splits, scenarios, figures, tables, and sections.

- [ ] **Step 1: Define experiment manifests**

Require dataset hash, registry version, chronological splits, tier, vault flows, cadence, delay, gas, rewards, safety policy, model, seed, baseline, stress scenario, and output hash.

- [ ] **Step 2: Map H1–H6 to comparisons**

Use paired periods and scenarios, effect sizes, uncertainty intervals, and correction for repeated tier/baseline comparisons.

- [ ] **Step 3: Define generated artifacts**

Include prior-work matrix, architecture, calibration, net yield, turnover, tier sensitivity, stressed withdrawals, dependencies, ablations, and fork outcomes. Name the generating script and manifest for every table and figure.

- [ ] **Step 4: Define paper structure**

Use Abstract; Introduction and Contributions; Background; Related Work; System and Threat Model; Problem Formulation; SRCLA Design; Data and Reproducibility; Experimental Method; Results; Ablations; Security and Limitations; Discussion; Conclusion; IEEE References; Artifact Appendix.

- [ ] **Step 5: Validate and commit**

```bash
python -m json.tool docs/research/output/experiment-manifest.schema.json >/dev/null
rg -n "H1|H2|H3|H4|H5|H6" docs/research/output/plans/srcla-experiments-and-paper-plan.md
rg -n "IEEE References|Artifact Appendix|Limitations" docs/research/output/paper-outline.md
git add -f docs/research/output/experiment-manifest.schema.json docs/research/output/plans/srcla-experiments-and-paper-plan.md docs/research/output/paper-outline.md
git commit -m "research: freeze SRCLA experiments and paper plan"
```

## Program completion gate

- Systematic searches and screening are reproducible.
- Every related-work claim resolves to an IEEE record and primary source.
- Registry, dataset, code, parameters, seeds, and manifests are pinned.
- B0–B5 and ablations use identical inputs and constraints.
- Forecast calibration is out of sample.
- Historical results reconcile to share-price and user-profit accounting.
- Fork replay passes vault invariants at pinned blocks.
- Every table and figure regenerates from a committed script and manifest.
- Superiority claims remain conditional on tested scope and evidence.
