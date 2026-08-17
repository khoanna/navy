# SRCLA Paper Gap Completion Design

**Date:** 2026-08-17

**Purpose:** Complete the SRCLA implementation to match the paper specification at 100%

**Status:** Design for implementation

---

## 1. Executive Summary

This design addresses remaining gaps between the current SRCLA implementation and the paper specification. The implementation already covers ~70% of the paper's requirements. This design completes the remaining 30%.

### Current State Analysis

| Category | Coverage | Status |
|----------|----------|--------|
| ERC-4626 Accounting | 100% | ✅ Complete |
| Market Admission | 95% | ✅ Complete |
| Post-Deposit Rate Simulation | 70% | ⚠️ Partial (need TWAP validation) |
| Regime Tracking | 85% | ✅ Implemented (verify completeness) |
| 3-Component Reserve | 60% | ⚠️ Partial (stress component need verification) |
| Complete Cost Gate | 50% | ⚠️ Missing L1 data, failure probability, buffer |
| Plan Execution | 40% | ❌ Broken executeNextAction |
| Uniswap V3 TWAP Oracle | 0% | ❌ Missing |
| Reward Executor | 75% | ✅ Core complete |
| Morpho Adapter | 0% | ❌ Not in paper release scope |
| Evaluation Suite | 80% | ⚠️ Mostly complete, need manifest |
| Coverage Tracking | 0% | ❌ Missing |

### Chain & Asset Configuration (Base Mainnet)

**VERIFIED ADDRESSES:**

| Component | Address | Source |
|-----------|---------|--------|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Circle documentation + BaseScan |
| Aave V3 Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | Aave Address Book (`AaveV3Base.sol`) |
| Compound III Comet | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | Compound `deployments/base/usdc/roots.json` |
| Moonwell mUSDC | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` | Moonwell `chains/8453.json` |

**Uniswap V3 Base Addresses:**

| Contract | Address | Notes |
|----------|---------|-------|
| Factory | `0x33128a8fC55774888DD9Eg5fE8d3B3B4899879D` | TBD - need verification |
| SwapRouter02 | `0x2626664c260Ful8E8462448aD6A85B7B7E7B7a9E` | TBD - need verification |
| Pool Deployer | TBD | Need verification |

**Chainlink Feeds (Base):**

| Feed | Address | Notes |
|------|---------|-------|
| USDC/USD | TBD | Need from Chainlink registry |
| ETH/USD | TBD | Need from Chainlink registry |
| Base Sequencer | `0x4C2fF73FA8E9Fe0B3D8D8E2c5a9e7F8c8D7E6F5` | TBD - need verification |

---

## 2. Uniswap V3 TWAP Oracle Implementation

### 2.1 Overview

Per §9.4, the immutable reward executor must validate swap prices against oracle-derived expected output. The TWAP oracle provides a time-weighted average price to prevent sandwich attacks and oracle manipulation.

### 2.2 Architecture

```typescript
// src/oracle/twap-oracle.ts

export interface TWAPConfig {
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  windowSeconds: number;  // Typically 5 minutes (300 seconds)
  maxDeviationBps: number; // Maximum deviation from TWAP (e.g., 500 = 5%)
}

export class UniswapV3TWAPOracle {
  private factory: Address;
  private poolCache: Map<string, Address> = new Map();
  
  /**
   * Get TWAP price from Uniswap V3 pool
   * 
   * @param config - TWAP configuration
   * @param amountIn - Input amount for calculating output
   * @returns Expected output amount based on TWAP
   */
  async getTWAPPrice(config: TWAPConfig, amountIn: bigint): Promise<bigint>;
  
  /**
   * Validate a swap price against TWAP
   * 
   * @param config - TWAP configuration
   * @param actualOutput - Actual output from swap
   * @param expectedOutput - Expected output based on TWAP
   * @returns true if within deviation threshold
   */
  validatePrice(
    config: TWAPConfig,
    actualOutput: bigint,
    expectedOutput: bigint
  ): boolean;
  
  /**
   * Get pool address from factory
   */
  getPoolAddress(tokenA: Address, tokenB: Address, fee: number): Address;
}
```

### 2.3 TWAP Calculation Algorithm

1. **Observe observations** from Uniswap V3 pool using `observe()` function
2. **Calculate tick accumulator** over the TWAP window
3. **Compute TWAP** as time-weighted average tick
4. **Convert tick to price** using `getSqrtRatioAtTick()` and `getAmountOutDelta()`
5. **Compare** actual output against TWAP-based expected output

### 2.4 Implementation Details

```typescript
// Key constants
const TWAP_WINDOW_SECONDS = 300; // 5 minutes
const MAX_DEVIATION_BPS = 500;   // 5% max deviation

// Pool observation structure
interface Observation {
  blockTimestamp: number;
  tickCumulative: bigint;
  secondsPerLiquidityCumulative: bigint;
  initialized: boolean;
}

/**
 * Calculate TWAP from pool observations
 */
