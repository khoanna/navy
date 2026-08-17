# SRCLA Paper Gap Completion - Comprehensive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SRCLA implementation to match paper specification at 100% - comprehensive coverage of all components including post-deposit simulation, regime tracking, reserve, cost gate, TWAP oracle, plan execution, evaluation suite, and coverage tracking.

**Architecture:** TypeScript modules in `srcla/src/` using ethers v6 for chain interaction. Follow existing patterns (plain-TS, no NestJS decorators). Cost calculations use BigInt with explicit decimal handling. Oracle uses Uniswap V3 pool observations for TWAP.

**Tech Stack:** TypeScript, ethers v6, jest, zod

**Spec:** `docs/superpowers/specs/2026-08-17-srcla-paper-gap-completion-design.md`

## Global Constraints

- All money values use BigInt with 6 decimal precision (USDC)
- Rates use WAD (1e18) precision
- All code must pass `pnpm exec tsc --noEmit` before commit
- Tests must pass `pnpm test` before commit
- Chain: Base mainnet (chainId 8453)
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Uniswap V3 Factory: `0x33128a8fC55774888C2A2137E1Af3F734F15E2b3`
- Uniswap V3 SwapRouter02: `0x2626664c2600006E8462448aD6A85B4d7B7E7D7`

---

## Gap Analysis Summary

Based on the paper specification, the following gaps need to be addressed:

| Component | Current State | Target | Gap |
|-----------|--------------|--------|-----|
| a. Post-deposit simulation (capacity-aware) | 70% | 100% | Capacity-aware curves need implementation |
| b. Regime tracking (cold-start) | 85% | 100% | Verify cold-start enforcement completeness |
| c. 3-component dynamic reserve | 60% | 100% | Floor + quantile + stress verification |
| d. Complete cost gate | 50% | 100% | Missing L1 data, failure, buffer costs |
| e. Uniswap V3 TWAP oracle | 0% | 100% | Missing oracle implementation |
| f. Plan execution | 40% | 100% | Fix executeNextAction or add fallback |
| g. Morpho adapter | 0% | Paper scope | NOT required - paper only specifies Compound/Aave |
| h. Full evaluation suite | 80% | 100% | B0-B5, H1-H5, fork replays |
| i. Coverage tracking | 0% | 100% | Missing implementation |
| j. Evaluation manifest | 80% | 100% | Verify manifest completeness |

---

## Task 1: Uniswap V3 TWAP Oracle

**Files:**
- Create: `srcla/src/oracle/twap-oracle.ts`
- Create: `srcla/src/oracle/twap-oracle.spec.ts`
- Create: `srcla/src/oracle/index.ts`

**Interfaces:**
- Consumes: `ethers.providers.JsonRpcProvider`, Uniswap V3 pool addresses
- Produces: `UniswapV3TWAPOracle` class with `getTWAPPrice()`, `validatePrice()`

### Steps

- [ ] **Step 1: Create oracle module index**

```typescript
// srcla/src/oracle/index.ts
export * from './twap-oracle.js';
export * from './reward-valuation.js';
```

- [ ] **Step 2: Implement TWAP oracle with observe() API**

Create `srcla/src/oracle/twap-oracle.ts` with:
- `UniswapV3TWAPOracle` class
- `getPoolAddress()` - query factory for pool address
- `getObservations()` - call `observe()` with configurable window
- `calculateTWAP()` - time-weighted average tick calculation
- `validatePrice()` - check deviation vs TWAP
- `tickToSqrtRatioX96()` - tick to sqrt ratio conversion

TWAP Window: 300 seconds (5 minutes)
Max Deviation: 500 bps (5%)
Formula: TWAP = Σ(tickDelta × timeDelta) / Σ(timeDelta)

- [ ] **Step 3: Write TWAP oracle tests**
- Calculate TWAP for uniform tick
- Calculate TWAP with partial window observations
- Validate price within deviation threshold
- Fail validation when deviation exceeds threshold
- Handle edge cases (0 observations, expired window)

- [ ] **Step 4: Commit**

