# SRCLA — Safe, Robust, Cost-Aware Lending Allocation

[![Network: Base](https://img.shields.io/badge/Network-Base_(8453)-0052FF.svg)](https://basescan.org/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-brightgreen.svg)](https://soliditylang.org/)
[![Foundry](https://img.shields.io/badge/Foundry-Testing_%26_Deployment-orange.svg)](https://getfoundry.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Fastify_4-3178C6.svg)](https://fastify.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-5-2D3748.svg)](https://www.prisma.io/)

**SRCLA** allocates a pooled USDC ERC-4626 vault across three lending venues on **Base (chainId `8453`)**:
Compound III, Aave V3 and Moonwell. It forecasts each venue's supply yield, including how the vault's own deposit
moves the rate. It holds a dynamic liquidity reserve, and it moves capital only when the forecast edge clears the
cost of moving — all inside guardrails the vault contract enforces on-chain.

This is the research codebase of the thesis *Navy – Nghiên cứu và thiết kế hệ thống phân bổ tối ưu hóa tài sản
ERC-20 trên các giao thức cho vay phi tập trung*.

> **Status: the registered evaluation returns `FAIL`.** It was run on both sealed held-out eras and the result is
> published rather than tuned away. The gates, the per-tier numbers and the disclosures are in
> [`report/SRCLA-REPORT.md`](report/SRCLA-REPORT.md).

> **No testnet.** Local development runs against an **Anvil fork of Base mainnet** on `:8545`. Nothing here is
> production-ready.

---

## Repository layout

| Path | Contents |
| :--- | :--- |
| **`srcla/`** | TypeScript, Fastify 4, Prisma 5. The algorithm as a long-running service — collector, forecaster, policy, keeper — plus the registered evaluation harness |
| **`contract/`** | Foundry, Solidity `0.8.24`. `NavyVaultSRCLA` (pooled ERC-4626), the Compound III / Aave V3 / Moonwell adapters, the reward contracts, deploy scripts and the audit |
| `report/SRCLA-REPORT.md` | The registered evaluation report |
| `report/figures/` | APY, stressed coverage and capital at work by vault size, per sealed era (SVG + PNG), and `image.png`: Moonwell's Base USDC market at 100% utilization |
| `report/chart/` | `SRCLA-FIGURE-SWEEP-<era>.json` — the numbers each figure is drawn from |
| `SRCLA-REPORT.json` | The report as data, with the result, manifest and dataset hashes |

Everything under `report/` except `image.png`, and `SRCLA-REPORT.json`, is generated: by `pnpm phase4:run`,
with the PNGs from `pnpm figures:render --png`. Edit the renderer in `srcla/src/evaluation/report/`, not the
output.

The two apps are independent — no workspace, each with its own tooling.

---

## How it fits together

```
 Base mainnet archive ── pnpm backfill:history ──┐
                                                 ▼
 Anvil fork of Base (:8545) ── collector ──▶ srcla Postgres (:5433)
        ▲                                        │
        │                          forecast → reserve → policy → plan
        │ submitPlan (ALLOCATOR_ROLE)            │
        └───────────────── KeeperExecutor ◀──────┘

 srcla serves GET /v1/* on :3100 (read-only) and operator POSTs on 127.0.0.1:3101
```

- **The contract is the guardrail.** `capBps`, `minIdleBps` and `maxLossBps` are enforced on-chain against the
  vault's own NAV, and the allocator can only move funds between owner-allowlisted adapters — never to an EOA.
- **The service holds the keeper key; its public API cannot move funds.** The public listener is GET-only and
  refuses to boot if a mutating route is registered. The three operator mutations live on a loopback-only listener.
- **Users sign and pay for their own deposits and redemptions.** There is no relayer and no sponsored gas.

### The algorithm, by paper section

One decision is `srcla/src/policy/decide.ts`, which runs the steps in `srcla/src/policy/steps/`:

```
admit → safetyUnwind → simulateCurves → forecastMarkets → optimize → requiredReserve → hurdles/brakes → buildPlan
```

| Section | Topic | Code |
| :--- | :--- | :--- |
| §7 | Return forecasting and calibration | `srcla/src/forecast/`, `policy/steps/forecast.ts` |
| §8.1 | Dynamic liquidity reserve | `policy/steps/reserve.ts` |
| §8.2 | Allocation enumeration | `policy/steps/optimize.ts` |
| §9.1 | Movement cost and hurdles | `policy/steps/cost.ts`, `policy/steps/hurdles.ts` |
| §9.2–§9.4 | Reward accounting and harvesting | `contract/src/reward/` |
| §10.2 | Authority boundary | `srcla/src/http/`, `srcla/src/index.ts` |
| §11 | Evaluation protocol — baselines B0–B5, ablations H1–H7, release gates | `srcla/src/evaluation/` |

Every tunable is an `SRCLA_*` environment variable, mapped to its paper section in `srcla/src/config.ts`.

---

## Prerequisites

- **Node.js** 20+ and **pnpm** 10+
- **[Foundry](https://getfoundry.sh/)** — `forge`, `cast`, `anvil`
- **Docker** — Postgres 16 for `srcla`
- *Optional:* Chrome or Chromium, to render the report figures as PNG

---

## Running locally

Each step depends on the one before it.

**1. Fork Base mainnet.** The fork inherits every real Base address — USDC, Compound Comet, the Aave Pool, Moonwell.

```bash
anvil --fork-url https://mainnet.base.org --code-size-limit 100000
```

**2. Deploy the vault.**

```bash
cd contract
forge build
forge script script/DeployNavyVaultSRCLA.s.sol --fork-url http://127.0.0.1:8545 --broadcast
```

Use `DeployAndFund.s.sol` instead for the four funded, per-tier vaults the evaluation's fork replay needs
([`contract/README.md`](contract/README.md)). **Copy the printed addresses into `srcla/.env.anvil` and
`srcla/.env`** — they change on every redeploy. Then do the required step in
[`contract/script/POST_DEPLOY.md`](contract/script/POST_DEPLOY.md).

**3. Start the database.**

```bash
cd srcla
docker compose up -d              # Postgres 16, database `srcla` on :5433
pnpm install
cp .env.example .env              # then fill in the deployed addresses
pnpm prisma:push
```

**4. Start the service.**

```bash
pnpm dev                          # GET /v1/* on :3100, the scheduler, and the keeper
```

To check the whole loop against the fork, `source .env.anvil && pnpm phase1:check` runs one real decision cycle
and attempts keeper execution of its plan.

---

## Reproducing the evaluation

```bash
cd srcla
DATABASE_URL=… pnpm backfill:history     # ~45 min, resumable: hourly Base venue state since 2024-03-15
DATABASE_URL=… pnpm phase4:freeze        # ~10 min: freezes config/registered-artifact.json
DATABASE_URL=… pnpm phase4:run           # 3–4 hours, silent: both sealed eras, the gates, report/
DATABASE_URL=… pnpm evaluation:verify ../evaluation-heldout-c.json
pnpm figures:render --png                # redraw report/figures/ from report/chart/ in seconds
```

`pnpm evaluation:run --era <era>` runs a single era. The data split is registered and enforced in
`srcla/src/evaluation/eras.ts`; only the calibration era may be fit on.

The on-chain fork replay also needs the Anvil fork, one vault per registered tier, and the
`SRCLA_FORK_REPLAY_*` variables — see [Running the experiment](CLAUDE.md#running-the-experiment). Without them it
reports `NOT PRODUCED` and the gate blocks.

---

## Testing

```bash
cd srcla    && pnpm test:unit        # unit suite
cd srcla    && pnpm test             # unit + integration (integration needs Postgres)
cd contract && forge test            # unit, fuzz/invariant and Base-fork tests
```

To run one srcla test file:

```bash
NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest --runInBand test/unit/evaluation/charts.spec.ts
```

`test/unit/evaluation/paper-amendments.spec.ts` checks the paper, which is not in this repository, so it fails in
a fresh clone.

---

## Security

- **Audit.** `NavyVaultSRCLA` and its adapters were audited:
  [`contract/audit/AUDIT-REPORT.md`](contract/audit/AUDIT-REPORT.md), the findings in
  [`contract/audit/2026-08-12-audit/`](contract/audit/2026-08-12-audit/), and the release evidence in
  [`contract/audit/RELEASE-EVIDENCE-2026-08-14.md`](contract/audit/RELEASE-EVIDENCE-2026-08-14.md). The Phase 2
  changes made since are listed in
  [`contract/audit/2026-09-07-phase2-changes.md`](contract/audit/2026-09-07-phase2-changes.md) and have **not**
  been re-audited.
- **Not production-ready.** Real funds require an independent audit, moving ownership to a multisig with a
  timelock, and KMS/HSM custody for the keeper key.

---

## Documentation

| Document | Contents |
| :--- | :--- |
| [`report/SRCLA-REPORT.md`](report/SRCLA-REPORT.md) | Registered evaluation results and disclosures |
| [`CLAUDE.md`](CLAUDE.md) | Architecture, the eras, the experiment, and the gotchas |
| [`contract/README.md`](contract/README.md) | Vault build, deploy and admin operations |
| [`contract/DEPLOYMENTS.md`](contract/DEPLOYMENTS.md) | Deployment package and the Base address table |
| [`contract/script/POST_DEPLOY.md`](contract/script/POST_DEPLOY.md) | The required post-deploy step |

The SRCLA paper (v0.10), the design specs and the production-gate register are maintained outside this
repository. Their versions up to 2026-09-13 remain in git history: `git show deae8408:docs/<path>`.

---

## History

This repository also held the Navy payment ecosystem — the `NavyPayments` gasless invoice contract, a NestJS
backend (`be/`), a Next.js merchant/admin web app (`fe/`) and an Expo mobile wallet (`expo-wallet/`). They were
removed on 2026-09-13 to leave only the algorithm, and survive in git history: `git show deae8408:<path>`.

---

## License

Private and proprietary. All rights reserved.