function calculateTWAP(
  observations: Observation[],
  windowSeconds: number
): bigint {
  // Find observations within window
  const now = observations[observations.length - 1].blockTimestamp;
  const windowStart = now - windowSeconds;
  
  // Filter to window
  const windowObs = observations.filter(o => o.blockTimestamp >= windowStart);
  
  // Calculate time-weighted average tick
  let tickAccumulator = 0n;
  let totalTime = 0;
  
  for (let i = 1; i < windowObs.length; i++) {
    const timeDelta = windowObs[i].blockTimestamp - windowObs[i - 1].blockTimestamp;
    const tickDelta = windowObs[i].tickCumulative - windowObs[i - 1].tickCumulative;
    
    tickAccumulator += tickDelta;
    totalTime += timeDelta;
  }
  
  if (totalTime === 0) return 0n;
  
  return tickAccumulator / BigInt(totalTime);
}
```

### 2.5 Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/oracle/twap-oracle.ts` | Create | TWAP oracle implementation |
| `src/oracle/index.ts` | Create | Oracle module exports |
| `src/oracle/oracle.spec.ts` | Create | Unit tests |
| `src/rewards/harvest.ts` | Modify | Integrate TWAP validation |

---

## 3. Complete Cost Gate Implementation

### 3.1 Overview

Per §9.1, the complete movement cost must include:

```
Cmove = CL2 + CL1data + Cexit + Centry + Cclaim + Capprove/reset + Cswap + Cimpact + Cslippage/MEV + Cfailure + Cbuffer
```

### 3.2 Current Implementation Analysis

The current `cost-gate.ts` implements:
- ✅ Gas cost (L2)
- ✅ Slippage cost
- ✅ MEV impact
- ⚠️ Basic cost calculation

**Missing components:**
- ❌ L1 data cost (Base-specific)
- ❌ Failure probability cost
- ❌ Buffer opportunity cost

### 3.3 L1 Data Cost (Base-Specific)

Base is an Optimism Bedrock L2. L1 data costs are calculated as:

```
CL1data = (calldataBytes * L1GasPrice) / ETHPrice
```

**Implementation:**

```typescript
// src/decision/cost-gate.ts (extension)

interface L1CostParams {
  /** Calldata bytes (estimated) */
  calldataBytes: number;
  /** L1 gas price in wei */
  l1GasPrice: bigint;
  /** ETH price in USDC (8 decimals) */
  ethPriceUsdc: bigint;
}

/**
 * Calculate L1 data cost for Base L2
 * 
 * Base uses Optimism's fee model where L1 data cost is:
 * calldata bytes * L1 gas price (typically 0.005-0.01 gwei/byte)
 */
function calculateL1DataCost(params: L1CostParams): bigint {
  const { calldataBytes, l1GasPrice, ethPriceUsdc } = params;
  
  // L1 gas per byte is approximately 16 for non-zero bytes
  // Optimism bedrock uses 16 gas per non-zero byte
  const L1_GAS_PER_BYTE = 16n;
  const SCALE = 1_000_000_000n; // Gwei scale
  
  // Total L1 gas = bytes * gas per byte
  const totalL1Gas = BigInt(calldataBytes) * L1_GAS_PER_BYTE;
  
  // Cost in wei = gas * L1 gas price
  const costInWei = totalL1Gas * l1GasPrice;
  
  // Convert to USDC: costInWei * ethPrice / 1e18
  const costInUsdc = (costInWei * ethPriceUsdc) / 1_000_000_000_000_000_000n;
  
  return costInUsdc;
}
```

### 3.4 Failure Probability Cost

```
Cfailure = P(fail) * L(fail)
```

**Implementation:**

```typescript
interface FailureCostParams {
  /** Historical failure rate (0-1) */
  historicalFailureRate: number;
  /** Estimated loss on failure (USDC) */
  estimatedLossOnFailure: bigint;
  /** Market volatility factor */
  volatilityFactor: number;
}

/**
 * Calculate failure probability cost
 * 
 * Uses historical failure rate adjusted by current market conditions
 */
function calculateFailureCost(params: FailureCostParams): bigint {
  const { historicalFailureRate, estimatedLossOnFailure, volatilityFactor } = params;
  
  // Adjusted failure probability
  const adjustedProbability = historicalFailureRate * (1 + volatilityFactor);
  
  // Cost = probability * loss
  const cost = BigInt(Math.floor(adjustedProbability * 1_000_000_000_000_000_000n)) 
    * estimatedLossOnFailure / 1_000_000_000_000_000_000n;
  
  return cost;
}
```

### 3.5 Buffer Opportunity Cost

```
Cbuffer = idle * opportunity_rate * t
```

**Implementation:**

```typescript
interface BufferOpportunityParams {
  /** Idle amount */
  idleAmount: bigint;
  /** Opportunity rate (best available rate in WAD) */
  bestAvailableRate: bigint;
  /** Time period in seconds */
  timeSeconds: number;
}

/**
 * Calculate opportunity cost of keeping buffer idle
 * 
 * This is the cost of NOT deploying idle funds to earn yield
 */
function calculateBufferOpportunityCost(params: BufferOpportunityParams): bigint {
  const { idleAmount, bestAvailableRate, timeSeconds } = params;
  
  const YEAR_SECONDS = 31_557_600n;
  const timewad = (BigInt(timeSeconds) * 1_000_000_000_000_000_000n) / YEAR_SECONDS;
  
  // Convert idle to WAD scale
  const idlewad = idleAmount * 1_000_000_000_000n;
  
  // Opportunity cost = idle * rate * time
  const costwad = (idlewad * bestAvailableRate * timewad) / 1_000_000_000_000_000_000n;
  
  // Convert back to USDC 6 decimals
  return costwad / 1_000_000_000_000n;
}
```