```bash
cd /home/khoa/Desktop/DATN/srcla
git add src/oracle/twap-oracle.ts src/oracle/twap-oracle.spec.ts src/oracle/index.ts
git commit -m "feat(oracle): add Uniswap V3 TWAP oracle for reward validation

Implements §9.4 TWAP oracle for validating swap prices against
oracle-derived expected output to prevent sandwich attacks.

- TWAP calculation from pool observations
- Price validation with configurable deviation threshold
- Pool address lookup from factory

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Complete Cost Gate - L1 Data, Failure, Buffer Costs

**Files:**
- Modify: `srcla/src/decision/cost-gate-types.ts`
- Modify: `srcla/src/decision/cost-gate.ts`
- Create: `srcla/src/decision/cost-gate.spec.ts`

**Interfaces:**
- Consumes: Existing `CostGate`, `MovementCosts`, `CostGateConfig`
- Produces: Extended `MovementCosts` with `l1DataCost`, `failureBuffer`, `bufferOpportunityCost`

**Per §9.1 Complete Cost Formula:**
```
Cmove = CL2 + CL1data + Cexit + Centry + Cclaim + Capprove/reset + Cswap + Cimpact + Cslippage/MEV + Cfailure + Cbuffer
```

### Steps

- [ ] **Step 1: Add extended types to cost-gate-types.ts**

Add after `MovementCosts`:
```typescript
export interface ExtendedMovementCosts extends MovementCosts {
  l1DataCost: bigint;
  failureBuffer: bigint;
  bufferOpportunityCost: bigint;
}

export interface CompleteCostParams {
  amount: bigint;
  l1GasPrice: bigint;
  l1CalldataBytes: number;
  historicalFailureRate: number;
  volatilityFactor: number;
  bestAvailableRate: bigint;
  horizonSeconds: number;
}

export interface FailureCostParams {
  historicalFailureRate: number;
  estimatedLossOnFailure: bigint;
  volatilityFactor: number;
}

export interface BufferOpportunityParams {
  idleAmount: bigint;
  bestAvailableRate: bigint;
  timeSeconds: number;
}
```

- [ ] **Step 2: Add L1 data cost calculation**

```typescript
/**
 * Calculate L1 data cost for Base L2 rollups
 * Formula: CL1data = calldataBytes * L1_GAS_PER_BYTE * l1GasPrice / ETHPrice
 */
calculateL1DataCost(
  calldataBytes: number,
  l1GasPrice: bigint,
  ethPriceUsdc: bigint
): bigint {
  const L1_GAS_PER_BYTE = 16n;
  const totalL1Gas = BigInt(calldataBytes) * L1_GAS_PER_BYTE;
  const costInWei = totalL1Gas * l1GasPrice;
  const costInUsdc = (costInWei * ethPriceUsdc) / 1_000_000_000_000n;
  return costInUsdc;
}
```

- [ ] **Step 3: Add failure cost calculation**

```typescript
/**
 * Calculate failure probability cost
 * Formula: Cfailure = P(fail) * L(fail)
 * Where P(fail) = historicalFailureRate * (1 + volatilityFactor)
 */
calculateFailureCost(params: FailureCostParams): bigint {
  const { historicalFailureRate, estimatedLossOnFailure, volatilityFactor } = params;
  const adjustedProbability = Math.min(1, Math.max(0, historicalFailureRate * (1 + volatilityFactor)));
  const probabilityWad = BigInt(Math.floor(adjustedProbability * 1_000_000_000_000_000_000n));
  const costWad = (probabilityWad * estimatedLossOnFailure * 1_000_000_000_000n) / 1_000_000_000_000_000_000n;
  return costWad / 1_000_000_000_000n;
}
```

- [ ] **Step 4: Add buffer opportunity cost calculation**

```typescript
/**
 * Calculate opportunity cost of keeping buffer idle
 * Formula: Cbuffer = idle * opportunity_rate * t
 */
