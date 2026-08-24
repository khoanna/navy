# SRCLA Implementation Plan

## Context

The SRCLA codebase has a comprehensive algorithm implementation but is missing the **data persistence layer**, **orchestration**, and **end-to-end integration** needed to run in production. This plan implements all missing components to complete the production simulation pipeline.

---

## Phase 1: Database Layer (Critical)

### 1.1 Prisma Client Singleton
**File:** `src/db/client.ts`

```typescript
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prisma;
}

export async function closePrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined as any;
  }
}
```

### 1.2 Repository Pattern
**Files:** `src/db/repositories/*.ts`

Create typed repository classes for each model:
- `withdrawal-repository.ts` - CRUD for WithdrawalEvent
- `snapshot-repository.ts` - CRUD for MarketSnapshot
- `decision-repository.ts` - CRUD for Decision + ExecutionPlan
- `evaluation-repository.ts` - CRUD for EvaluationRun

### 1.3 Prisma Generation
Add to `package.json` scripts:
```json
"prisma:generate": "prisma generate",
"prisma:push": "prisma db push",
```

---

## Phase 2: Collector Orchestrator (High)

### 2.1 Collector Orchestrator
**File:** `src/collector/orchestrator.ts`

```typescript
export class CollectorOrchestrator {
  constructor(
    private snapshotCollector: SnapshotCollector,
    private withdrawalTracker: WithdrawalTracker,
    private prisma: PrismaClient
  ) {}

  async runCollectionCycle(): Promise<void> {
    // 1. Collect vault + strategy snapshots
    const snapshot = await this.snapshotCollector.collect();
    await this.saveSnapshot(snapshot);

    // 2. Collect withdrawal events since last block
    const lastBlock = await this.withdrawalTracker.getLastProcessedBlock();
    await this.withdrawalTracker.collectSince(lastBlock);
  }
}
```

### 2.2 Scheduled Collector Script
**File:** `scripts/collect-scheduled.ts`

- Uses node-cron or setInterval
- Configurable cadence (default: 15 minutes)
- Error handling with exponential backoff
- Health check endpoint

---

## Phase 3: Evaluation Pipeline (High)

### 3.1 Evaluation Runner Integration
**File:** `src/evaluation/runner/integration.ts`

```typescript
export async function runEvaluation(config: EvaluationConfig): Promise<EvaluationResult> {
  // 1. Load historical data from database
  // 2. Run manifest generator
  // 3. Execute baseline policies (B0-B5)
  // 4. Execute ablation studies (H1-H5)
  // 5. Compute SRCLA policy
  // 6. Calculate metrics
  // 7. Evaluate release gates
  // 8. Save results to database
  // 9. Return summary
}
```

### 3.2 Evaluation Script
**File:** `scripts/run-evaluation-full.ts`

CLI entry point with options:
- `--start <date>` - Start date
- `--end <date>` - End date
- `--markets <ids>` - Market IDs
- `--tiers <amounts>` - Tier amounts
- `--output <path>` - Output file

---

## Phase 4: Regime Persistence (Medium)

### 4.1 Regime Repository
**File:** `src/regime/repository.ts`

```typescript
export class RegimeRepository {
  async saveTransition(transition: RegimeTransition): Promise<void> {
    // Persist to ContractRegime table
  }

  async loadRegime(marketId: string): Promise<RegimeConfig | null> {
    // Load from database
  }

  async loadHistory(marketId: string, days: number): Promise<RegimeMetrics[]> {
    // Load from MarketSnapshot
  }
}
```

### 4.2 Regime-Aligned Collector
Integrate regime tracking into collector orchestrator:
- Update regime tracker with each new snapshot
- Emit alerts on regime transitions
- Persist regime state changes

---

## Phase 5: Integration Tests (Medium)

### 5.1 Test Suite Structure
**Directory:** `test/integration/`

- `collector.test.ts` - Snapshot collection end-to-end
- `evaluation.test.ts` - Full evaluation pipeline
- `regime.test.ts` - Regime detection and transitions
- `reconciler.test.ts` - Execution reconciliation

### 5.2 Mock Fixtures
**Directory:** `test/fixtures/`

- Mock chain client
- Mock vault state
- Synthetic market data generators

---

## Phase 6: CLI & Developer UX (Low)

### 6.1 CLI Commands
**File:** `src/cli/index.ts`

```bash
srcla collect        # Run one collection cycle
srcla evaluate      # Run full evaluation
srcla regime        # Show regime status
srcla health        # Check system health
srcla export        # Export data for analysis
```

### 6.2 Health Check
**File:** `src/cli/health.ts`

- Check database connectivity
- Check chain connectivity
- Check last collection timestamp
- Check regime status

---

## Implementation Order

1. **Prisma Client + Repositories** - Foundation for all other components
2. **Collector Orchestrator** - Enables data collection
3. **Evaluation Integration** - Core use case
4. **Regime Persistence** - Operational monitoring
5. **Integration Tests** - Validation
6. **CLI** - Developer experience

---

## Files to Create/Modify

### New Files (Priority Order)
1. `src/db/client.ts` - Prisma singleton
2. `src/db/repositories/withdrawal-repository.ts`
3. `src/db/repositories/snapshot-repository.ts`
4. `src/db/repositories/decision-repository.ts`
5. `src/collector/orchestrator.ts`
6. `scripts/collect-scheduled.ts`
7. `src/evaluation/runner/integration.ts`
8. `scripts/run-evaluation-full.ts`
9. `src/regime/repository.ts`
10. `test/integration/collector.test.ts`
11. `test/integration/evaluation.test.ts`
12. `src/cli/index.ts`

### Modified Files
1. `package.json` - Add scripts
2. `tsconfig.json` - Path aliases for `src/db/*`
3. `.env.example` - Add DATABASE_URL
4. `src/config.ts` - Add database config

---

## Verification

### Unit Tests
```bash
pnpm test:unit
```

### Integration Tests
```bash
pnpm test:integration
```

### Full Evaluation
```bash
pnpm evaluation:run
```

### Manual Verification
```bash
# Start Anvil fork
anvil --fork-url https://mainnet.base.org

# Run collection
pnpm collect

# Run evaluation
pnpm evaluation:run

# Check results
cat dist/evaluation-results.json
```

---

## Dependencies

All required packages are already in `package.json`:
- `@prisma/client` - Database ORM
- `prisma` - Prisma CLI
- `ethers` - Chain interaction
- `zod` - Schema validation