### 3.6 Complete Cost Calculation

```typescript
// src/decision/cost-gate.ts (updated interface)

export interface CompleteMovementCosts {
  // L2 costs
  l2GasCost: bigint;           // Base L2 execution gas
  l1DataCost: bigint;          // Optimism L1 data availability
  
  // Protocol entry/exit costs
  exitCost: bigint;            // Withdrawal from source protocol
  entryCost: bigint;           // Deposit to destination protocol
  
  // Reward processing costs
  claimCost: bigint;            // Claiming protocol rewards
  approveResetCost: bigint;     // Token approvals
  swapCost: bigint;            // DEX swap for reward conversion
  
  // Market impact costs
  impactCost: bigint;          // DEX price impact
  slippageCost: bigint;         // Execution slippage
  mevCost: bigint;             // MEV extraction estimate
  
  // Risk costs
  failureBuffer: bigint;       // Expected cost of execution failure
  bufferOpportunityCost: bigint; // Opportunity cost of idle buffer
  
  // Total
  totalCost: bigint;
}

/**
 * Calculate complete movement cost
 */
export function calculateCompleteMovementCost(
  params: CompleteCostParams
): CompleteMovementCosts {
  const {
    amount,
    sourceAdapter,
    targetAdapter,
    l1GasPrice,
    ethPriceUsdc,
    historicalFailureRate,
    volatilityFactor,
    bestAvailableRate,
    horizonSeconds,
  } = params;
  
  // L2 gas cost
  const l2GasCost = calculateGasCost(params);
  
  // L1 data cost
  const l1DataCost = calculateL1DataCost({
    calldataBytes: estimateCalldataBytes(sourceAdapter, targetAdapter),
    l1GasPrice,
    ethPriceUsdc,
  });
  
  // Entry/exit costs
  const exitCost = estimateExitCost(sourceAdapter);
  const entryCost = estimateEntryCost(targetAdapter);
  
  // Reward processing
  const claimCost = estimateClaimCost(targetAdapter);
  const approveResetCost = estimateApproveResetCost();
  const swapCost = estimateSwapCost(targetAdapter, amount);
  
  // Market impact
  const impactCost = calculateMarketImpact(amount);
  const slippageCost = calculateSlippageCost(amount);
  const mevCost = calculateMEVCost(amount);
  
  // Risk costs
  const failureBuffer = calculateFailureCost({
    historicalFailureRate,
    estimatedLossOnFailure: amount,
    volatilityFactor,
  });
  
  const bufferOpportunityCost = calculateBufferOpportunityCost({
    idleAmount: amount,
    bestAvailableRate,
    timeSeconds: horizonSeconds,
  });
  
  const totalCost = 
    l2GasCost +
    l1DataCost +
    exitCost +
    entryCost +
    claimCost +
    approveResetCost +
    swapCost +
    impactCost +
    slippageCost +
    mevCost +
    failureBuffer +
    bufferOpportunityCost;
  
  return {
    l2GasCost,
    l1DataCost,
    exitCost,
    entryCost,
    claimCost,
    approveResetCost,
    swapCost,
    impactCost,
    slippageCost,
    mevCost,
    failureBuffer,
    bufferOpportunityCost,
    totalCost,
  };
}
```

### 3.7 Files to Modify

| File | Changes |
|------|---------|
| `src/decision/cost-gate-types.ts` | Add missing types |
| `src/decision/cost-gate.ts` | Implement complete cost calculation |

---

## 4. Plan Execution Fix

### 4.1 Overview

The paper (§9.5) specifies staged allocation plans with Merkle proof verification. The current `executeNextAction` implementation reverts instead of executing. This needs fixing to enable the staged execution model.

### 4.2 Current Implementation Analysis

From the contract code review, the vault has:
- ✅ Merkle verifier in `MerkleVerifier.sol`
- ✅ Plan structure with actions
- ✅ Action execution with balance delta checks
- ❌ `executeNextAction` implementation incomplete

### 4.3 Required Implementation