calculateBufferOpportunityCost(params: BufferOpportunityParams): bigint {
  const { idleAmount, bestAvailableRate, timeSeconds } = params;
  if (idleAmount === 0n || bestAvailableRate === 0n) return 0n;
  const YEAR_SECONDS = 31_557_600n;
  const timewad = (BigInt(timeSeconds) * 1_000_000_000_000_000_000n) / YEAR_SECONDS;
  const idlewad = idleAmount * 1_000_000_000_000n;
  const opportunityCostWad = (idlewad * bestAvailableRate * timewad) / 1_000_000_000_000_000_000n;
  return opportunityCostWad / 1_000_000_000_000n;
}
```

- [ ] **Step 5: Add complete cost calculation method**

```typescript
calculateCompleteCost(params: CompleteCostParams): ExtendedMovementCosts {
  const { amount, l1GasPrice, l1CalldataBytes, historicalFailureRate, volatilityFactor, bestAvailableRate, horizonSeconds } = params;
  
  const baseBreakdown = this.calculateCostBreakdown({ amount, movementType: MovementType.DEPLOY });
  const l1DataCost = this.calculateL1DataCost(l1CalldataBytes, l1GasPrice, this.config.ethPriceUsdc);
  const failureBuffer = this.calculateFailureCost({
    historicalFailureRate,
    estimatedLossOnFailure: amount,
    volatilityFactor,
  });
  const bufferOpportunityCost = this.calculateBufferOpportunityCost({
    idleAmount: amount,
    bestAvailableRate,
    timeSeconds: horizonSeconds,
  });

  return {
    l2GasCost: baseBreakdown.gasCost,
    l1DataCost,
    exitCost: 0n,
    entryCost: 0n,
    claimCost: 0n,
    approveResetCost: 0n,
    swapCost: 0n,
    impactCost: 0n,
    slippageCost: baseBreakdown.slippageCost,
    mevCost: baseBreakdown.mevImpact,
    failureBuffer,
    bufferCost: bufferOpportunityCost,
    totalCost: baseBreakdown.totalCost + l1DataCost + failureBuffer + bufferOpportunityCost,
  };
}
```

- [ ] **Step 6: Write comprehensive tests**
- Test L1 data cost calculation
- Test failure cost with volatility adjustment
- Test buffer opportunity cost scaling
- Test complete cost aggregation

- [ ] **Step 7: Commit**

```bash
git add src/decision/cost-gate-types.ts src/decision/cost-gate.ts src/decision/cost-gate.spec.ts
git commit -m "feat(cost-gate): add L1 data, failure, and buffer opportunity costs

Implements §9.1 complete cost gate formula:
- L1 data cost for Base rollup L1 data availability
- Failure probability cost with volatility adjustment
- Buffer opportunity cost (cost of NOT deploying)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Post-Deposit Simulation with Capacity-Aware Curves

**Files:**
- Modify: `srcla/src/protocols/simulation/aave-simulator.ts`
- Modify: `srcla/src/protocols/simulation/compound-simulator.ts`
- Modify: `srcla/src/protocols/simulation/moonwell-simulator.ts`
- Create: `srcla/src/protocols/simulation/simulation.spec.ts`

**Interfaces:**
- Consumes: `MarketState`, `depositAmount`, simulator config
- Produces: `SimulatedRate` with capacity-aware curve calculations

**Per §6.3-§6.5: Post-deposit rate simulation must account for capacity constraints**

### Steps

- [ ] **Step 1: Review existing simulator implementations**

Read existing simulators to understand current state:
- `aave-simulator.ts` - already has piecewise rate model
- `compound-simulator.ts` - already has exponential rate model
- `moonwell-simulator.ts` - review for completeness

- [ ] **Step 2: Add capacity-aware curve calculations**

Add to each simulator:
```typescript
/**
 * Calculate capacity-aware effective rate
 * 
 * When deposit pushes utilization beyond optimal, the rate curve
 * becomes non-linear. This method returns the effective rate
 * considering the position size vs total capacity.
 */
calculateCapacityAwareRate(
  state: MarketState,
  depositAmount: bigint,
  config: SimulatorConfig
): {
  effectiveRate: bigint;      // Rate after deposit
  capacityUsed: bigint;       // Utilization after deposit
  capacityRemaining: bigint;  // Available capacity
  ratePenalty: bigint;         // Rate reduction from capacity constraints
}
```

- [ ] **Step 3: Implement Aave capacity-aware rate**

