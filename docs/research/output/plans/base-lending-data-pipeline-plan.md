# Base Lending Data Pipeline Implementation Plan

**Goal:** Build a deterministic Python pipeline that reconstructs Base lending state into versioned Parquet datasets.

## Files

- Create `research-engine/pyproject.toml`
- Create `research-engine/src/srcla_data/{models,rpc,manifest,pipeline}.py`
- Create `research-engine/src/srcla_data/protocols/{aave,compound,moonwell,morpho}.py`
- Create `research-engine/tests/fixtures/*.json`
- Create `research-engine/tests/test_{rpc,manifest,pipeline,protocols}.py`

## Interfaces

`MarketAdapter.read_state(block: int) -> MarketState`; `MarketState` contains accrued supply, borrow, cash, utilization, base rate, rewards, action pauses, and parameter version. `write_dataset(states, manifest_path)` emits Parquet plus SHA-256 manifests.

### Task 1: Package and schemas

- [ ] Write failing tests for strict immutable `MarketState`, USDC units, chain 8453, and unique market/block keys.
- [ ] Run `cd research-engine && uv run pytest tests/test_models.py -q`; expect missing-module failure.
- [ ] Implement typed dataclasses/Pydantic models and Parquet schema.
- [ ] Re-run tests; expect pass.
- [ ] Commit `test: define lending dataset state schema`.

### Task 2: RPC evidence layer

- [ ] Pin Base block 49,397,275 responses for block hash/timestamp and code hashes.
- [ ] Test retry bounds, batch-call ordering, block pinning, and rejection of latest/unpinned reads.
- [ ] Implement Web3.py RPC client that requires an explicit block and records endpoint evidence without credentials.
- [ ] Run `uv run pytest tests/test_rpc.py -q`.
- [ ] Commit `feat: add pinned Base RPC evidence reader`.

### Task 3: Exact protocol adapters

- [ ] Add hand-checked fixtures for Aave derived liquidity rate, Compound direct supply rate, Moonwell jump-rate supplier rate, and Morpho accrued market/AdaptiveCurveIRM state.
- [ ] Verify each test fails before implementation.
- [ ] Implement one adapter per protocol without shared rate-formula assumptions.
- [ ] Compare adapter values with direct `cast call --block 49397275` fixtures within exact integer or declared rounding tolerance.
- [ ] Commit each adapter separately.

### Task 4: Events and parameter validity

- [ ] Test supply/withdraw/borrow/repay/liquidation/reward/pause/upgrade decoding and `valid_from_block` intervals.
- [ ] Implement event ingestion with transaction hash/log-index uniqueness and reorg block hashes.
- [ ] Reject forward-filled mutable values outside validity intervals.
- [ ] Commit `feat: ingest lending flows and parameter history`.

### Task 5: Dataset build and verification

- [ ] Test idempotent reruns, monotonic blocks, no duplicates, no future timestamps, and stable hashes.
- [ ] Build market-state and event Parquet partitions plus manifest.
- [ ] Run `uv run pytest -q`, `uv run ruff check .`, and a two-run hash comparison.
- [ ] Commit `feat: produce reproducible Base lending dataset`.