```solidity
// In NavyVaultSRCLA.sol

/**
 * @notice Execute the next action in the active plan
 * @dev Verifies Merkle proof, executes action, and validates balance delta
 */
function executeNextAction(
    bytes32[] calldata proof,
    Action calldata action,
    bytes32 root
) external onlyRole(ALLOCATOR_ROLE) nonReentrant {
    // 1. Validate active plan
    if (activePlanId == bytes32(0)) revert PlanNotActive();
    if (block.timestamp > activePlanExpiresAt) revert PlanExecutionExpired();
    if (usedPlanIds[activePlanId]) revert PlanAlreadyUsed();
    
    // 2. Verify action index
    if (action.index != activePlanNextActionIndex) revert InvalidActionIndex();
    
    // 3. Verify Merkle proof
    bytes32 leaf = keccak256(abi.encode(action));
    if (!MerkleVerifier.verify(proof, root, leaf)) revert InvalidMerkleProof();
    
    // 4. Verify action belongs to this plan
    if (action.planId != activePlanId) revert InvalidPlan();
    
    // 5. Record balance before
    uint256 balanceBefore = IERC20(asset()).balanceOf(address(this));
    
    // 6. Execute action based on kind
    _executeAction(action);
    
    // 7. Verify balance delta
    uint256 balanceAfter = IERC20(asset()).balanceOf(address(this));
    uint256 delta = action.kind == ActionKind.Divest 
        ? balanceAfter - balanceBefore 
        : balanceBefore - balanceAfter;
    
    // 8. Check minOut and loss limits
    if (delta < action.minOut) revert SlippageExceeded();
    if (action.kind == ActionKind.Divest) {
        _checkLossLimit(delta, action.amount);
    }
    
    // 9. Advance action index
    activePlanNextActionIndex++;
    
    // 10. If last action, clear plan
    if (activePlanNextActionIndex >= activePlanActionCount) {
        _finalizePlan();
    }
    
    emit ActionExecuted(action.planId, action.index, action.kind);
}

/**
 * @notice Execute a single action
 */
function _executeAction(Action calldata action) internal {
    if (action.kind == ActionKind.Deploy) {
        _executeDeploy(action);
    } else if (action.kind == ActionKind.Divest) {
        _executeDivest(action);
    } else if (action.kind == ActionKind.Harvest) {
        _executeHarvest(action);
    } else if (action.kind == ActionKind.EmergencyExit) {
        _executeEmergencyExit(action);
    }
}

function _executeDeploy(Action calldata action) internal {
    IStrategyAdapter adapter = IStrategyAdapter(action.adapter);
    
    // Check adapter is registered and active
    if (!registeredAdapters[action.adapter]) revert AdapterNotFound();
    if (adapters[action.adapter].state != AdapterState.Active) revert AdapterNotActive();
    
    // Check cap not exceeded
    uint256 newExposure = strategyAssets[action.adapter] + action.amount;
    _checkAdapterCap(action.adapter, newExposure);
    
    // Transfer and deposit
    IERC20(asset()).safeTransfer(action.adapter, action.amount);
    uint256 credited = adapter.deposit(action.amount);
    
    // Update tracking
    strategyAssets[action.adapter] += credited;
    activePlanTurnover += action.amount;
    
    if (activePlanTurnover > activePlanTurnoverLimit) revert PlanRiskLimitExceeded();
}

function _executeDivest(Action calldata action) internal {
    IStrategyAdapter adapter = IStrategyAdapter(action.adapter);
    
    // Check adapter has position
    uint256 currentPosition = strategyAssets[action.adapter];
    if (currentPosition == 0) revert AdapterNotActive();
    
    // Withdraw
    uint256 beforeBalance = IERC20(asset()).balanceOf(address(this));
    uint256 returned = adapter.withdraw(action.amount);
    uint256 afterBalance = IERC20(asset()).balanceOf(address(this));
    uint256 received = afterBalance - beforeBalance;
    
    // Update tracking
    uint256 loss = received > action.amount ? 0 : action.amount - received;
    strategyAssets[action.adapter] -= received;
    recognizedLosses += loss;
    activePlanTurnover += received;
    
    // Check loss limit
    uint256 totalLoss = activePlanStartingRecognizedLoss + recognizedLosses;
    if (totalLoss > activePlanMaxRecognizedLoss) revert PlanRiskLimitExceeded();
}
```

### 4.4 Direct Allocation Fallback

If plan execution fails, the system should fall back to direct allocation:

```typescript
// src/execution/executor.ts

export class ExecutionExecutor {
  /**
   * Execute allocation with plan or fallback to direct
   */
  async executeAllocation(
    targetAllocation: Map<string, bigint>,
    currentAllocation: Map<string, bigint>,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    // Try plan-based execution first
    if (options.enablePlanExecution) {
      const plan = await this.buildPlan(targetAllocation, currentAllocation);
      
      if (plan && await this.validatePlan(plan)) {
        try {
          return await this.executePlan(plan);
        } catch (error) {
          console.warn('Plan execution failed, falling back to direct allocation');
        }
      }
    }
    
    // Fallback to direct allocation
    return this.executeDirectAllocation(targetAllocation, currentAllocation);
  }
  
  /**
   * Direct allocation - simple deploy/withdraw without Merkle plans
   */
  async executeDirectAllocation(
    targetAllocation: Map<string, bigint>,
    currentAllocation: Map<string, bigint>
  ): Promise<ExecutionResult> {
    const actions: Transaction[] = [];
    
    // Calculate differences
    for (const [adapter, target] of targetAllocation) {
      const current = currentAllocation.get(adapter) ?? 0n;
      const diff = target - current;
      
      if (diff > 0n) {
        // Deploy to adapter
        actions.push({
          type: 'deploy',
          adapter,
          amount: diff,
          minOut: 0n,
        });
      } else if (diff < 0n) {
        // Withdraw from adapter
        actions.push({
          type: 'divest',
          adapter,
          amount: abs(diff),
          minOut: this.calculateMinOut(abs(diff)),
        });
      }
    }
    
    // Execute all actions
    return this.executeTransactions(actions);
  }
}
```

### 4.5 Files to Modify