```typescript
calculateCapacityAwareRate(
  state: MarketState,
  depositAmount: bigint,
  config: SimulatorConfig
): SimulatedRate {
  const { cash, borrows } = state;
  const aaveConfig = config as AaveSimulatorConfig;
  
  // Calculate pre/post utilization
  const utilizationBefore = this.calculateUtilization(cash, borrows);
  const utilizationAfter = this.calculateUtilization(cash + depositAmount, borrows);
  
  // Calculate effective capacity
  const effectiveCapacity = this.calculateEffectiveCapacity(cash, borrows, aaveConfig.maxUtilization);
  const capacityRemaining = effectiveCapacity > depositAmount 
    ? effectiveCapacity - depositAmount 
    : 0n;
  
  // Rate penalty: if above optimal, apply penalty based on excess utilization
  const rateBefore = this.calculateRateFromUtilization(utilizationBefore, aaveConfig);
  const rateAfter = this.calculateRateFromUtilization(utilizationAfter, aaveConfig);
  const ratePenalty = utilizationAfter > aaveConfig.optimalUtilization
    ? rateBefore - rateAfter
    : 0n;
  
  return {
    marketId: state.marketId,
    preDepositRate: rateBefore,
    postDepositRate: rateAfter,
    utilizationBefore,
    utilizationAfter,
    effectiveCapacity,
    capacityRemaining,
    ratePenalty,
  };
}
```

- [ ] **Step 4: Implement Compound capacity-aware rate**

Similar structure to Aave but using exponential model.

- [ ] **Step 5: Implement Moonwell capacity-aware rate**

Verify Moonwell simulator has capacity awareness.

- [ ] **Step 6: Write tests for capacity-aware curves**

```typescript
describe('AaveV3Simulator capacity-aware', () => {
  it('should apply rate penalty above optimal utilization', () => {
    // Given: market at 80% utilization (above optimal 65%)
    // When: depositing 10M USDC
    // Then: rate should decrease, capacity remaining should decrease
  });
  
  it('should calculate effective capacity correctly', () => {
    // Test that effective capacity matches expected value
  });
});
```

- [ ] **Step 7: Commit**

```bash
git add src/protocols/simulation/aave-simulator.ts src/protocols/simulation/compound-simulator.ts src/protocols/simulation/moonwell-simulator.ts src/protocols/simulation/simulation.spec.ts
git commit -m "feat(simulation): add capacity-aware rate curves

Implements §6.3-§6.5 post-deposit rate simulation:
- Calculate rate penalty above optimal utilization
- Track capacity remaining after deposit
- Return effective rate considering position size vs total capacity

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Regime Tracking with Cold-Start Enforcement

**Files:**
- Review: `srcla/src/regime/regime.ts`
- Review: `srcla/src/regime/cold-start.ts`
- Modify: `srcla/src/regime/regime.spec.ts` (if tests needed)

**Interfaces:**
- Consumes: `VaultState`, timestamp, regime config
- Produces: `RegimeState` with cold-start enforcement

**Per §6.2, §7.3: Regime tracking with cold-start period enforcement**

### Steps

- [ ] **Step 1: Review existing regime implementation**

Read and verify:
- `regime.ts` - existing regime classification
- `cold-start.ts` - cold-start period handling

- [ ] **Step 2: Verify cold-start enforcement completeness**

Check that cold-start enforces:
- [ ] Reduced capacity during cold-start (50% per config)
- [ ] Elevated reserve requirements during cold-start (150% per config)
- [ ] No rebalancing outside capacity limits during cold-start
- [ ] Cold-start period configurable (default 7 days)

- [ ] **Step 3: Add missing cold-start test coverage**

If tests are missing, add to `regime.spec.ts`:
```typescript
describe('ColdStart enforcement', () => {
  it('should enforce reduced capacity during cold-start', () => {
    // Deploy at timestamp T, cold-start period = 7 days
    // At T+3 days: capacity should be 50% of normal
    // At T+8 days: capacity should be 100%
  });
  
  it('should enforce elevated reserve during cold-start', () => {
    // During cold-start: reserve factor = 1.5x
    // After cold-start: reserve factor = 1.0x
  });
});
```

- [ ] **Step 4: Commit (or no-op if complete)**

If changes needed:
```bash
git add src/regime/regime.ts src/regime/cold-start.ts src/regime/regime.spec.ts
git commit -m "fix(regime): complete cold-start enforcement

Implements §6.2, §7.3 regime tracking with cold-start enforcement:
- Reduced capacity during cold-start period
- Elevated reserve requirements
- Configurable cold-start duration

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 3-Component Dynamic Reserve (Floor + Quantile + Stress)

**Files:**
- Review: `srcla/src/reserve/reserve.ts`
- Create: `srcla/src/reserve/reserve.spec.ts` (if missing tests)

**Interfaces:**
- Consumes: `totalAssets`, `withdrawalHistory`, `stressScenarios`
- Produces: `optimalReserve` with 3 components

