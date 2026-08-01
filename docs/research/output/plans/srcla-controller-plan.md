# SRCLA Controller Implementation Plan

**Goal:** Implement exact baselines, calibrated forecasts, hard constraints, dynamic reserves, robust targets, and impulse execution as pure reproducible Python.

## Files

- Create `research-engine/src/srcla/{types,baselines,forecast,constraints,reserve,optimizer,impulse,accounting,decision_log}.py`
- Create `research-engine/tests/test_{baselines,forecast,constraints,reserve,optimizer,impulse,accounting}.py`

## Interfaces

`forecast(snapshot, horizon, allocation) -> ReturnDistribution`; `feasible(snapshot, policy) -> FeasibleSet`; `optimize(current, forecasts, feasible, costs) -> TargetAllocation`; `decide(current, target, costs, safety) -> ActionPlan`.

### Task 1: B0–B5 baselines

- [ ] Write fixtures where displayed-APR winner differs from post-deposit optimum.
- [ ] Implement Hold, Winner, PostDeposit, CostThreshold, RobustStatic, and offline-only Hindsight policies.
- [ ] Assert B5 cannot be constructed by deployable configuration.
- [ ] Run targeted tests and commit `feat: add reproducible lending baselines`.

### Task 2: Forecast features and calibration

- [ ] Test left-closed rolling features, chronological splits, deterministic seeds, and explicit missingness.
- [ ] Implement horizon models for 6h, 24h, 3d, and 7d using quantile ensemble predictions.
- [ ] Calibrate lower bounds on validation only; test empirical coverage on held-out fixtures.
- [ ] Implement conservative deterministic fallback when calibration fails.
- [ ] Commit `feat: add calibrated lending return forecasts`.

### Task 3: Hard feasibility

- [ ] Test market/protocol/utilization/liquidity/collateral/oracle/governance/dependency caps.
- [ ] Test ineligible or stale markets receive zero.
- [ ] Implement time-bucket stressed withdrawal inequality and policy-version hashing.
- [ ] Run property tests ensuring no optimizer output violates feasibility.
- [ ] Commit `feat: enforce lending safety feasibility`.

### Task 4: Dynamic reserve

- [ ] Test minimum reserve, withdrawal quantile, stress shortfall, and rising reserve under illiquidity.
- [ ] Implement `max(minimum, withdrawal_quantile, stress_shortfall)`.
- [ ] Verify reserve is size-aware without tier-specific rules.
- [ ] Commit `feat: derive dynamic idle reserve`.

### Task 5: Robust optimizer

- [ ] Add solvable hand examples with known constrained targets.
- [ ] Implement lower-confidence net-yield objective with exact action-dependent rate adapters.
- [ ] Verify weight sum, caps, deterministic solver tolerance, and infeasibility reporting.
- [ ] Commit `feat: optimize robust lending targets`.

### Task 6: Impulse policy and accounting

- [ ] Test passive deposit correction, no-trade boundary, nearest-boundary movement, reversal penalty, cooldown, turnover budget, and safety bypass.
- [ ] Test ERC-4626 share price, late depositor fairness, realized/unrealized user profit, and costs.
- [ ] Emit replayable decision logs with input/model/policy hashes.
- [ ] Run full pytest, lint, and deterministic replay twice.
- [ ] Commit `feat: add cost-aware impulse controller`.