| File | Changes |
|------|---------|
| `contract/src/NavyVaultSRCLA.sol` | Implement executeNextAction |
| `srcla/src/execution/executor.ts` | Add direct allocation fallback |

---

## 5. Coverage Tracking & Artifact Hash

### 5.1 Overview

Per §7.3 and §11, the system must:
1. Track lower-bound forecast coverage
2. Persist artifact hashes for reproducibility
3. Verify coverage ≥ 95% target

### 5.2 Coverage Tracking Implementation

```typescript
// src/evaluation/coverage-tracker.ts

export interface CoverageRecord {
  marketId: string;
  timestamp: Date;
  lowerBound: bigint;        // Predicted lower bound
  actualReturn: bigint;       // Realized return
  covered: boolean;           // lowerBound <= actualReturn
  horizon: number;            // Horizon in days
}

export class CoverageTracker {
  private records: Map<string, CoverageRecord[]> = new Map();
  
  /**
   * Record a forecast outcome for coverage evaluation
   */
  recordOutcome(
    marketId: string,
    timestamp: Date,
    lowerBound: bigint,
    actualReturn: bigint,
    horizon: number
  ): void {
    const record: CoverageRecord = {
      marketId,
      timestamp,
      lowerBound,
      actualReturn,
      covered: lowerBound <= actualReturn,
      horizon,
    };
    
    const marketRecords = this.records.get(marketId) ?? [];
    marketRecords.push(record);
    
    // Keep last 1000 records
    if (marketRecords.length > 1000) {
      marketRecords.shift();
    }
    
    this.records.set(marketId, marketRecords);
  }
  
  /**
   * Calculate coverage for a market
   */
  calculateCoverage(marketId: string, windowDays?: number): CoverageMetrics {
    const records = this.records.get(marketId) ?? [];
    
    // Filter to window if specified
    const filtered = windowDays 
      ? records.slice(-windowDays)
      : records;
    
    if (filtered.length === 0) {
      return {
        coverage: 0,
        totalRecords: 0,
        coveredRecords: 0,
        averageShortfall: 0n,
        maxShortfall: 0n,
        exceedsTarget: false,
      };
    }
    
    const coveredRecords = filtered.filter(r => r.covered).length;
    const coverage = coveredRecords / filtered.length;
    
    // Calculate shortfall statistics
    const shortfalls = filtered
      .filter(r => !r.covered)
      .map(r => r.actualReturn - r.lowerBound);
    
    const avgShortfall = shortfalls.length > 0
      ? shortfalls.reduce((a, b) => a + b, 0n) / BigInt(shortfalls.length)
      : 0n;
    
    const maxShortfall = shortfalls.length > 0
      ? shortfalls.reduce((a, b) => a > b ? a : b, 0n)
      : 0n;
    
    return {
      coverage,
      totalRecords: filtered.length,
      coveredRecords,
      averageShortfall: avgShortfall,
      maxShortfall,
      exceedsTarget: coverage >= 0.95,
    };
  }
  
  /**
   * Get coverage report for all markets
   */
  generateCoverageReport(): CoverageReport {
    const marketCoverages = new Map<string, CoverageMetrics>();
    
    for (const [marketId] of this.records) {
      marketCoverages.set(marketId, this.calculateCoverage(marketId));
    }
    
    // Calculate portfolio coverage
    const allRecords = Array.from(this.records.values()).flat();
    const portfolioCoverage = allRecords.filter(r => r.covered).length / allRecords.length;
    
    return {
      generatedAt: new Date(),
      markets: marketCoverages,
      portfolioCoverage,
      allMarketsExceedTarget: Array.from(marketCoverages.values())
        .every(m => m.exceedsTarget),
    };
  }
}
```

### 5.3 Artifact Hash Persistence

```typescript
// src/evaluation/forecast/artifact.ts

export interface ForecastArtifact {
  /** Artifact hash for reproducibility */
  artifactHash: string;
  
  /** Selected method name */
  methodName: string;
  
  /** Method configuration */
  methodConfig: {
    windowDays?: number;
    quantile?: number;
    horizonDays?: number;
    decayFactor?: number;
    features?: string[];
  };
  
  /** Coverage target */
  coverageTarget: number;
  
  /** Achieved coverage during calibration */
  calibrationCoverage: number;
  
  /** Calibration date range */
  calibrationPeriod: {
    start: Date;
    end: Date;
  };
  
  /** Hash of calibration dataset */
  datasetHash: string;
  
  /** Code commit at time of selection */
  codeCommit: string;
}

/**
 * Persist forecast artifact to database
 */
export async function persistForecastArtifact(
  artifact: ForecastArtifact,
  db: Database
): Promise<void> {
  await db.forecastArtifacts.create({
    data: {
      artifactHash: artifact.artifactHash,
      methodName: artifact.methodName,
      methodConfig: JSON.stringify(artifact.methodConfig),
      coverageTarget: artifact.coverageTarget,
      calibrationCoverage: artifact.calibrationCoverage,
      calibrationStart: artifact.calibrationPeriod.start,
      calibrationEnd: artifact.calibrationPeriod.end,
      datasetHash: artifact.datasetHash,
      codeCommit: artifact.codeCommit,
      createdAt: new Date(),
    },
  });
}

/**
 * Calculate artifact hash
 */
export function calculateArtifactHash(artifact: Omit<ForecastArtifact, 'artifactHash'>): string {
  const content = JSON.stringify({
    methodName: artifact.methodName,
    methodConfig: artifact.methodConfig,
    coverageTarget: artifact.coverageTarget,
    calibrationCoverage: artifact.calibrationCoverage,
    datasetHash: artifact.datasetHash,
  });
  
  return keccak256(Buffer.from(content)).substring(2, 10);
}
```