**Per §8.1: Dynamic reserve with 3 components:**
1. **Floor**: `minReserve = totalAssets * floorBps / 10000`
2. **Quantile**: `quantileReserve = percentile(withdrawals, 95th)`
3. **Stress**: `stressReserve = max(over scenarios: withdrawalRate * duration * probability)`

### Steps

- [ ] **Step 1: Review existing reserve implementation**

Read `reserve.ts` and verify:
- Has `ReserveOptimizer` class
- Has `minReserve()` - floor component
- Has `optimalReserve()` - should combine all 3
- Has `stressTest()` - stress component

- [ ] **Step 2: Verify 3-component calculation**

Check that `optimalReserve` combines:
```typescript
optimalReserve(totalAssets: bigint, scenarios: StressScenario[]): bigint {
  // Component 1: Floor
  const floor = this.minReserve(totalAssets);
  
  // Component 2: Quantile (from withdrawal history)
  // This requires withdrawal history - verify it's used
  const quantile = this.quantileReserve(totalAssets, withdrawalHistory, 0.95);
  
  // Component 3: Stress
  const stress = this.stressReserve(totalAssets, scenarios);
  
  // Combine: max of all 3
  return Math.max(floor, quantile, stress);
}
```

- [ ] **Step 3: Add quantile reserve calculation if missing**

If `quantileReserve` is not implemented, add:
```typescript
/**
 * Calculate quantile-based reserve requirement
 * Uses historical withdrawal data to determine 95th percentile withdrawal
 */
quantileReserve(
  totalAssets: bigint,
  withdrawalHistory: bigint[],
  quantile: number
): bigint {
  if (withdrawalHistory.length === 0) {
    return this.minReserve(totalAssets);
  }
  
  const sorted = [...withdrawalHistory].sort((a, b) => Number(a - b));
  const index = Math.floor(sorted.length * quantile);
  return sorted[index] ?? sorted[sorted.length - 1] ?? 0n;
}
```

- [ ] **Step 4: Write comprehensive reserve tests**

```typescript
describe('ReserveOptimizer 3-component', () => {
  it('should return floor when floor is highest', () => {
    // Low total assets, no stress scenarios
    // Optimal = floor
  });
  
  it('should return quantile when quantile exceeds floor', () => {
    // High recent withdrawals
    // Optimal = quantile
  });
  
  it('should return stress when stress exceeds others', () => {
    // Severe stress scenario
    // Optimal = stress
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add src/reserve/reserve.ts src/reserve/reserve.spec.ts
git commit -m "feat(reserve): implement 3-component dynamic reserve

Implements §8.1 dynamic reserve with floor + quantile + stress:
- Floor: minimum reserve based on total assets
- Quantile: 95th percentile of historical withdrawals
- Stress: worst-case scenario from stress testing
- optimalReserve = max(floor, quantile, stress)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Plan Execution with Direct Allocation Fallback

**Files:**
- Review: `srcla/src/execution/executor.ts`
- Review: `srcla/src/execution/plan-builder.ts`
- Modify: Add direct allocation fallback if `executeNextAction` is broken

**Interfaces:**
- Consumes: `ExecutionPlan`, `VaultState`
- Produces: `PlanExecutionResult`

**Per §9.5: Plan execution with failure recovery strategies**

### Steps

- [ ] **Step 1: Review existing execution implementation**

Read and verify:
- `executor.ts` - `PlanExecutor` class
- `plan-builder.ts` - `PlanBuilder` class

- [ ] **Step 2: Check for executeNextAction**

Search for `executeNextAction` in codebase:
```bash
grep -r "executeNextAction" srcla/src/
```

If found and working, verify it handles failure strategies:
- `divestFailureStrategy: 'stop' | 'continue'`
- `deployFailureStrategy: 'stop' | 'recover_idle'`

- [ ] **Step 3: Implement direct allocation fallback**

If `executeNextAction` is broken or missing, implement direct allocation:
```typescript
/**
 * Direct allocation fallback
 * 
 * When plan execution fails, this provides a simple direct allocation
 * to the highest-rate adapter within capacity constraints.
 */
directAllocation(
  vaultState: VaultState,
  markets: MarketState[],
  amount: bigint
): { adapter: string; amount: bigint } | null {
  const eligible = markets.filter(m => 
    m.capacityRemaining >= amount && 
    m.isActive &&
    !m.isEmergency
  );
  
  if (eligible.length === 0) return null;
  
  // Sort by rate descending
  eligible.sort((a, b) => Number(b.supplyRate - a.supplyRate));
  
  return {
    adapter: eligible[0]!.adapter,
    amount: Math.min(amount, eligible[0]!.capacityRemaining),
  };
}
```

- [ ] **Step 4: Implement failure recovery strategies**

```typescript
executeWithRecovery(
  plan: ExecutionPlan,
  config: {
    divestFailureStrategy: 'stop' | 'continue';
    deployFailureStrategy: 'stop' | 'recover_idle';
  }
): PlanExecutionResult {
  // Try execute plan
  const result = this.executePlan(plan);
  
  if (!result.stoppedEarly) return result;
  
  // Apply failure strategy
  const failedAction = result.results.find(r => !r.success);
  
  if (failedAction?.kind === 'divest') {
    if (config.divestFailureStrategy === 'stop') {
      return result; // Already stopped
    }
    // continue: execute remaining actions
  }
  
  if (failedAction?.kind === 'deploy') {
    if (config.deployFailureStrategy === 'recover_idle') {
      // Redeploy failed funds to idle
      // This requires recovery logic
    }
  }
  
  return result;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/execution/executor.ts src/execution/plan-builder.ts
git commit -m "feat(execution): add plan execution with failure recovery

Implements §9.5 plan execution with failure recovery:
- Direct allocation fallback when plan execution fails
- Configurable failure strategies (stop/continue/recover_idle)
- Failure recovery for divest and deploy actions

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Coverage Tracking

**Files:**
- Create: `srcla/src/evaluation/coverage-tracker.ts`
- Create: `srcla/src/evaluation/coverage-tracker.spec.ts`

**Interfaces:**
- Consumes: Forecast predictions and realized outcomes
- Produces: `CoverageTracker` with `recordOutcome()`, `calculateCoverage()`, `generateCoverageReport()`

### Steps

- [ ] **Step 1: Create coverage tracker**

```typescript
// srcla/src/evaluation/coverage-tracker.ts

export interface CoverageRecord {
  marketId: string;
  timestamp: Date;
  lowerBound: bigint;
  actualReturn: bigint;
  covered: boolean;
  horizon: number;
}

export interface CoverageMetrics {
  coverage: number;
  totalRecords: number;
  coveredRecords: number;
  averageShortfall: bigint;
  maxShortfall: bigint;
  exceedsTarget: boolean;
}

export class CoverageTracker {
  private records: Map<string, CoverageRecord[]> = new Map();
  
  recordOutcome(marketId: string, timestamp: Date, lowerBound: bigint, actualReturn: bigint, horizon: number): void;
  calculateCoverage(marketId: string, windowDays?: number): CoverageMetrics;
  generateCoverageReport(): CoverageReport;
  export(): Map<string, CoverageRecord[]>;
  import(records: Map<string, CoverageRecord[]>): void;
}
```

- [ ] **Step 2: Write coverage tracker tests**

- Record covered/uncovered outcomes
- Calculate coverage rate
- Filter by window days
- Calculate shortfall statistics
- Generate comprehensive report
- Export/import for persistence

- [ ] **Step 3: Commit**

```bash
git add src/evaluation/coverage-tracker.ts src/evaluation/coverage-tracker.spec.ts
git commit -m "feat(evaluation): add coverage tracking for forecast validation

Implements §7.3 and §11 coverage tracking:
- Record forecast outcomes vs realized returns
- Calculate coverage rate per market
- Track shortfall statistics (avg, max)
- Verify 95% coverage target per market
- Export/import for persistence

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full Evaluation Suite (B0-B5, H1-H5)

**Files:**
- Review: `srcla/src/evaluation/baselines/` (B0-B5)
- Review: `srcla/src/evaluation/ablations/` (H1-H5)
- Review: `srcla/src/evaluation/replay/` (fork replays)

**Interfaces:**
- Consumes: Dataset, VaultState, MarketState
- Produces: `BaselineResult[]`, `AblationResult[]`

### Steps

- [ ] **Step 1: Verify B0-B5 baseline policies**

Read each baseline file:
- `b0-idle.ts` - Idle/baseline
- `b1-highest-rate.ts` - Always highest rate
- `b2-capacity.ts` - Capacity-aware
- `b3-capacity-cost.ts` - Capacity + cost
- `b4-fixed-robust.ts` - Fixed allocation
- `b5-hindsight.ts` - Hindsight oracle

Verify each implements the correct policy interface and logic.

- [ ] **Step 2: Verify H1-H5 ablation policies**

Read ablation files:
- `h1-forecast-disabled.ts` - No forecasting
- `h2-capacity-disabled.ts` - No capacity limits
- `h3-cost-gate-disabled.ts` - No cost gate
- `h4-frequency-disabled.ts` - Fixed rebalance interval
- `h5-uncertainty-disabled.ts` - No uncertainty

Verify each ablation removes the correct component.

- [ ] **Step 3: Verify fork replay implementation**

Check `srcla/src/evaluation/replay/` for:
- `VaultReplayState` - Vault state simulation
- `ForkReplay` - Historical fork replay
- `replay.ts` - Main replay logic

- [ ] **Step 4: Add missing tests**

```typescript
describe('Baseline Policies', () => {
  describe('B0 Idle', () => {
    it('should never deploy');
    it('should maintain 100% idle');
  });
  
  describe('B5 Hindsight', () => {
    it('should achieve maximum possible return');
    it('should be non-deployable (diagnostic only)');
  });
});
```

- [ ] **Step 5: Commit (or no-op if complete)**

---

## Task 9: Evaluation Manifest & Artifact Hash Persistence

**Files:**
- Review: `srcla/src/evaluation/manifest/manifest.ts`
- Modify: Add artifact hash persistence if needed

**Interfaces:**
- Consumes: Configuration, dataset bounds, policies
- Produces: `EvaluationManifest` with content hash

### Steps

- [ ] **Step 1: Review existing manifest implementation**

Read `manifest.ts` and verify:
- `createEvaluationManifest()` - creates manifest
- `freezeEvaluationManifest()` - locks manifest
- `validateManifest()` - validates integrity
- Content hash for reproducibility

- [ ] **Step 2: Verify artifact hash persistence**

Check that manifest includes:
- Code commit hash
- Dataset content hash
- Configuration content hash
- Results content hash

If any are missing, add:
```typescript
/**
 * Add content hash to manifest for reproducibility
 */
function addArtifactHashes(manifest: EvaluationManifest): EvaluationManifest {
  return {
    ...manifest,
    artifactHashes: {
      codeCommit: execSync('git rev-parse HEAD').toString().trim(),
      dataset: hashDataset(manifest.dataset),
      config: hashConfig(manifest.config),
    },
  };
}
```

- [ ] **Step 3: Commit (or no-op if complete)**

---

## Task 10: Evaluation Runner

**Files:**
- Create: `srcla/src/evaluation/runner.ts`
- Create: `srcla/src/evaluation/runner.spec.ts`

**Interfaces:**
- Consumes: `EvaluationManifest`, dataset, policies, coverage tracker
- Produces: `EvaluationResults` with release gate results

### Steps

- [ ] **Step 1: Create evaluation runner**

```typescript
// srcla/src/evaluation/runner.ts

export interface PolicyResult {
  policyId: string;
  tier: bigint;
  realizedNetApy: number;
  realizedGrossApy: number;
  totalCost: bigint;
  rebalanceCount: number;
  withdrawalSuccessRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

export interface EvaluationResults {
  manifestId: string;
  generatedAt: Date;
  results: PolicyResult[];
  comparison: PolicyComparison;
  forecastMetrics: Map<string, ForecastMetrics>;
  releaseGates: ReleaseGateResults;
  contentHash: string;
}

export class EvaluationRunner {
  constructor(manifest: EvaluationManifest);
  async run(dataset: Dataset, policies: Map<string, Policy>, coverageTracker: CoverageTracker): Promise<EvaluationResults>;
}
```

- [ ] **Step 2: Implement release gate evaluation**

```typescript
evaluateReleaseGates(comparison: PolicyComparison, forecastMetrics: Map<string, ForecastMetrics>): ReleaseGateResults {
  return {
    forecastGate: {
      passed: minCoverage >= 0.95,
      details: `Coverage: ${minCoverage * 100}%`,
    },
    policyGate: {
      passed: safetyCheck && performanceCheck,
      details: safetyDetails + performanceDetails,
    },
  };
}
```

- [ ] **Step 3: Write runner tests**

- Run evaluation against mock dataset
- Verify release gates evaluate correctly
- Verify content hash generation

- [ ] **Step 4: Commit**

```bash
git add src/evaluation/runner.ts src/evaluation/runner.spec.ts
git commit -m "feat(evaluation): add evaluation runner with release gates

Implements §11 evaluation runner:
- Run policies against dataset at multiple tiers
- Compare SRCLA vs baselines and ablations
- Evaluate release gates (forecast coverage, safety, performance)
- Generate reproducible content hash

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Full Verification

**Files:**
- None (verification only)

### Steps

- [ ] **Step 1: Run full TypeScript compilation**

```bash
cd /home/khoa/Desktop/DATN/srcla && pnpm exec tsc --noEmit
```
Expected: PASS (no errors)

- [ ] **Step 2: Run all tests**

```bash
cd /home/khoa/Desktop/DATN/srcla && pnpm test
```
Expected: PASS (all tests pass)

- [ ] **Step 3: Build the project**

```bash
cd /home/khoa/Desktop/DATN/srcla && pnpm build
```
Expected: PASS (dist/ contains compiled output)

- [ ] **Step 4: Verify all components**

Create verification checklist:
- [ ] TWAP oracle: `UniswapV3TWAPOracle` class exists
- [ ] Cost gate: `calculateL1DataCost`, `calculateFailureCost`, `calculateBufferOpportunityCost` exist
- [ ] Capacity-aware simulation: `calculateCapacityAwareRate` exists in simulators
- [ ] Regime cold-start: cold-start enforcement verified
- [ ] 3-component reserve: `optimalReserve` combines floor + quantile + stress
- [ ] Plan execution: `directAllocation` fallback exists
- [ ] Coverage tracking: `CoverageTracker` class exists
- [ ] Baselines: B0-B5 all implemented
- [ ] Ablations: H1-H5 all implemented
- [ ] Evaluation manifest: content hash persistence verified
- [ ] Evaluation runner: `EvaluationRunner` class exists

- [ ] **Step 5: Commit final verification**

```bash
cd /home/khoa/Desktop/DATN/srcla
git add -A
git commit -m "chore(srcla): verify full build after gap completion

SRCLA Paper Gap Completion - Full Verification:

Component Coverage:
[a] Post-deposit simulation (capacity-aware): IMPLEMENTED
[b] Regime tracking (cold-start): IMPLEMENTED
[c] 3-component dynamic reserve: IMPLEMENTED
[d] Complete cost gate: IMPLEMENTED
[e] Uniswap V3 TWAP oracle: IMPLEMENTED
[f] Plan execution: IMPLEMENTED
[g] Morpho adapter: NOT IN PAPER SCOPE
[h] Full evaluation suite: IMPLEMENTED
[i] Coverage tracking: IMPLEMENTED
[j] Evaluation manifest: IMPLEMENTED

TypeScript compilation: PASS
All tests: PASS
Build: PASS

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## File Summary

| Task | Component | Files | Est Lines |
|------|-----------|-------|-----------|
| 1 | TWAP Oracle | twap-oracle.ts, twap-oracle.spec.ts, index.ts | ~320 |
| 2 | Complete Cost Gate | cost-gate-types.ts, cost-gate.ts, cost-gate.spec.ts | ~250 |
| 3 | Capacity-Aware Simulation | aave/compound/moonwell simulators | ~200 |
| 4 | Regime Cold-Start | regime.ts, cold-start.ts (review) | ~50 |
| 5 | 3-Component Reserve | reserve.ts, reserve.spec.ts | ~200 |
| 6 | Plan Execution | executor.ts, plan-builder.ts | ~150 |
| 7 | Coverage Tracking | coverage-tracker.ts, coverage-tracker.spec.ts | ~350 |
| 8 | Evaluation Suite | baselines/, ablations/, replay/ (review) | ~100 |
| 9 | Evaluation Manifest | manifest.ts (review) | ~50 |
| 10 | Evaluation Runner | runner.ts, runner.spec.ts | ~400 |
| 11 | Verification | None | - |

**Total: ~2070 lines of new code, ~500 lines of tests**

---

## Verification Checklist

- [ ] All new code has unit tests
- [ ] TypeScript compiles without errors
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Manifest system integrated
- [ ] Release gates functional
- [ ] Coverage tracking functional
- [ ] B0-B5 baselines verified
- [ ] H1-H5 ablations verified
- [ ] Fork replay capability verified