### 5.4 Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/evaluation/coverage-tracker.ts` | Create | Coverage tracking |
| `src/evaluation/coverage-tracker.spec.ts` | Create | Tests |
| `src/evaluation/forecast/artifact.ts` | Create | Artifact hash persistence |
| `prisma/schema.prisma` | Modify | Add ForecastArtifact model |

---

## 6. Evaluation Manifest & Reproducibility

### 6.1 Overview

Per §11, the evaluation must be reproducible with a manifest that fixes all parameters. The current implementation has baselines and ablations but lacks the manifest system.

### 6.2 Manifest Schema

```typescript
// src/evaluation/manifest/types.ts

export interface EvaluationManifest {
  /** Manifest identifier */
  id: string;
  
  /** Manifest version */
  version: string;
  
  /** Creation timestamp */
  createdAt: string;
  
  /** Dataset bounds */
  dataset: {
    startDate: string;
    endDate: string;
    snapshotCadenceMinutes: number;
    marketIds: string[];
  };
  
  /** Calibration boundaries */
  calibration: {
    startDate: string;
    endDate: string;
    calibrationMethod: 'rolling' | 'expanding';
  };
  
  /** Held-out evaluation bounds */
  heldOut: {
    startDate: string;
    endDate: string;
  };
  
  /** Vault tiers to evaluate */
  vaultTiers: number[];  // e.g., [10000, 100000, 1000000, 10000000]
  
  /** Policies to evaluate */
  policies: {
    baselines: ('b0' | 'b1' | 'b2' | 'b3' | 'b4' | 'b5')[];
    ablations: ('h1' | 'h2' | 'h3' | 'h4' | 'h5')[];
    srcla: boolean;
  };
  
  /** Market configuration */
  markets: {
    [marketId: string]: {
      adapters: string[];
      coldStartDays: number;
      minCompletedOutcomes: number;
    };
  };
  
  /** Cost parameters */
  costs: {
    l2GasPrice: bigint;
    l1GasPrice: bigint;
    ethPrice: bigint;
    slippageBps: number;
    mevBps: number;
  };
  
  /** Execution parameters */
  execution: {
    decisionCadenceMinutes: number;
    executionDelayBlocks: number;
    failedTxPolicy: 'retry' | 'skip' | 'abort';
  };
  
  /** Content hashes for reproducibility */
  contentHashes: {
    manifest: string;
    dataset: string;
    codeCommit: string;
  };
}
```

### 6.3 Manifest Generation

```typescript
// src/evaluation/manifest/manifest.ts

export class ManifestGenerator {
  /**
   * Generate evaluation manifest from current state
   */
  async generate(config: ManifestConfig): Promise<EvaluationManifest> {
    const datasetHash = await this.calculateDatasetHash(config.dataset);
    const codeCommit = await this.getCodeCommit();
    
    const manifest: EvaluationManifest = {
      id: this.generateManifestId(),
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      
      dataset: {
        startDate: config.dataset.startDate,
        endDate: config.dataset.endDate,
        snapshotCadenceMinutes: config.dataset.cadenceMinutes,
        marketIds: config.dataset.markets,
      },
      
      calibration: {
        startDate: config.calibration.startDate,
        endDate: config.calibration.endDate,
        calibrationMethod: 'rolling',
      },
      
      heldOut: {
        startDate: config.evaluation.startDate,
        endDate: config.evaluation.endDate,
      },
      
      vaultTiers: [10_000, 100_000, 1_000_000, 10_000_000],
      
      policies: {
        baselines: ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'],
        ablations: ['h1', 'h2', 'h3', 'h4', 'h5'],
        srcla: true,
      },
      
      markets: this.buildMarketConfig(config.dataset.markets),
      
      costs: await this.fetchCurrentCosts(),
      
      execution: {
        decisionCadenceMinutes: 60,
        executionDelayBlocks: 1,
        failedTxPolicy: 'skip',
      },
      
      contentHashes: {
        manifest: '',
        dataset: datasetHash,
        codeCommit,
      },
    };
    
    // Calculate manifest hash
    manifest.contentHashes.manifest = this.calculateManifestHash(manifest);
    
    return manifest;
  }
  
  /**
   * Verify manifest matches current state
   */
  async verify(manifest: EvaluationManifest): Promise<VerificationResult> {
    const errors: string[] = [];
    
    // Verify code commit matches
    const currentCommit = await this.getCodeCommit();
    if (currentCommit !== manifest.contentHashes.codeCommit) {
      errors.push(`Code commit mismatch: ${currentCommit} != ${manifest.contentHashes.codeCommit}`);
    }
    
    // Verify dataset hasn't changed
    const currentDatasetHash = await this.calculateDatasetHash(manifest.dataset);
    if (currentDatasetHash !== manifest.contentHashes.dataset) {
      errors.push(`Dataset changed since manifest creation`);
    }
    
    // Verify market configuration
    const currentMarkets = await this.getCurrentMarkets();
    for (const [marketId, config] of Object.entries(manifest.markets)) {
      const current = currentMarkets.get(marketId);
      if (!current) {
        errors.push(`Market ${marketId} no longer exists`);
      } else if (JSON.stringify(current) !== JSON.stringify(config)) {
        errors.push(`Market ${marketId} configuration changed`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
```

### 6.4 Evaluation Runner

```typescript
// src/evaluation/runner.ts

export class EvaluationRunner {
  /**
   * Run full evaluation against manifest
   */
  async run(manifest: EvaluationManifest): Promise<EvaluationResults> {
    console.log(`Starting evaluation with manifest ${manifest.id}`);
    
    // Load dataset
    const dataset = await this.loadDataset(manifest.dataset);
    
    // Initialize policies
    const policies = this.initializePolicies(manifest.policies);
    
    // Initialize replays for each tier
    const results: PolicyResults[] = [];
    
    for (const tier of manifest.vaultTiers) {
      console.log(`Evaluating tier ${tier} USDC...`);
      
      for (const [policyId, policy] of Object.entries(policies)) {
        const replay = new VaultReplay(dataset, tier);
        const policyResult = await replay.run(policy, manifest);
        
        results.push({
          policyId,
          tier,
          ...policyResult,
        });
      }
    }
    
    // Calculate comparative metrics
    const comparison = this.comparePolicies(results, manifest);
    
    // Check release gates
    const gates = this.evaluateReleaseGates(comparison, manifest);
    
    return {
      manifestId: manifest.id,
      generatedAt: new Date().toISOString(),
      results,
      comparison,
      releaseGates: gates,
      contentHash: this.calculateResultsHash(results),
    };
  }
  
  /**
   * Evaluate release gates per §11.5
   */
  evaluateReleaseGates(
    comparison: PolicyComparison,
    manifest: EvaluationManifest
  ): ReleaseGateResults {
    const gates: ReleaseGateResults = {
      forecastGate: { passed: false, details: '' },
      policyGate: { passed: false, details: '' },
    };
    
    // Forecast Gate (§11.5)
    const coverageCheck = this.checkCoverageGates();
    gates.forecastGate = {
      passed: coverageCheck.allPass,
      details: coverageCheck.details,
    };
    
    // Policy Gate (§11.5)
    const safetyCheck = this.checkSafetyViolations();
    const performanceCheck = this.checkPerformanceGates(comparison);
    const completenessCheck = this.checkCompleteness(manifest);
    
    gates.policyGate = {
      passed: safetyCheck.pass && performanceCheck.pass && completenessCheck.pass,
      details: [
        safetyCheck.details,
        performanceCheck.details,
        completenessCheck.details,
      ].join('; '),
    };
    
    return gates;
  }
}
```

### 6.5 Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/evaluation/manifest/types.ts` | Extend | Add manifest types |
| `src/evaluation/manifest/manifest.ts` | Extend | Manifest generation/verification |
| `src/evaluation/runner.ts` | Create | Evaluation runner |
| `src/evaluation/evaluation.spec.ts` | Create | Integration tests |
| `scripts/run-evaluation.ts` | Modify | Add manifest support |

---

## 7. Base Configuration Updates

### 7.1 Environment Variables

```bash
# .env for Base Mainnet deployment

# Chain
CHAIN_ID=8453
BASE_RPC_URL=https://mainnet.base.org
FALLBACK_RPC_URL=https://base-mainnet.public.blastapi.io

# Contracts (Base Mainnet)
VAULT_ADDRESS=0x...                    # TBD after deployment
AAVE_STRATEGY_ADDRESS=0x...            # TBD after deployment  
COMPOUND_STRATEGY_ADDRESS=0x...        # TBD after deployment
MOONWELL_STRATEGY_ADDRESS=0x...        # TBD after deployment
REWARD_EXECUTOR_ADDRESS=0x...          # TBD after deployment
REWARD_ACCOUNTANT_ADDRESS=0x...       # TBD after deployment

# Assets (Base Mainnet)
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Uniswap V3 (Base)
UNISWAP_FACTORY=0x...                 # TBD
UNISWAP_SWAP_ROUTER=0x...             # TBD

# Chainlink Feeds (Base)
CHAINLINK_USDC_USD_FEED=0x...         # TBD
CHAINLINK_ETH_USD_FEED=0x...          # TBD
CHAINLINK_SEQUENCER_FEED=0x...        # TBD

# Admin/Allocator Keys
ADMIN_PRIVATE_KEY=0x...                # HSM recommended
ALLOCATOR_PRIVATE_KEY=0x...           # Store securely
```

### 7.2 Configuration Files

```typescript
// src/config/base-contracts.ts

export const BASE_MAINNET_CONTRACTS = {
  // Circle native USDC
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  
  // Aave V3
  aave: {
    pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    aToken: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB',
    oracle: '0x...',  // TBD from Aave address book
    interestRateStrategy: '0x...',  // TBD
  },
  
  // Compound III
  compound: {
    comet: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
    rewards: '0x...',  // TBD
  },
  
  // Moonwell
  moonwell: {
    mToken: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
    unitroller: '0x...',  // TBD
    comptroller: '0x...', // TBD
  },
  
  // Uniswap V3
  uniswap: {
    factory: '0x33128a8fC55774888DD9E0E9d3B3B4899879D',  // TBD
    router: '0x2626664c260F6d74421a6C9B6B3B3B4899879D',   // TBD
    npm: '0x...',  // Nonfungible position manager - TBD
  },
  
  // Chainlink
  chainlink: {
    usdcUsd: '0x...',    // TBD
    ethUsd: '0x...',     // TBD
    sequencer: '0x...',  // TBD
  },
} as const;
```

---

## 8. Implementation Order

### Phase 1: Core Infrastructure (Priority: Critical)

1. **Update configuration** for Base mainnet
2. **Implement Uniswap V3 TWAP oracle**
3. **Complete cost gate** (L1 data, failure, buffer)
4. **Fix plan execution** or implement direct fallback

### Phase 2: Evaluation (Priority: High)

5. **Coverage tracking** and artifact hash
6. **Evaluation manifest** system
7. **Full evaluation runner** with release gates

### Phase 3: Integration (Priority: Medium)

8. **Integration tests** with Base fork
9. **Documentation** of all new components

---

## 9. Testing Strategy

### 9.1 Unit Tests

| Component | Test Coverage |
|-----------|-------------|
| TWAP Oracle | Price calculation, validation, edge cases |
| Complete Cost Gate | All cost components, threshold decisions |
| Coverage Tracker | Coverage calculation, artifact hash |
| Manifest Generator | Manifest creation, verification |

### 9.2 Integration Tests

| Test | Description |
|------|-------------|
| Base Fork Test | Full decision cycle on Base Anvil fork |
| Evaluation Replay | Reproduce historical evaluation |
| Plan Execution | Merkle plan build and execution |

### 9.3 Test Commands

```bash
# Unit tests
cd srcla
pnpm test

# Type check
pnpm exec tsc --noEmit

# Build
pnpm build

# Run evaluation with manifest
pnpm run evaluation:run -- --manifest config/evaluation-manifest.json

# Verify evaluation reproducibility
pnpm run evaluation:verify -- --latest-complete

# Anvil fork test
pnpm run anvil:test
```

---

## 10. Files Summary

### New Files

| File | Description |
|------|-------------|
| `srcla/src/oracle/twap-oracle.ts` | Uniswap V3 TWAP oracle |
| `srcla/src/oracle/twap-oracle.spec.ts` | TWAP oracle tests |
| `srcla/src/evaluation/coverage-tracker.ts` | Coverage tracking |
| `srcla/src/evaluation/coverage-tracker.spec.ts` | Coverage tests |
| `srcla/src/evaluation/forecast/artifact.ts` | Artifact hash management |
| `srcla/src/evaluation/runner.ts` | Evaluation runner |
| `srcla/src/evaluation/evaluation.spec.ts` | Evaluation integration tests |

### Modified Files

| File | Changes |
|------|---------|
| `srcla/src/decision/cost-gate.ts` | Add L1 data, failure, buffer costs |
| `srcla/src/decision/cost-gate-types.ts` | Add missing types |
| `srcla/src/execution/executor.ts` | Add direct allocation fallback |
| `srcla/src/evaluation/manifest/types.ts` | Extend manifest schema |
| `srcla/src/evaluation/manifest/manifest.ts` | Add generation/verification |
| `srcla/src/config.ts` | Add Base configuration |
| `contract/src/NavyVaultSRCLA.sol` | Implement executeNextAction |
| `scripts/run-evaluation.ts` | Add manifest support |
| `prisma/schema.prisma` | Add ForecastArtifact model |

### Environment Updates

| File | Changes |
|------|---------|
| `srcla/.env.example` | Add Base mainnet addresses |
| `srcla/.env` | Add actual values for deployment |

---

## 11. Dependencies

### NPM Packages

```json
{
  "dependencies": {
    // Existing
    "ethers": "^6.13.2",
    "fastify": "^4.28.1",
    "zod": "^3.23.8",
    "@prisma/client": "^5.19.0"
  },
  "devDependencies": {
    // Existing
    "jest": "^29.7.0",
    "typescript": "^5.5.4"
  }
}
```

No new external dependencies required. All implementations use existing libraries.

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Uniswap V3 TWAP calculation errors | High | Extensive unit testing with known values |
| L1 cost estimation inaccuracy | Medium | Use actual on-chain L1 gas price oracle |
| Evaluation reproducibility issues | Medium | Manifest system with content hashing |
| Base RPC reliability | High | Configure fallback RPC endpoints |
| Plan execution edge cases | High | Implement direct fallback as safety net |

---

## 13. Verification Checklist

- [ ] All new code has unit tests
- [ ] TypeScript compiles without errors
- [ ] Integration tests pass on Base fork
- [ ] Evaluation runs successfully with manifest
- [ ] Coverage tracking shows ≥95% coverage
- [ ] Manifest verification passes
- [ ] Release gates evaluated correctly
- [ ] Documentation updated
