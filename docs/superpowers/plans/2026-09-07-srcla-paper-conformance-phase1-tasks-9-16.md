# SRCLA Phase 1 — Tasks 9–16

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Continuation of `2026-09-07-srcla-paper-conformance-phase1.md` — read its **Global Constraints** first; they apply to every task here.

**Spec:** `docs/superpowers/specs/2026-09-07-srcla-paper-conformance-design.md`

---

### Task 9: `steps/cost.ts` — eleven-term movement cost and the P8 no-trade band

Replaces `controller.ts:822`, which hardcodes 30 gwei, $3 500 ETH and 200k gas, and implements two of the eleven terms §9.1 requires.

**Files:**
- Create: `srcla/src/policy/steps/cost.ts`
- Test: `srcla/test/unit/policy/cost.spec.ts`

**Interfaces:**
- Consumes: `DecisionInput`, `CostGateResult`, `PolicyArtifact`, `RateCurve` (Tasks 2, 5); `portfolioLowerBound` (Task 8).
- Produces:
  - `MOVE_COST_TERMS: readonly string[]` — the eleven names, asserted by test
  - `movementCostBase(input, moves, params): { totalBase: bigint; terms: Record<string,bigint> }`
  - `noTradeBandBase(input, curves, artifact, notionalBase): bigint`
  - `costGate(input, curves, artifact, current, target, params): CostGateResult`

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/policy/cost.spec.ts`:

```ts
import { MOVE_COST_TERMS, movementCostBase, noTradeBandBase, costGate } from '../../../src/policy/steps/cost.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import type { DecisionInput, MarketObservation, PolicyArtifact, RateCurve } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const Q = 1_000_000_000n;

function market(id: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id, adapter: `0x${id}`, protocol: 'aave',
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: 0n,
    positionBase: 0n, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 10000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
    ...over,
  };
}

function input(markets: MarketObservation[], lastActionSeconds: number | null = null): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n, idleBase: 10_000_000_000n, sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 0, paused: false, configurationDigest: '0xv',
    },
    markets, dependencyGroups: [], withdrawals: [],
    gas: {
      l2BaseFeeWei: 5_000_000n,          // 0.005 gwei, typical Base
      l1BaseFeeWei: 8_000_000_000n,      // 8 gwei on L1
      l1BlobBaseFeeWei: 1n,
      ethUsdE8: 350_000_000_000n,        // $3,500
      usdcUsdE8: 100_000_000n,           // $1.00
    },
    history: [], lastAction: { timestampSeconds: lastActionSeconds, turnoverWindowBase: 0n },
  };
}

function curve(id: string, rate: bigint): RateCurve {
  return { marketId: id, quantumBase: Q, points: [rate, rate, rate, rate, rate], maxXBase: Q * 4n };
}

const artifact = (): PolicyArtifact => ({
  ...loadBootstrapArtifact(),
  residualQuantileWadByMarket: { a: 0n, b: 0n },
  noTradeBandK: 1.0,
});

const PARAMS = {
  cooldownSeconds: 3600,
  minTurnoverBps: 10,
  maxTurnoverBps: 5000,
  slippageBps: 5,
  mevBps: 1,
  impactBps: 2,
  failureRateBps: 50,
  bufferBps: 100,
  gasPerAction: 250_000n,
  l1BytesPerAction: 2_000n,
};

describe('movementCostBase', () => {
  it('registers all eleven terms from paper 9.1', () => {
    expect(MOVE_COST_TERMS).toEqual([
      'l2', 'l1Data', 'exit', 'entry', 'claim',
      'approveReset', 'swap', 'impact', 'slippageMev', 'failure', 'buffer',
    ]);
  });

  it('reports every registered term, none missing', () => {
    const { terms } = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q, kind: 'deploy' }], PARAMS);
    for (const name of MOVE_COST_TERMS) expect(terms[name]).toBeDefined();
  });

  it('includes a non-zero L1 data cost', () => {
    const { terms } = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q, kind: 'deploy' }], PARAMS);
    expect(terms['l1Data']!).toBeGreaterThan(0n);
  });

  it('scales with the number of actions', () => {
    const one = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q, kind: 'deploy' }], PARAMS);
    const two = movementCostBase(
      input([market('a'), market('b')]),
      [{ adapter: '0xa', amountBase: Q, kind: 'divest' }, { adapter: '0xb', amountBase: Q, kind: 'deploy' }],
      PARAMS
    );
    expect(two.totalBase).toBeGreaterThan(one.totalBase);
  });

  it('scales proportional terms with notional', () => {
    const small = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q, kind: 'deploy' }], PARAMS);
    const large = movementCostBase(input([market('a')]), [{ adapter: '0xa', amountBase: Q * 100n, kind: 'deploy' }], PARAMS);
    expect(large.terms['slippageMev']!).toBeGreaterThan(small.terms['slippageMev']!);
  });
});

describe('costGate', () => {
  it('blocks while inside the cooldown window', () => {
    const i = input([market('a', { positionBase: 0n })], 999_000); // 1000s ago, cooldown 3600
    const r = costGate(i, [curve('a', WAD / 10n)], artifact(), new Map([['a', 0n]]), new Map([['a', Q * 4n]]), PARAMS);
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('COOLDOWN');
  });

  it('blocks a move whose turnover is below the minimum', () => {
    const i = input([market('a')]);
    const r = costGate(i, [curve('a', WAD / 10n)], artifact(), new Map([['a', 0n]]), new Map([['a', 1n]]), PARAMS);
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('MIN_TURNOVER');
  });

  it('blocks a move whose turnover exceeds the maximum', () => {
    const i = input([market('a')]);
    const r = costGate(i, [curve('a', WAD / 10n)], artifact(), new Map([['a', 0n]]), new Map([['a', 9_000_000_000n]]), PARAMS);
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('MAX_TURNOVER');
  });

  it('blocks a gain that clears cost but not the uncertainty band (P8)', () => {
    const i = input([market('a')]);
    const a = { ...artifact(), portfolioResidualQuantileWad: -(WAD / 100n), noTradeBandK: 1000 };
    const r = costGate(i, [curve('a', WAD / 1000n)], a, new Map([['a', 0n]]), new Map([['a', Q * 2n]]), PARAMS);
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('NO_TRADE_BAND');
    expect(r.bandBase).toBeGreaterThan(r.moveCostBase);
  });

  it('passes a clearly profitable move outside cooldown', () => {
    const i = input([market('a')]);
    const a = { ...artifact(), noTradeBandK: 0 };
    const r = costGate(i, [curve('a', WAD / 2n)], a, new Map([['a', 0n]]), new Map([['a', Q * 4n]]), PARAMS);
    expect(r.passed).toBe(true);
    expect(r.gainBase).toBeGreaterThan(r.moveCostBase);
  });

  it('is deterministic', () => {
    const i = input([market('a')]);
    const args = [i, [curve('a', WAD / 2n)], artifact(), new Map([['a', 0n]]), new Map([['a', Q * 4n]]), PARAMS] as const;
    expect(costGate(...args)).toEqual(costGate(...args));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- policy/cost`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cost.ts`**

```ts
import { portfolioLowerBound } from './optimize.js';
import type { CostGateResult, DecisionInput, PolicyArtifact, RateCurve } from '../types.js';

const WAD = 10n ** 18n;
const WEI_PER_ETH = 10n ** 18n;

/** §9.1 - C_move has exactly these eleven components. */
export const MOVE_COST_TERMS = [
  'l2', 'l1Data', 'exit', 'entry', 'claim',
  'approveReset', 'swap', 'impact', 'slippageMev', 'failure', 'buffer',
] as const;

export interface CostParams {
  cooldownSeconds: number;
  minTurnoverBps: number;
  maxTurnoverBps: number;
  slippageBps: number;
  mevBps: number;
  impactBps: number;
  failureRateBps: number;
  bufferBps: number;
  gasPerAction: bigint;
  l1BytesPerAction: bigint;
}

export interface Move {
  adapter: string;
  amountBase: bigint;
  kind: 'deploy' | 'divest' | 'harvest';
}

/** Convert a wei amount to USDC base units using the origin's ETH/USD round. */
function weiToUsdcBase(wei: bigint, ethUsdE8: bigint, usdcUsdE8: bigint): bigint {
  // wei * (ETH/USD) / 1e18 -> USD; / (USDC/USD) -> USDC; * 1e6 -> base units.
  const usdE8 = (wei * ethUsdE8) / WEI_PER_ETH;
  return (usdE8 * 1_000_000n) / usdcUsdE8;
}

export function movementCostBase(
  input: DecisionInput,
  moves: Move[],
  p: CostParams
): { totalBase: bigint; terms: Record<string, bigint> } {
  const n = BigInt(moves.length);
  const notional = moves.reduce((s, m) => s + m.amountBase, 0n);
  const { gas } = input;

  const l2Wei = n * p.gasPerAction * gas.l2BaseFeeWei;
  // Base posts calldata to L1; ~16 gas per non-zero byte is the standard model.
  const l1Wei = n * p.l1BytesPerAction * 16n * gas.l1BaseFeeWei;

  const bpsOf = (bps: number) => (notional * BigInt(bps)) / 10_000n;

  const terms: Record<string, bigint> = {
    l2: weiToUsdcBase(l2Wei, gas.ethUsdE8, gas.usdcUsdE8),
    l1Data: weiToUsdcBase(l1Wei, gas.ethUsdE8, gas.usdcUsdE8),
    exit: weiToUsdcBase(
      BigInt(moves.filter((m) => m.kind === 'divest').length) * p.gasPerAction * gas.l2BaseFeeWei,
      gas.ethUsdE8, gas.usdcUsdE8
    ),
    entry: weiToUsdcBase(
      BigInt(moves.filter((m) => m.kind === 'deploy').length) * p.gasPerAction * gas.l2BaseFeeWei,
      gas.ethUsdE8, gas.usdcUsdE8
    ),
    claim: weiToUsdcBase(
      BigInt(moves.filter((m) => m.kind === 'harvest').length) * p.gasPerAction * gas.l2BaseFeeWei,
      gas.ethUsdE8, gas.usdcUsdE8
    ),
    approveReset: weiToUsdcBase(
      BigInt(moves.filter((m) => m.kind === 'harvest').length) * 2n * 50_000n * gas.l2BaseFeeWei,
      gas.ethUsdE8, gas.usdcUsdE8
    ),
    swap: weiToUsdcBase(
      BigInt(moves.filter((m) => m.kind === 'harvest').length) * 180_000n * gas.l2BaseFeeWei,
      gas.ethUsdE8, gas.usdcUsdE8
    ),
    impact: bpsOf(p.impactBps),
    slippageMev: bpsOf(p.slippageBps + p.mevBps),
    failure: 0n,
    buffer: 0n,
  };

  // Expected failure cost: a reverted action still burns gas.
  const executionSoFar = terms['l2']! + terms['l1Data']! + terms['exit']! + terms['entry']! + terms['claim']!;
  terms['failure'] = (executionSoFar * BigInt(p.failureRateBps)) / 10_000n;

  const beforeBuffer = MOVE_COST_TERMS.reduce((s, k) => s + terms[k]!, 0n);
  terms['buffer'] = (beforeBuffer * BigInt(p.bufferBps)) / 10_000n;

  const totalBase = MOVE_COST_TERMS.reduce((s, k) => s + terms[k]!, 0n);
  return { totalBase, terms };
}

/**
 * P8 - a no-trade band scaled by forecast dispersion. On Base, C_move is small
 * enough that it alone does not suppress churn; this term does.
 */
export function noTradeBandBase(
  _input: DecisionInput,
  _curves: RateCurve[],
  artifact: PolicyArtifact,
  notionalBase: bigint
): bigint {
  // The portfolio residual quantile is the calibrated dispersion measure the
  // artifact already carries; k scales it into a band on the same notional.
  const sigma = artifact.portfolioResidualQuantileWad < 0n
    ? -artifact.portfolioResidualQuantileWad
    : artifact.portfolioResidualQuantileWad;
  const kNum = BigInt(Math.round(artifact.noTradeBandK * 1_000_000));
  return (sigma * notionalBase * kNum) / (WAD * 1_000_000n);
}

function movesFrom(current: Map<string, bigint>, target: Map<string, bigint>, input: DecisionInput): Move[] {
  const moves: Move[] = [];
  const ids = [...new Set([...current.keys(), ...target.keys()])].sort();
  for (const id of ids) {
    const delta = (target.get(id) ?? 0n) - (current.get(id) ?? 0n);
    if (delta === 0n) continue;
    const adapter = input.markets.find((m) => m.marketId === id)?.adapter ?? id;
    moves.push({ adapter, amountBase: delta > 0n ? delta : -delta, kind: delta > 0n ? 'deploy' : 'divest' });
  }
  return moves;
}

/** §9.1 - the action rule is G_H > max(C_move, k*sigma), subject to cooldown and turnover. */
export function costGate(
  input: DecisionInput,
  curves: RateCurve[],
  artifact: PolicyArtifact,
  current: Map<string, bigint>,
  target: Map<string, bigint>,
  p: CostParams
): CostGateResult {
  const moves = movesFrom(current, target, input);
  const notional = moves.reduce((s, m) => s + m.amountBase, 0n);
  const { totalBase: moveCostBase, terms } = movementCostBase(input, moves, p);
  const bandBase = noTradeBandBase(input, curves, artifact, notional);

  const gainBase =
    portfolioLowerBound(input, curves, artifact, target) -
    portfolioLowerBound(input, curves, artifact, current);

  const fail = (reason: string): CostGateResult =>
    ({ passed: false, reason, gainBase, moveCostBase, bandBase, terms });

  if (moves.length === 0) return fail('NO_MOVES');

  const last = input.lastAction.timestampSeconds;
  if (last !== null && input.origin.timestampSeconds - last < p.cooldownSeconds) {
    return fail(`COOLDOWN: ${input.origin.timestampSeconds - last}s < ${p.cooldownSeconds}s`);
  }

  const minTurnover = (input.vault.totalAssetsBase * BigInt(p.minTurnoverBps)) / 10_000n;
  if (notional < minTurnover) return fail(`MIN_TURNOVER: ${notional} < ${minTurnover}`);

  const maxTurnover = (input.vault.totalAssetsBase * BigInt(p.maxTurnoverBps)) / 10_000n;
  if (input.lastAction.turnoverWindowBase + notional > maxTurnover) {
    return fail(`MAX_TURNOVER: ${notional} would exceed ${maxTurnover}`);
  }

  const threshold = moveCostBase > bandBase ? moveCostBase : bandBase;
  if (gainBase <= threshold) {
    const which = bandBase >= moveCostBase ? 'NO_TRADE_BAND' : 'MOVE_COST';
    return fail(`${which}: gain ${gainBase} <= threshold ${threshold}`);
  }

  return { passed: true, reason: 'GAIN_EXCEEDS_THRESHOLD', gainBase, moveCostBase, bandBase, terms };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- policy/cost`
Expected: 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/policy/steps/cost.ts test/unit/policy/cost.spec.ts
git commit -m "feat(policy): eleven-term movement cost and P8 no-trade band

Replaces the two-term gate that hardcoded 30 gwei and \$3500 ETH. Costs are
derived from the origin's own gas and oracle observations, including the L1
data term, and the action rule becomes G_H > max(C_move, k*sigma) with
cooldown and turnover limits.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 10: `steps/plan.ts` — staged plan with domain-bound Merkle leaves

Must reproduce the vault's `planDomain` and `hashPlanAction` encodings byte for byte, because Task 14 switches execution to `executeNextActionWithProof`.

**Files:**
- Create: `srcla/src/policy/steps/plan.ts`
- Test: `srcla/test/unit/policy/plan.spec.ts`

**Interfaces:**
- Consumes: `PlanDraft`, `DecisionInput` (Task 2); `buildMerkleTree`, `getMerkleRoot`, `generateMerkleProof` from `src/execution/merkle-utils.js`.
- Produces:
  - `planDomain(chainId, vault, asset, header): string`
  - `hashPlanAction(domain, action): string`
  - `buildPlan(input, target, reserveBase, decisionHash, opts): PlanDraft | null`

Reference encodings from `contract/src/NavyVaultSRCLA.sol`:

```solidity
planDomain   = keccak256(abi.encode(block.chainid, address(this), asset(), keccak256(abi.encode(header))));
hashPlanAction = keccak256(abi.encode(domain, planId, index, kind, adapter, amount, minOut, dataHash));
```

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/policy/plan.spec.ts`:

```ts
import { ethers } from 'ethers';
import { planDomain, hashPlanAction, buildPlan } from '../../../src/policy/steps/plan.js';
import type { DecisionInput, MarketObservation } from '../../../src/policy/types.js';

const HEADER_TUPLE =
  '(uint256 planId,uint64 policyVersion,uint64 createdAt,uint64 expiresAt,uint32 actionCount,' +
  'uint256 snapshotBlockNumber,bytes32 snapshotHash,bytes32 decisionHash,bytes32 configurationDigest,' +
  'uint256 reserve,uint256 minFinalAssets,uint256 maxRecognizedLoss,uint256 turnoverLimit)';

function market(id: string, position: bigint): MarketObservation {
  return {
    marketId: id, adapter: ethers.getAddress(`0x${id.padEnd(40, '0')}`), protocol: 'aave',
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: 10n ** 16n, utilizationWad: 0n,
    positionBase: position, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 10000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
  };
}

function input(markets: MarketObservation[]): DecisionInput {
  return {
    origin: { blockNumber: 12345, blockHash: '0x' + 'ab'.repeat(32), timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n, idleBase: 5_000_000_000n, sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 0,
      paused: false, configurationDigest: '0x' + 'cd'.repeat(32),
    },
    markets, dependencyGroups: [], withdrawals: [],
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: [], lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
  };
}

const OPTS = {
  chainId: 8453,
  vaultAddress: ethers.getAddress('0x' + '11'.repeat(20)),
  assetAddress: ethers.getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
  policyVersion: 5n,
  expirySeconds: 1800,
  snapshotHash: '0x' + 'ef'.repeat(32),
  maxLossBps: 50,
  turnoverLimitBase: 10_000_000_000n,
};

const DECISION_HASH = '0x' + '99'.repeat(32);

describe('encoding parity with NavyVaultSRCLA', () => {
  it('planDomain matches keccak(abi.encode(chainid, vault, asset, keccak(abi.encode(header))))', () => {
    const header = {
      planId: 1n, policyVersion: 5n, createdAt: 100n, expiresAt: 200n, actionCount: 1n,
      snapshotBlockNumber: 12345n, snapshotHash: OPTS.snapshotHash, decisionHash: DECISION_HASH,
      configurationDigest: '0x' + 'cd'.repeat(32),
      reserve: 0n, minFinalAssets: 0n, maxRecognizedLoss: 0n, turnoverLimit: 0n,
    };
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const headerHash = ethers.keccak256(coder.encode([HEADER_TUPLE], [header]));
    const expected = ethers.keccak256(
      coder.encode(['uint256', 'address', 'address', 'bytes32'],
        [OPTS.chainId, OPTS.vaultAddress, OPTS.assetAddress, headerHash])
    );
    expect(planDomain(OPTS.chainId, OPTS.vaultAddress, OPTS.assetAddress, header)).toBe(expected);
  });

  it('hashPlanAction matches keccak(abi.encode(domain, planId, index, kind, adapter, amount, minOut, dataHash))', () => {
    const domain = '0x' + '77'.repeat(32);
    const action = {
      planId: 1n, index: 0, kind: 0 as const,
      adapter: ethers.getAddress('0x' + '22'.repeat(20)),
      amountBase: 1_000_000n, minOutBase: 999_000n, dataHash: ethers.ZeroHash,
    };
    const expected = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'uint256', 'uint32', 'uint8', 'address', 'uint256', 'uint256', 'bytes32'],
        [domain, action.planId, action.index, action.kind, action.adapter, action.amountBase, action.minOutBase, action.dataHash]
      )
    );
    expect(hashPlanAction(domain, action)).toBe(expected);
  });
});

describe('buildPlan', () => {
  it('returns null when the target equals the current allocation', () => {
    const i = input([market('aa', 1_000_000_000n)]);
    expect(buildPlan(i, new Map([['aa', 1_000_000_000n]]), 0n, DECISION_HASH, OPTS)).toBeNull();
  });

  it('orders every divest before every deploy', () => {
    const i = input([market('aa', 2_000_000_000n), market('bb', 0n)]);
    const plan = buildPlan(i, new Map([['aa', 0n], ['bb', 2_000_000_000n]]), 0n, DECISION_HASH, OPTS)!;
    const kinds = plan.actions.map((a) => a.kind);
    expect(kinds).toEqual([1, 0]); // Divest=1 then Deploy=0
  });

  it('never emits a zero snapshotHash (the bug that made every submitPlan revert)', () => {
    const i = input([market('aa', 0n)]);
    const plan = buildPlan(i, new Map([['aa', 1_000_000_000n]]), 0n, DECISION_HASH, OPTS)!;
    expect(plan.header.snapshotHash).not.toBe(ethers.ZeroHash);
    expect(plan.header.snapshotBlockNumber).toBe(12345n);
  });

  it('carries real risk limits, not zeros', () => {
    const i = input([market('aa', 0n)]);
    const plan = buildPlan(i, new Map([['aa', 4_000_000_000n]]), 1_000_000_000n, DECISION_HASH, OPTS)!;
    expect(plan.header.reserve).toBe(1_000_000_000n);
    expect(plan.header.minFinalAssets).toBeGreaterThan(0n);
    expect(plan.header.maxRecognizedLoss).toBeGreaterThan(0n);
    expect(plan.header.turnoverLimit).toBeGreaterThan(0n);
  });

  it('produces a proof that verifies against the root for every action', () => {
    const i = input([market('aa', 2_000_000_000n), market('bb', 0n)]);
    const plan = buildPlan(i, new Map([['aa', 0n], ['bb', 2_000_000_000n]]), 0n, DECISION_HASH, OPTS)!;
    const domain = planDomain(OPTS.chainId, OPTS.vaultAddress, OPTS.assetAddress, plan.header);
    for (const a of plan.actions) {
      let node = hashPlanAction(domain, { ...a, planId: plan.header.planId });
      for (const sib of a.proof) {
        node = node.toLowerCase() <= sib.toLowerCase()
          ? ethers.keccak256(ethers.concat([node, sib]))
          : ethers.keccak256(ethers.concat([sib, node]));
      }
      expect(node).toBe(plan.merkleRoot);
    }
  });

  it('assigns contiguous indices starting at zero', () => {
    const i = input([market('aa', 2_000_000_000n), market('bb', 0n)]);
    const plan = buildPlan(i, new Map([['aa', 0n], ['bb', 2_000_000_000n]]), 0n, DECISION_HASH, OPTS)!;
    expect(plan.actions.map((a) => a.index)).toEqual([0, 1]);
    expect(plan.header.actionCount).toBe(2n);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- policy/plan`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `plan.ts`**

```ts
import { ethers } from 'ethers';
import type { DecisionInput, PlanDraft } from '../types.js';

const HEADER_TUPLE =
  '(uint256 planId,uint64 policyVersion,uint64 createdAt,uint64 expiresAt,uint32 actionCount,' +
  'uint256 snapshotBlockNumber,bytes32 snapshotHash,bytes32 decisionHash,bytes32 configurationDigest,' +
  'uint256 reserve,uint256 minFinalAssets,uint256 maxRecognizedLoss,uint256 turnoverLimit)';

const coder = ethers.AbiCoder.defaultAbiCoder();

export interface BuildPlanOpts {
  chainId: number;
  vaultAddress: string;
  assetAddress: string;
  policyVersion: bigint;
  expirySeconds: number;
  /** Canonical snapshot hash. Must never be zero: submitPlan rejects it. */
  snapshotHash: string;
  maxLossBps: number;
  turnoverLimitBase: bigint;
}

/** Mirrors NavyVaultSRCLA.planDomain exactly. */
export function planDomain(
  chainId: number,
  vault: string,
  asset: string,
  header: PlanDraft['header']
): string {
  const headerHash = ethers.keccak256(coder.encode([HEADER_TUPLE], [header]));
  return ethers.keccak256(
    coder.encode(['uint256', 'address', 'address', 'bytes32'], [chainId, vault, asset, headerHash])
  );
}

/** Mirrors NavyVaultSRCLA.hashPlanAction exactly. */
export function hashPlanAction(
  domain: string,
  action: { planId: bigint; index: number; kind: number; adapter: string; amountBase: bigint; minOutBase: bigint; dataHash: string }
): string {
  return ethers.keccak256(
    coder.encode(
      ['bytes32', 'uint256', 'uint32', 'uint8', 'address', 'uint256', 'uint256', 'bytes32'],
      [domain, action.planId, action.index, action.kind, action.adapter, action.amountBase, action.minOutBase, action.dataHash]
    )
  );
}

function sortedPair(a: string, b: string): [string, string] {
  return a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
}

function merkleLevels(leaves: string[]): string[][] {
  const levels: string[][] = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = current[i + 1] ?? left;
      const [lo, hi] = sortedPair(left, right);
      next.push(ethers.keccak256(ethers.concat([lo, hi])));
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

function proofFor(levels: string[][], index: number): string[] {
  const proof: string[] = [];
  let idx = index;
  for (let level = 0; level < levels.length - 1; level++) {
    const nodes = levels[level]!;
    const sibling = idx % 2 === 0 ? nodes[idx + 1] ?? nodes[idx]! : nodes[idx - 1]!;
    if (nodes.length > 1) proof.push(sibling);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/**
 * §9.5 - a staged plan. Divestment precedes deployment so the vault is never
 * asked to deploy funds it has not yet recovered.
 */
export function buildPlan(
  input: DecisionInput,
  target: Map<string, bigint>,
  reserveBase: bigint,
  decisionHash: string,
  opts: BuildPlanOpts
): PlanDraft | null {
  if (opts.snapshotHash === ethers.ZeroHash) {
    throw new Error('snapshotHash must be non-zero: submitPlan rejects a zero snapshot hash');
  }

  interface Draft { kind: 0 | 1; adapter: string; amountBase: bigint; minOutBase: bigint }
  const divests: Draft[] = [];
  const deploys: Draft[] = [];

  for (const m of [...input.markets].sort((a, b) => (a.marketId < b.marketId ? -1 : 1))) {
    const delta = (target.get(m.marketId) ?? 0n) - m.positionBase;
    if (delta === 0n) continue;
    const amount = delta > 0n ? delta : -delta;
    const minOut = (amount * BigInt(10_000 - opts.maxLossBps)) / 10_000n;
    if (delta < 0n) divests.push({ kind: 1, adapter: m.adapter, amountBase: amount, minOutBase: minOut });
    else deploys.push({ kind: 0, adapter: m.adapter, amountBase: amount, minOutBase: minOut });
  }

  const ordered = [...divests, ...deploys];
  if (ordered.length === 0) return null;

  const planId = BigInt(decisionHash) & ((1n << 255n) - 1n);
  const createdAt = BigInt(input.origin.timestampSeconds);

  const turnover = ordered.reduce((s, a) => s + a.amountBase, 0n);
  const header: PlanDraft['header'] = {
    planId,
    policyVersion: opts.policyVersion,
    createdAt,
    expiresAt: createdAt + BigInt(opts.expirySeconds),
    actionCount: BigInt(ordered.length),
    snapshotBlockNumber: BigInt(input.origin.blockNumber),
    snapshotHash: opts.snapshotHash,
    decisionHash,
    configurationDigest: input.vault.configurationDigest,
    reserve: reserveBase,
    // Worst case the plan may end at: current assets less the allowed loss.
    minFinalAssets:
      input.vault.totalAssetsBase - (turnover * BigInt(opts.maxLossBps)) / 10_000n,
    maxRecognizedLoss: (turnover * BigInt(opts.maxLossBps)) / 10_000n,
    turnoverLimit: opts.turnoverLimitBase,
  };

  const domain = planDomain(opts.chainId, opts.vaultAddress, opts.assetAddress, header);

  const leaves = ordered.map((a, index) =>
    hashPlanAction(domain, {
      planId, index, kind: a.kind, adapter: a.adapter,
      amountBase: a.amountBase, minOutBase: a.minOutBase, dataHash: ethers.ZeroHash,
    })
  );
  const levels = merkleLevels(leaves);
  const merkleRoot = levels[levels.length - 1]![0]!;

  return {
    planId: `0x${planId.toString(16)}`,
    decisionHash,
    merkleRoot,
    actions: ordered.map((a, index) => ({
      index, kind: a.kind, adapter: a.adapter,
      amountBase: a.amountBase, minOutBase: a.minOutBase,
      dataHash: ethers.ZeroHash,
      proof: proofFor(levels, index),
    })),
    header,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- policy/plan`
Expected: 8 tests PASS. The two encoding-parity tests are the ones that matter — if either fails, the on-chain proof will be rejected in Task 14.

- [ ] **Step 5: Commit**

```bash
git add src/policy/steps/plan.ts test/unit/policy/plan.spec.ts
git commit -m "feat(policy): staged plan with domain-bound Merkle leaves

Reproduces NavyVaultSRCLA.planDomain and hashPlanAction byte for byte, orders
divest before deploy, and emits real snapshot hash, reserve, minFinalAssets,
maxRecognizedLoss and turnoverLimit. Throws on a zero snapshotHash, which is
the value that made every submitPlan call revert.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 11: `policy/decide.ts` — compose and hash deterministically

**Files:**
- Create: `srcla/src/policy/decide.ts`
- Modify: `srcla/src/domain/hashing.ts`
- Test: `srcla/test/unit/policy/decide.spec.ts`

**Interfaces:**
- Consumes: every step from Tasks 4–10.
- Produces:
  - `computeCanonicalSnapshotHash(input: DecisionInput): string`
  - `computeDecisionHashV2(parts): string` (added to `hashing.ts`)
  - `decide(input: DecisionInput, artifact: PolicyArtifact, opts: DecideOpts): DecisionOutput`

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/policy/decide.spec.ts`:

```ts
import { decide, computeCanonicalSnapshotHash, DEFAULT_DECIDE_OPTS } from '../../../src/policy/decide.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import type { DecisionInput, MarketObservation, PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

function market(id: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id, adapter: `0x${id.padEnd(40, '0')}`, protocol: 'aave',
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: 0n,
    positionBase: 0n, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 10000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
    ...over,
  };
}

function input(): DecisionInput {
  return {
    origin: { blockNumber: 12345, blockHash: '0x' + 'ab'.repeat(32), timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n, idleBase: 10_000_000_000n, sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 0,
      paused: false, configurationDigest: '0x' + 'cd'.repeat(32),
    },
    markets: [market('aa'), market('bb')], dependencyGroups: [], withdrawals: [],
    gas: { l2BaseFeeWei: 5_000_000n, l1BaseFeeWei: 8_000_000_000n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: Array.from({ length: 40 }, () => ({
      marketId: 'aa', regimeId: 'r1', originSeconds: 1, horizonSeconds: 604_800 as const,
      horizonEndSeconds: 2, availableAtSeconds: 3, realizedReturnWad: WAD, realizedMinCashBase: 1n,
    })),
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
  };
}

function artifact(): PolicyArtifact {
  return {
    ...loadBootstrapArtifact(),
    residualQuantileWadByMarket: { aa: 0n, bb: 0n },
    pinnedConfigDigests: { aa: '0xd', bb: '0xd' },
    noTradeBandK: 0,
  };
}

describe('decide', () => {
  it('is deterministic: identical input and artifact give an identical decision hash', () => {
    const a = decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    const b = decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    expect(a.decisionHash).toBe(b.decisionHash);
  });

  it('changes the decision hash when the artifact changes', () => {
    const a = decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    const changed = { ...artifact(), artifactHash: 'different' };
    expect(decide(input(), changed, DEFAULT_DECIDE_OPTS).decisionHash).not.toBe(a.decisionHash);
  });

  it('changes the decision hash when market state changes', () => {
    const a = decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    const i = input();
    i.markets[0]!.cash = 1n;
    expect(decide(i, artifact(), DEFAULT_DECIDE_OPTS).decisionHash).not.toBe(a.decisionHash);
  });

  it('snapshot hash covers market state, not just totalAssets', () => {
    const i1 = input();
    const i2 = input();
    i2.markets[0]!.borrows = 12345n;
    expect(computeCanonicalSnapshotHash(i1)).not.toBe(computeCanonicalSnapshotHash(i2));
  });

  it('holds when the vault is paused', () => {
    const i = input();
    i.vault.paused = true;
    const out = decide(i, artifact(), DEFAULT_DECIDE_OPTS);
    expect(out.action).toBe('hold');
    expect(out.plan).toBeNull();
  });

  it('holds and explains when no market is admitted', () => {
    const i = input();
    for (const m of i.markets) m.paused = true;
    const out = decide(i, artifact(), DEFAULT_DECIDE_OPTS);
    expect(out.action).toBe('hold');
    expect(out.reasons.some((r) => r.includes('ADMISSION'))).toBe(true);
  });

  it('emits a plan whose header carries a non-zero snapshot hash when it rebalances', () => {
    const out = decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    if (out.action === 'rebalance') {
      expect(out.plan!.header.snapshotHash).toBe(out.snapshotHash.startsWith('0x') ? out.snapshotHash : `0x${out.snapshotHash}`);
    }
  });

  it('does not read the wall clock', () => {
    const spy = jest.spyOn(Date, 'now');
    decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- policy/decide`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the v2 hash to `hashing.ts`**

Append to `src/domain/hashing.ts`:

```ts
/**
 * §10.2 - the decision content hash covers code commit, policy version, model
 * artifact, configuration digest, snapshot, candidates, target, reserve, costs
 * and reasons. The v1 helper above is retained only for reading legacy rows.
 */
export function computeDecisionHashV2(parts: {
  codeCommit: string;
  policyVersion: number;
  artifactHash: string;
  configDigest: string;
  snapshotHash: string;
  originSeconds: number;
  admissionReasons: unknown;
  lowerBounds: unknown;
  reserve: unknown;
  target: unknown;
  enumeration: unknown;
  costs: unknown;
  reasons: unknown;
}): string {
  return hashData(parts);
}
```

- [ ] **Step 4: Implement `decide.ts`**

```ts
import { computeDecisionHashV2, hashData } from '../domain/hashing.js';
import { admit } from './steps/admit.js';
import { simulateCurves } from './steps/simulate.js';
import { forecastMarkets } from './steps/forecast.js';
import { requiredReserve } from './steps/reserve.js';
import { optimize, type OptimizeOpts } from './steps/optimize.js';
import { costGate, type CostParams } from './steps/cost.js';
import { buildPlan, type BuildPlanOpts } from './steps/plan.js';
import type { DecisionInput, DecisionOutput, PolicyArtifact } from './types.js';

export interface DecideOpts {
  codeCommit: string;
  quantumBase: bigint;
  maxCurvePoints: number;
  reserveQuantile: number;
  reserveHorizonSeconds: number;
  cost: CostParams;
  plan: Omit<BuildPlanOpts, 'snapshotHash'>;
  disable?: OptimizeOpts['disable'];
}

export const DEFAULT_DECIDE_OPTS: DecideOpts = {
  codeCommit: 'dev',
  quantumBase: 1_000_000_000n,
  maxCurvePoints: 16,
  reserveQuantile: 0.95,
  reserveHorizonSeconds: 86_400,
  cost: {
    cooldownSeconds: 3600, minTurnoverBps: 10, maxTurnoverBps: 5000,
    slippageBps: 5, mevBps: 1, impactBps: 2, failureRateBps: 50, bufferBps: 100,
    gasPerAction: 250_000n, l1BytesPerAction: 2_000n,
  },
  plan: {
    chainId: 8453,
    vaultAddress: '0x0000000000000000000000000000000000000001',
    assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    policyVersion: 5n, expirySeconds: 1800, maxLossBps: 50,
    turnoverLimitBase: 10n ** 13n,
  },
};

/**
 * §10.1 - the snapshot hash covers the canonical raw-integer snapshot. The
 * previous implementation hashed totalAssets as the market id and hardcoded
 * rate and utilisation to zero, so distinct market states collided.
 */
export function computeCanonicalSnapshotHash(input: DecisionInput): string {
  return hashData({
    blockNumber: input.origin.blockNumber,
    blockHash: input.origin.blockHash,
    timestampSeconds: input.origin.timestampSeconds,
    vault: input.vault,
    markets: input.markets,
    dependencyGroups: input.dependencyGroups,
    gas: input.gas,
  });
}

/**
 * The single SRCLA decision. Pure: no I/O, no wall clock, no randomness.
 * The live driver and the evaluation replay both call this, which is what makes
 * §11.1's equal-information requirement structurally true.
 */
export function decide(
  input: DecisionInput,
  artifact: PolicyArtifact,
  opts: DecideOpts
): DecisionOutput {
  const reasons: string[] = [];
  const snapshotHash = computeCanonicalSnapshotHash(input);

  const current = new Map<string, bigint>(input.markets.map((m) => [m.marketId, m.positionBase]));

  const finish = (partial: Partial<DecisionOutput>): DecisionOutput => {
    const base: DecisionOutput = {
      snapshotHash,
      decisionHash: '',
      admission: partial.admission ?? { eligible: [], reasons: [] },
      curves: partial.curves ?? [],
      lowerBounds: partial.lowerBounds ?? [],
      reserve: partial.reserve ?? {
        requiredBase: 0n, floorBase: 0n, netDemandQuantileBase: 0n,
        stressShortfallBase: 0n, scenarioFeasible: [],
      },
      target: partial.target ?? current,
      enumeration: partial.enumeration ?? null,
      costGate: partial.costGate ?? {
        passed: false, reason: 'NOT_EVALUATED', gainBase: 0n,
        moveCostBase: 0n, bandBase: 0n, terms: {},
      },
      plan: partial.plan ?? null,
      action: partial.action ?? 'hold',
      reasons,
    };
    base.decisionHash = computeDecisionHashV2({
      codeCommit: opts.codeCommit,
      policyVersion: artifact.policyVersion,
      artifactHash: artifact.artifactHash,
      configDigest: artifact.configDigest,
      snapshotHash,
      originSeconds: input.origin.timestampSeconds,
      admissionReasons: base.admission.reasons,
      lowerBounds: base.lowerBounds,
      reserve: base.reserve,
      target: [...base.target.entries()].sort(),
      enumeration: base.enumeration,
      costs: base.costGate.terms,
      reasons: base.reasons,
    });
    return base;
  };

  if (input.vault.paused) {
    reasons.push('VAULT_PAUSED');
    return finish({});
  }

  const admission = admit(input, artifact);
  if (admission.eligible.length === 0) {
    reasons.push('ADMISSION_EMPTY');
    return finish({ admission });
  }

  const curves = simulateCurves(input, admission.eligible, opts.quantumBase, opts.maxCurvePoints);
  const lowerBounds = forecastMarkets(input, curves, artifact);

  const { target, enumeration } = optimize(input, curves, artifact, {
    quantumBase: opts.quantumBase,
    reserveQuantile: opts.reserveQuantile,
    reserveHorizonSeconds: opts.reserveHorizonSeconds,
    disable: opts.disable,
  });

  const reserve = requiredReserve(input, target, {
    quantile: opts.reserveQuantile,
    horizonSeconds: opts.reserveHorizonSeconds,
  });

  const gate = costGate(input, curves, artifact, current, target, opts.cost);
  if (!gate.passed) {
    reasons.push(`COST_GATE: ${gate.reason}`);
    return finish({ admission, curves, lowerBounds, reserve, target, enumeration, costGate: gate });
  }

  const plan = buildPlan(input, target, reserve.requiredBase, '0x' + '00'.repeat(31) + '01', {
    ...opts.plan,
    snapshotHash: `0x${snapshotHash}`,
  });

  if (plan === null) {
    reasons.push('NO_ACTIONS');
    return finish({ admission, curves, lowerBounds, reserve, target, enumeration, costGate: gate });
  }

  reasons.push('REBALANCE');
  const out = finish({
    admission, curves, lowerBounds, reserve, target, enumeration,
    costGate: gate, plan, action: 'rebalance',
  });

  // The plan commits to the decision hash, so it is rebuilt once the hash exists.
  out.plan = buildPlan(input, target, reserve.requiredBase, `0x${out.decisionHash}`, {
    ...opts.plan,
    snapshotHash: `0x${snapshotHash}`,
  });
  return out;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test:unit -- policy && pnpm exec tsc --noEmit`
Expected: every `test/unit/policy/*.spec.ts` PASS.

Note: `computeCanonicalSnapshotHash` returns a bare hex digest from `hashData` (SHA-256, no `0x`), so `decide` prefixes it when handing it to `buildPlan`. Keep that consistent — the vault only needs a non-zero `bytes32`.

- [ ] **Step 6: Commit**

```bash
git add src/policy/decide.ts src/domain/hashing.ts test/unit/policy/decide.spec.ts
git commit -m "feat(policy): compose the decision kernel with a deterministic hash

decide() is pure and the decision hash now covers the paper's full 10.2 list.
The snapshot hash covers real market state instead of stuffing totalAssets
into marketId with rate and utilisation hardcoded to zero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 12: Prisma schema — raw IRM fields and decision provenance

**Files:**
- Modify: `srcla/prisma/schema.prisma`
- Test: `srcla/test/integration/policy-persistence.spec.ts`

**Interfaces:**
- Consumes: `DecisionOutput` (Task 11).
- Produces: `MarketSnapshot` raw IRM columns; models `CandidateAllocation`, `StressCalculation`, `EnumerationResult`, `RejectionReason`, `SubmissionReceipt`, `Incident`; `ForecastLabel` provenance columns.

- [ ] **Step 1: Add the raw IRM columns to `MarketSnapshot`**

The simulators need protocol state, not derived rates. Add inside `model MarketSnapshot`:

```prisma
  // Raw protocol state in native integer units (paper §10.1).
  cashBase          String?
  borrowsBase       String?
  reservesBase      String?
  // Compound III
  cometSupplyBase   String?
  cometBorrowBase   String?
  // Aave V3
  aaveVirtualBalBase String?
  aaveDebtBase       String?
  aaveDeficitBase    String?
  aaveReserveFactorBps Int?
  // Moonwell
  mwExchangeRate    String?
  // Provenance
  regimeId          String?
  qualityFlags      String?
```

- [ ] **Step 2: Add provenance to `ForecastLabel`**

Add inside `model ForecastLabel`:

```prisma
  horizonEndsAt     DateTime?
  availableAt       DateTime?
  regimeId          String?
  realizedReturnWad String?
  realizedMinCashBase String?
```

- [ ] **Step 3: Add the new models**

Append to `schema.prisma`:

```prisma
model CandidateAllocation {
  id           String   @id @default(cuid())
  decisionHash String
  marketId     String
  amountBase   String
  lowerBoundWad String
  exitableBps  Int
  createdAt    DateTime @default(now())

  @@index([decisionHash])
}

model StressCalculation {
  id            String   @id @default(cuid())
  decisionHash  String
  scenario      String
  demandBase    String
  exitsBase     String
  shortfallBase String
  feasible      Boolean
  createdAt     DateTime @default(now())

  @@index([decisionHash])
}

model EnumerationResult {
  id           String   @id @default(cuid())
  decisionHash String   @unique
  enumerated   Int
  regretBps    String
  passed       Boolean
  createdAt    DateTime @default(now())
}

model RejectionReason {
  id           String   @id @default(cuid())
  decisionHash String
  marketId     String
  code         String
  passed       Boolean
  detail       String
  createdAt    DateTime @default(now())

  @@index([decisionHash])
}

model SubmissionReceipt {
  id            String   @id @default(cuid())
  planId        String
  actionIndex   Int
  txHash        String?
  sender        String
  nonce         Int
  status        String
  balanceDeltas String?
  error         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([planId, actionIndex])
  @@index([txHash])
}

model Incident {
  id         String   @id @default(cuid())
  kind       String
  marketId   String?
  detail     String
  detectedAt DateTime @default(now())

  @@index([kind])
}
```

- [ ] **Step 4: Push the schema and regenerate**

Run: `DATABASE_URL=postgresql://user:password@localhost:5433/srcla pnpm prisma:push && pnpm prisma:generate`
Expected: schema applied, client regenerated. If the srcla Postgres on `:5433` is not running, start it first — there is no compose file in `srcla/`.

- [ ] **Step 5: Write the round-trip test**

Create `srcla/test/integration/policy-persistence.spec.ts`:

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const HASH = `test-${Date.now()}`;

afterAll(async () => {
  await prisma.rejectionReason.deleteMany({ where: { decisionHash: HASH } });
  await prisma.stressCalculation.deleteMany({ where: { decisionHash: HASH } });
  await prisma.candidateAllocation.deleteMany({ where: { decisionHash: HASH } });
  await prisma.enumerationResult.deleteMany({ where: { decisionHash: HASH } });
  await prisma.$disconnect();
});

describe('decision provenance persistence', () => {
  it('stores and reads back candidates, stress rows, enumeration and reasons', async () => {
    await prisma.candidateAllocation.create({
      data: { decisionHash: HASH, marketId: 'aa', amountBase: '1000', lowerBoundWad: '5', exitableBps: 10000 },
    });
    await prisma.stressCalculation.create({
      data: { decisionHash: HASH, scenario: 'w50', demandBase: '500', exitsBase: '400', shortfallBase: '100', feasible: false },
    });
    await prisma.enumerationResult.create({
      data: { decisionHash: HASH, enumerated: 120, regretBps: '3', passed: true },
    });
    await prisma.rejectionReason.create({
      data: { decisionHash: HASH, marketId: 'bb', code: 'PAUSED', passed: false, detail: 'market paused' },
    });

    expect(await prisma.candidateAllocation.count({ where: { decisionHash: HASH } })).toBe(1);
    expect((await prisma.enumerationResult.findUnique({ where: { decisionHash: HASH } }))!.regretBps).toBe('3');
    expect((await prisma.stressCalculation.findFirst({ where: { decisionHash: HASH } }))!.feasible).toBe(false);
  });
});
```

- [ ] **Step 6: Run it**

Run: `DATABASE_URL=postgresql://user:password@localhost:5433/srcla pnpm test:integration -- policy-persistence`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma test/integration/policy-persistence.spec.ts
git commit -m "feat(db): raw IRM snapshot columns and decision provenance models

MarketSnapshot gains the protocol state the simulators need rather than only
derived supplyRate/utilization, and the decision's candidates, stress rows,
enumeration regret, rejection reasons and submission receipts become
first-class per paper 10.2.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 13: Rewire the scheduler; delete the stubs and dead barrels

**Files:**
- Modify: `srcla/src/runtime/scheduler.ts` (replace `runController` and delete `generateDecision`)
- Create: `srcla/src/runtime/decision-driver.ts`
- Delete: `srcla/src/controller/controller.ts`, `srcla/src/policy-engine/index.ts`, `srcla/src/market-engine/index.ts`, `srcla/src/evaluation-engine/index.ts`, `srcla/src/runtime/index.ts`
- Test: `srcla/test/integration/decision-driver.spec.ts`

**Interfaces:**
- Consumes: `decide`, `DEFAULT_DECIDE_OPTS` (Task 11); `buildDecisionInput` (Task 3); `SnapshotCollector`.
- Produces: `class DecisionDriver { async runCycle(): Promise<DecisionOutput | null> }`

- [ ] **Step 1: Write the failing test**

Create `srcla/test/integration/decision-driver.spec.ts`:

```ts
import { DecisionDriver } from '../../src/runtime/decision-driver.js';
import { loadBootstrapArtifact } from '../../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../../src/policy/decide.js';

const WAD = 10n ** 18n;

const rawOrigin = {
  origin: { blockNumber: 1, blockHash: '0x' + 'ab'.repeat(32), timestampSeconds: 1_000_000, finalized: true as const },
  vault: {
    totalAssetsBase: 10_000_000_000n, idleBase: 10_000_000_000n, sharesOutstanding: 10n ** 10n,
    adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 0, paused: false,
    configurationDigest: '0x' + 'cd'.repeat(32),
  },
  markets: [{
    marketId: 'aa', adapter: '0x' + 'aa'.repeat(20), protocol: 'aave' as const,
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: 0n,
    positionBase: 0n, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 10000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
  }],
  dependencyGroups: [], withdrawals: [],
  gas: { l2BaseFeeWei: 5_000_000n, l1BaseFeeWei: 8_000_000_000n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
  allLabels: Array.from({ length: 40 }, () => ({
    marketId: 'aa', regimeId: 'r1', originSeconds: 1, horizonSeconds: 604_800 as const,
    horizonEndSeconds: 2, availableAtSeconds: 3, realizedReturnWad: WAD, realizedMinCashBase: 1n,
  })),
  lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
};

describe('DecisionDriver', () => {
  it('returns null when the origin source yields nothing', async () => {
    const driver = new DecisionDriver({
      loadOrigin: async () => null,
      artifact: { ...loadBootstrapArtifact(), pinnedConfigDigests: { aa: '0xd' } },
      opts: DEFAULT_DECIDE_OPTS,
      persist: async () => {},
    });
    expect(await driver.runCycle()).toBeNull();
  });

  it('produces a decision with a stable hash across two identical cycles', async () => {
    const persisted: string[] = [];
    const driver = new DecisionDriver({
      loadOrigin: async () => rawOrigin,
      artifact: { ...loadBootstrapArtifact(), pinnedConfigDigests: { aa: '0xd' }, residualQuantileWadByMarket: { aa: 0n } },
      opts: DEFAULT_DECIDE_OPTS,
      persist: async (out) => { persisted.push(out.decisionHash); },
    });
    const a = await driver.runCycle();
    const b = await driver.runCycle();
    expect(a!.decisionHash).toBe(b!.decisionHash);
    expect(persisted).toHaveLength(2);
  });

  it('routes history through the look-ahead barrier', async () => {
    const withFuture = {
      ...rawOrigin,
      allLabels: [...rawOrigin.allLabels, {
        marketId: 'aa', regimeId: 'r1', originSeconds: 1, horizonSeconds: 604_800 as const,
        horizonEndSeconds: 2_000_000, availableAtSeconds: 2_000_000,
        realizedReturnWad: WAD * 1000n, realizedMinCashBase: 1n,
      }],
    };
    const artifact = { ...loadBootstrapArtifact(), pinnedConfigDigests: { aa: '0xd' }, residualQuantileWadByMarket: { aa: 0n } };
    const clean = new DecisionDriver({ loadOrigin: async () => rawOrigin, artifact, opts: DEFAULT_DECIDE_OPTS, persist: async () => {} });
    const dirty = new DecisionDriver({ loadOrigin: async () => withFuture, artifact, opts: DEFAULT_DECIDE_OPTS, persist: async () => {} });
    expect((await dirty.runCycle())!.decisionHash).toBe((await clean.runCycle())!.decisionHash);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:integration -- decision-driver`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `decision-driver.ts`**

```ts
import { buildDecisionInput, type RawOrigin } from '../policy/input.js';
import { decide, type DecideOpts } from '../policy/decide.js';
import type { DecisionOutput, PolicyArtifact } from '../policy/types.js';

export interface DecisionDriverDeps {
  loadOrigin: () => Promise<RawOrigin | null>;
  artifact: PolicyArtifact;
  opts: DecideOpts;
  persist: (out: DecisionOutput) => Promise<void>;
}

/**
 * The live driver. It collects, calls decide(), and persists. It contains no
 * allocation logic of its own — that is the point. The evaluation replay is the
 * other driver, and both construct their input through buildDecisionInput so
 * neither can observe the future.
 */
export class DecisionDriver {
  constructor(private readonly deps: DecisionDriverDeps) {}

  async runCycle(): Promise<DecisionOutput | null> {
    const raw = await this.deps.loadOrigin();
    if (raw === null) return null;

    const input = buildDecisionInput(raw, this.deps.artifact);
    const output = decide(input, this.deps.artifact, this.deps.opts);
    await this.deps.persist(output);
    return output;
  }
}
```

Then add the collector adapter in the same file — Task 16 imports it:

```ts
import type { SnapshotCollector } from '../collector/snapshot-collector.js';
import type { PrismaClient } from '@prisma/client';
import type { CompletedLabel, MarketObservation } from '../policy/types.js';

const PROTOCOL_BY_NAME: Record<string, MarketObservation['protocol']> = {
  aave: 'aave', compound: 'compound', moonwell: 'moonwell',
};

function protocolOf(name: string): MarketObservation['protocol'] {
  const key = Object.keys(PROTOCOL_BY_NAME).find((k) => name.toLowerCase().includes(k));
  if (!key) throw new Error(`cannot classify strategy "${name}" as a known protocol`);
  return PROTOCOL_BY_NAME[key]!;
}

/**
 * Adapter from a collected finalised snapshot to the unfiltered RawOrigin.
 * It does no filtering of its own — buildDecisionInput owns the barrier.
 */
export async function buildRawOriginFromCollector(
  collector: SnapshotCollector,
  prisma: PrismaClient,
  gas: RawOrigin['gas'],
  chainConfigDigests: Record<string, string>
): Promise<RawOrigin | null> {
  const snap = await collector.collect();
  if (snap === null) return null;

  const markets: MarketObservation[] = snap.strategies.map((s) => ({
    marketId: s.name,
    adapter: s.address,
    protocol: protocolOf(s.name),
    cash: s.cash,
    borrows: 0n,
    reserves: 0n,
    supplyRateWad: s.supplyRate,
    utilizationWad: s.utilization,
    positionBase: s.totalAssets,
    maxDeployableBase: s.maxWithdrawable,
    maxWithdrawableBase: s.maxWithdrawable,
    configDigest: s.configDigest,
    regimeId: chainConfigDigests[s.name] ?? s.configDigest,
    paused: s.paused,
    capBps: 5000,
    absoluteCapBase: snap.vault.totalAssets,
    maxLossBps: 50,
    dependencyGroupIds: [],
  }));

  const rows = await prisma.forecastLabel.findMany({
    where: { horizonEndsAt: { not: null }, availableAt: { not: null } },
    orderBy: { horizonEndsAt: 'asc' },
    take: 5000,
  });

  const allLabels: CompletedLabel[] = rows.map((r) => ({
    marketId: r.marketId,
    regimeId: r.regimeId ?? 'unknown',
    originSeconds: Math.floor(r.createdAt.getTime() / 1000),
    horizonSeconds: 604_800,
    horizonEndSeconds: Math.floor(r.horizonEndsAt!.getTime() / 1000),
    availableAtSeconds: Math.floor(r.availableAt!.getTime() / 1000),
    realizedReturnWad: BigInt(r.realizedReturnWad ?? '0'),
    realizedMinCashBase: BigInt(r.realizedMinCashBase ?? '0'),
  }));

  const withdrawals = (
    await prisma.withdrawalEvent.findMany({ orderBy: { timestamp: 'asc' }, take: 5000 })
  ).map((w) => ({
    timestampSeconds: Math.floor(w.timestamp.getTime() / 1000),
    assetsBase: BigInt(w.assetsBase ?? '0'),
  }));

  return {
    origin: {
      blockNumber: snap.blockNumber,
      blockHash: snap.blockHash,
      timestampSeconds: Math.floor(snap.timestamp.getTime() / 1000),
      finalized: true,
    },
    vault: {
      totalAssetsBase: snap.vault.totalAssets,
      idleBase: snap.vault.idleBase,
      sharesOutstanding: snap.vault.totalAssets,
      adminReserveBase: snap.vault.reserves?.admin ?? 0n,
      dynamicReserveBase: snap.vault.reserves?.dynamic ?? 0n,
      minIdleBps: Number(snap.vault.minIdleBps),
      paused: snap.vault.paused,
      configurationDigest: chainConfigDigests['vault'] ?? '0x',
    },
    markets,
    dependencyGroups: [],
    withdrawals,
    gas,
    allLabels,
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
  };
}
```

Field names on `snap.strategies[]` and `snap.vault` come from `src/collector/types.ts`; if any differ, follow that file rather than this snippet — the shape is the contract, not the spelling.

- [ ] **Step 4: Replace the scheduler's controller path**

In `src/runtime/scheduler.ts`: delete `generateDecision` and `applyColdStartConstraints` entirely, and replace the body of `runController` with a call into `DecisionDriver`, keeping the existing `keeperExecutor` wiring for Task 14:

```ts
  private async runController(): Promise<void> {
    if (!this.decisionDriver) {
      console.log('[Scheduler] No decision driver configured; skipping cycle');
      return;
    }
    try {
      const out = await this.decisionDriver.runCycle();
      if (out === null) {
        console.log('[Scheduler] No finalized origin available');
        return;
      }
      console.log(`[Scheduler] decision ${out.decisionHash} action=${out.action} reasons=${out.reasons.join('; ')}`);

      if (out.action === 'rebalance' && out.plan && this.keeperExecutor) {
        const result = await this.keeperExecutor.executePlanDraft(out.plan);
        console.log(
          result.success
            ? `[Scheduler] plan ${out.plan.planId} executed: ${result.txHashes.join(', ')}`
            : `[Scheduler] plan ${out.plan.planId} failed: ${result.errors.join('; ')}`
        );
      }
    } catch (error) {
      console.error('[Scheduler] Controller error:', error);
    }
  }
```

Add `private decisionDriver: DecisionDriver | null = null;` and a `setDecisionDriver()` used by `src/index.ts`.

- [ ] **Step 5: Delete the dead code**

```bash
git rm src/controller/controller.ts src/policy-engine/index.ts src/market-engine/index.ts src/evaluation-engine/index.ts src/runtime/index.ts
git rm test/integration/controller.spec.ts
```

Then remove `src/optimizer/index.ts` and `src/decision/index.ts` **only if** `grep -rn "optimizer/index\|decision/index" src test` returns nothing.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; `test/integration/decision-driver.spec.ts` PASS. Existing suites that imported `SrclaController` must be deleted or ported — do not leave them skipped.

- [ ] **Step 7: Commit**

```bash
git add -A src test
git commit -m "refactor(runtime): run the decision kernel, delete the heuristic and dead barrels

The scheduler's hardcoded generateDecision (highest lower bound, 5% idle
threshold, 80% target, 10% divest, 100 USDC drift) is replaced by
DecisionDriver -> decide(). Removes SrclaController and the five barrel
modules that nothing imported.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 14: `KeeperExecutor` — real headers and the domain-bound proof path

Closes E1 (every `submitPlan` reverts on a zero snapshot hash), E2 (weak `executeAction` path) and E3 (zeroed risk limits).

**Files:**
- Modify: `srcla/src/execution/keeper-executor.ts`
- Modify: `srcla/src/execution/executor.ts` (add the `executeNextActionWithProof` ABI entry and method)
- Test: `srcla/test/unit/execution/keeper-plan-draft.spec.ts`

**Interfaces:**
- Consumes: `PlanDraft` (Task 2), `planDomain`, `hashPlanAction` (Task 10).
- Produces: `KeeperExecutor.executePlanDraft(draft: PlanDraft): Promise<KeeperExecutionResult>`; `PlanExecutor.executeNextActionWithProof(proof: string[], action): Promise<ExecutionResult>`.

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/execution/keeper-plan-draft.spec.ts`:

```ts
import { ethers } from 'ethers';
import { KeeperExecutor } from '../../../src/execution/keeper-executor.js';
import type { PlanDraft } from '../../../src/policy/types.js';

function draft(over: Partial<PlanDraft['header']> = {}): PlanDraft {
  const header: PlanDraft['header'] = {
    planId: 42n, policyVersion: 5n, createdAt: 1_000_000n, expiresAt: 1_001_800n,
    actionCount: 1n, snapshotBlockNumber: 12345n,
    snapshotHash: '0x' + 'ef'.repeat(32), decisionHash: '0x' + '99'.repeat(32),
    configurationDigest: '0x' + 'cd'.repeat(32),
    reserve: 1_000_000n, minFinalAssets: 9_000_000n, maxRecognizedLoss: 5_000n,
    turnoverLimit: 10_000_000n, ...over,
  };
  return {
    planId: '0x2a', decisionHash: header.decisionHash, merkleRoot: '0x' + '01'.repeat(32),
    actions: [{ index: 0, kind: 0, adapter: '0x' + 'aa'.repeat(20), amountBase: 1_000_000n, minOutBase: 999_000n, dataHash: ethers.ZeroHash, proof: [] }],
    header,
  };
}

describe('KeeperExecutor.executePlanDraft preflight', () => {
  const keeper = () => new KeeperExecutor({
    keeperPrivateKey: '0x' + '11'.repeat(32),
    vaultAddress: '0x' + '22'.repeat(20),
    rpcUrl: 'http://127.0.0.1:8545',
    chainId: 8453,
  });

  it('refuses a draft whose snapshot hash is zero', async () => {
    const r = await keeper().executePlanDraft(draft({ snapshotHash: ethers.ZeroHash }));
    expect(r.success).toBe(false);
    expect(r.errors.join(' ')).toMatch(/snapshotHash/i);
  });

  it('refuses a draft whose decision hash is zero', async () => {
    const r = await keeper().executePlanDraft(draft({ decisionHash: ethers.ZeroHash }));
    expect(r.success).toBe(false);
    expect(r.errors.join(' ')).toMatch(/decisionHash/i);
  });

  it('refuses a draft whose actionCount disagrees with the action list', async () => {
    const r = await keeper().executePlanDraft(draft({ actionCount: 5n }));
    expect(r.success).toBe(false);
    expect(r.errors.join(' ')).toMatch(/actionCount/i);
  });

  it('refuses a draft that has already expired at the given origin', async () => {
    const r = await keeper().executePlanDraft(draft({ expiresAt: 1n }));
    expect(r.success).toBe(false);
    expect(r.errors.join(' ')).toMatch(/expire/i);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- keeper-plan-draft`
Expected: FAIL — `executePlanDraft` is not a function.

- [ ] **Step 3: Add the proof-path ABI and method to `executor.ts`**

Add to the ABI array near `'function executeAction(...)'`:

```ts
  'function executeNextActionWithProof(bytes32[] merkleProof, (uint256 planId,uint32 index,uint8 kind,address adapter,uint256 amount,uint256 minOut,bytes32 dataHash) action)',
  'function cancelPlan()',
  'function activePlanId() view returns (bytes32)',
  'function activePlanExpiresAt() view returns (uint64)',
```

Add the method:

```ts
  /**
   * §9.5 — the only fund-moving path. Unlike executeAction it rechecks the
   * configuration digest, enforces the plan's risk limits, accounts turnover,
   * completes the plan and activates the dynamic reserve.
   */
  async executeNextActionWithProof(
    proof: string[],
    action: { planId: bigint; index: number; kind: number; adapter: string; amount: bigint; minOut: bigint; dataHash: string }
  ): Promise<ExecutionResult> {
    try {
      const data = this.iface.encodeFunctionData('executeNextActionWithProof', [
        proof,
        [action.planId, action.index, action.kind, action.adapter, action.amount, action.minOut, action.dataHash],
      ]);
      const tx = await this.wallet.sendTransaction({ to: this.vaultAddress, data });
      const receipt = await tx.wait();
      return { success: receipt?.status === 1, txHash: tx.hash };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
```

- [ ] **Step 4: Add `executePlanDraft` to `keeper-executor.ts`**

```ts
import type { PlanDraft } from '../policy/types.js';

  /**
   * Submit and execute a plan produced by the decision kernel.
   *
   * Every field the vault validates comes from the draft. The previous
   * implementation hardcoded snapshotHash to ZeroHash, which submitPlan
   * rejects with InvalidPlan — so no plan ever executed.
   */
  async executePlanDraft(draft: PlanDraft): Promise<KeeperExecutionResult> {
    const errors: string[] = [];
    const ZERO = '0x' + '00'.repeat(32);

    if (draft.header.snapshotHash === ZERO) errors.push('header.snapshotHash is zero; submitPlan would revert InvalidPlan');
    if (draft.header.decisionHash === ZERO) errors.push('header.decisionHash is zero; submitPlan would revert InvalidPlan');
    if (draft.header.actionCount !== BigInt(draft.actions.length)) {
      errors.push(`header.actionCount ${draft.header.actionCount} != ${draft.actions.length} actions`);
    }
    if (draft.header.expiresAt <= draft.header.createdAt) errors.push('plan already expired: expiresAt <= createdAt');
    if (errors.length > 0) return { success: false, txHashes: [], errors };

    // A wedged active plan blocks every later submitPlan; clear it first.
    const active = await this.executor.getActivePlanId();
    if (active && active !== ZERO) {
      const cancelled = await this.executor.cancelPlan();
      if (!cancelled.success) {
        return { success: false, txHashes: [], errors: [`stale plan ${active} could not be cancelled: ${cancelled.error}`] };
      }
    }

    const submit = await this.executor.submitPlan(draft.header, draft.merkleRoot);
    if (!submit.success) return { success: false, txHashes: [], errors: [`submitPlan failed: ${submit.error}`] };

    const txHashes: string[] = submit.txHash ? [submit.txHash] : [];
    for (const a of draft.actions) {
      const r = await this.executor.executeNextActionWithProof(a.proof, {
        planId: draft.header.planId, index: a.index, kind: a.kind,
        adapter: a.adapter, amount: a.amountBase, minOut: a.minOutBase, dataHash: a.dataHash,
      });
      if (r.txHash) txHashes.push(r.txHash);
      if (!r.success) {
        // §9.5 — a failed divestment stops the plan.
        return { success: false, txHashes, errors: [`action ${a.index} failed: ${r.error}`], planId: draft.planId };
      }
    }

    return { success: true, txHashes, errors: [], planId: draft.planId };
  }
```

Add `getActivePlanId()` to `PlanExecutor` returning `activePlanId()`.

- [ ] **Step 5: Delete the broken single-action path**

Remove `executeSingleActionPlan` and route `executeAction` for deploy/divest to an error directing callers to `executePlanDraft`. Remove the `merkle-utils.ts` packed-leaf helpers now that Task 10 owns leaf construction, unless `grep -rn "hashActionLeaf" src test` shows other users.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm test:unit -- keeper-plan-draft && pnpm exec tsc --noEmit`
Expected: 4 tests PASS (all preflight rejections happen before any RPC call, so no node is needed).

- [ ] **Step 7: Commit**

```bash
git add src/execution/keeper-executor.ts src/execution/executor.ts test/unit/execution/keeper-plan-draft.spec.ts
git commit -m "fix(execution): real plan headers and the domain-bound proof path

Fixes the bug that made every rebalance revert: headers carried
snapshotHash: ZeroHash, which submitPlan rejects with InvalidPlan. Switches
from the weak executeAction path to executeNextActionWithProof, which rechecks
the configuration digest, enforces plan risk limits, accounts turnover and
activates the dynamic reserve. Cancels a wedged active plan before submitting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 15: The §10.3 submission loop

**Files:**
- Create: `srcla/src/execution/submission-loop.ts`
- Test: `srcla/test/unit/execution/submission-loop.spec.ts`

**Interfaces:**
- Consumes: `PlanDraft` (Task 2); `SubmissionReceipt` model (Task 12).
- Produces: `runSubmissionLoop(draft, deps): Promise<{ completed: number; stoppedAt: number | null; errors: string[] }>` with `deps: { acquireLock, persistIntent, verifyChain, simulate, submit, reconcile, releaseLock }`.

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/execution/submission-loop.spec.ts`:

```ts
import { runSubmissionLoop } from '../../../src/execution/submission-loop.js';
import type { PlanDraft } from '../../../src/policy/types.js';

function draft(n: number): PlanDraft {
  return {
    planId: '0x2a', decisionHash: '0x99', merkleRoot: '0x01',
    actions: Array.from({ length: n }, (_, i) => ({
      index: i, kind: 0 as const, adapter: '0xaa',
      amountBase: 1_000_000n, minOutBase: 999_000n, dataHash: '0x00', proof: [],
    })),
    header: {
      planId: 42n, policyVersion: 5n, createdAt: 0n, expiresAt: 10n, actionCount: BigInt(n),
      snapshotBlockNumber: 1n, snapshotHash: '0xef', decisionHash: '0x99', configurationDigest: '0xcd',
      reserve: 0n, minFinalAssets: 0n, maxRecognizedLoss: 0n, turnoverLimit: 0n,
    },
  };
}

function deps(over: Partial<Parameters<typeof runSubmissionLoop>[1]> = {}) {
  const calls: string[] = [];
  const base = {
    acquireLock: async () => { calls.push('lock'); return true; },
    persistIntent: async (_p: string, i: number) => { calls.push(`persist:${i}`); },
    verifyChain: async () => { calls.push('verify'); return { ok: true as const }; },
    simulate: async (_p: string, i: number) => { calls.push(`sim:${i}`); return { ok: true as const }; },
    submit: async (_p: string, i: number) => { calls.push(`submit:${i}`); return { ok: true as const, txHash: `0x${i}` }; },
    reconcile: async (_p: string, i: number) => { calls.push(`recon:${i}`); return { ok: true as const }; },
    releaseLock: async () => { calls.push('unlock'); },
    ...over,
  };
  return { deps: base, calls };
}

describe('runSubmissionLoop', () => {
  it('refuses to start when the lock is held', async () => {
    const { deps: d } = deps({ acquireLock: async () => false });
    const r = await runSubmissionLoop(draft(2), d);
    expect(r.completed).toBe(0);
    expect(r.errors.join(' ')).toMatch(/lock/i);
  });

  it('persists intent before submitting, for every action', async () => {
    const { deps: d, calls } = deps();
    await runSubmissionLoop(draft(2), d);
    expect(calls.indexOf('persist:0')).toBeLessThan(calls.indexOf('submit:0'));
    expect(calls.indexOf('persist:1')).toBeLessThan(calls.indexOf('submit:1'));
  });

  it('simulates before submitting each action', async () => {
    const { deps: d, calls } = deps();
    await runSubmissionLoop(draft(1), d);
    expect(calls.indexOf('sim:0')).toBeLessThan(calls.indexOf('submit:0'));
  });

  it('submits exactly one action at a time and reconciles each', async () => {
    const { deps: d, calls } = deps();
    const r = await runSubmissionLoop(draft(3), d);
    expect(r.completed).toBe(3);
    expect(calls.filter((c) => c.startsWith('submit:'))).toEqual(['submit:0', 'submit:1', 'submit:2']);
    expect(calls.filter((c) => c.startsWith('recon:'))).toEqual(['recon:0', 'recon:1', 'recon:2']);
  });

  it('stops the plan when an action reverts, leaving later actions unsubmitted', async () => {
    const { deps: d, calls } = deps({
      submit: async (_p, i) => (i === 1 ? { ok: false as const, error: 'revert' } : { ok: true as const, txHash: `0x${i}` }),
    });
    const r = await runSubmissionLoop(draft(3), d);
    expect(r.completed).toBe(1);
    expect(r.stoppedAt).toBe(1);
    expect(calls).not.toContain('submit:2');
  });

  it('stops when reconciliation diverges from chain truth', async () => {
    const { deps: d } = deps({ reconcile: async () => ({ ok: false as const, error: 'balance delta mismatch' }) });
    const r = await runSubmissionLoop(draft(2), d);
    expect(r.stoppedAt).toBe(0);
    expect(r.errors.join(' ')).toMatch(/mismatch/);
  });

  it('does not submit when chain verification fails', async () => {
    const { deps: d, calls } = deps({ verifyChain: async () => ({ ok: false as const, error: 'chainId mismatch' }) });
    const r = await runSubmissionLoop(draft(2), d);
    expect(r.completed).toBe(0);
    expect(calls.some((c) => c.startsWith('submit:'))).toBe(false);
  });

  it('always releases the lock, even after a failure', async () => {
    const { deps: d, calls } = deps({ submit: async () => ({ ok: false as const, error: 'boom' }) });
    await runSubmissionLoop(draft(1), d);
    expect(calls[calls.length - 1]).toBe('unlock');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- submission-loop`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `submission-loop.ts`**

```ts
import type { PlanDraft } from '../policy/types.js';

export interface SubmissionDeps {
  acquireLock: (planId: string) => Promise<boolean>;
  persistIntent: (planId: string, index: number) => Promise<void>;
  verifyChain: () => Promise<{ ok: true } | { ok: false; error: string }>;
  simulate: (planId: string, index: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  submit: (planId: string, index: number) => Promise<{ ok: true; txHash: string } | { ok: false; error: string }>;
  reconcile: (planId: string, index: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  releaseLock: (planId: string) => Promise<void>;
}

/**
 * §10.3 — for every action: obtain a lock, persist before signing, verify
 * chain identity and nonce, simulate against pending state, submit exactly one
 * action, reconcile receipt and balance deltas, then advance or stop.
 *
 * A reverted or divergent action stops later plan actions. A database state
 * never overrides confirmed chain state, which is why reconcile runs after
 * every submission and its failure halts the plan.
 */
export async function runSubmissionLoop(
  draft: PlanDraft,
  deps: SubmissionDeps
): Promise<{ completed: number; stoppedAt: number | null; errors: string[] }> {
  const errors: string[] = [];

  if (!(await deps.acquireLock(draft.planId))) {
    return { completed: 0, stoppedAt: null, errors: ['execution lock held by another worker'] };
  }

  let completed = 0;
  let stoppedAt: number | null = null;

  try {
    for (const action of draft.actions) {
      await deps.persistIntent(draft.planId, action.index);

      const chain = await deps.verifyChain();
      if (!chain.ok) {
        errors.push(`action ${action.index}: chain verification failed: ${chain.error}`);
        stoppedAt = action.index;
        break;
      }

      const sim = await deps.simulate(draft.planId, action.index);
      if (!sim.ok) {
        errors.push(`action ${action.index}: simulation failed: ${sim.error}`);
        stoppedAt = action.index;
        break;
      }

      const sent = await deps.submit(draft.planId, action.index);
      if (!sent.ok) {
        errors.push(`action ${action.index}: submission failed: ${sent.error}`);
        stoppedAt = action.index;
        break;
      }

      const rec = await deps.reconcile(draft.planId, action.index);
      if (!rec.ok) {
        errors.push(`action ${action.index}: reconciliation failed: ${rec.error}`);
        stoppedAt = action.index;
        break;
      }

      completed++;
    }
  } finally {
    await deps.releaseLock(draft.planId);
  }

  return { completed, stoppedAt, errors };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- submission-loop`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/execution/submission-loop.ts test/unit/execution/submission-loop.spec.ts
git commit -m "feat(execution): paper 10.3 submission loop

Lock, persist before signing, verify chain, simulate against pending state,
submit one action, reconcile receipt and balance deltas, then advance or stop.
A reverted or divergent action halts the remaining plan actions.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 16: Anvil fork end-to-end checkpoint

The Phase 1 exit gate: the live service produces a paper-shaped decision and executes a real staged plan on chain.

**Files:**
- Create: `srcla/scripts/phase1-fork-check.ts`
- Modify: `srcla/package.json` (add the script)

**Interfaces:**
- Consumes: `DecisionDriver` (Task 13), `KeeperExecutor.executePlanDraft` (Task 14).
- Produces: a script exiting `0` on success with a printed decision hash, plan id and transaction hashes.

- [ ] **Step 1: Bring the stack up**

```bash
anvil --fork-url https://mainnet.base.org --code-size-limit 100000
cd contract && forge script script/DeployNavyVaultSRCLA.s.sol --fork-url http://127.0.0.1:8545 --broadcast
```

Copy the deployed addresses into `srcla/.env.anvil` (`VAULT_ADDRESS`, `AAVE_STRATEGY_ADDRESS`, `COMPOUND_STRATEGY_ADDRESS`, `MOONWELL_STRATEGY_ADDRESS`, `REWARD_EXECUTOR_ADDRESS`, `USDC_ADDRESS`). They change on every redeploy.

- [ ] **Step 2: Write the checkpoint script**

Create `srcla/scripts/phase1-fork-check.ts`:

```ts
/**
 * Phase 1 exit gate. Runs one real decision cycle against the Anvil fork and
 * asserts the plan actually executes on chain.
 *
 * Fails loudly on the three defects Phase 1 exists to fix:
 *   - a zero snapshotHash making submitPlan revert
 *   - execution taking the weak executeAction path
 *   - a plan header carrying zeroed risk limits
 */
import 'dotenv/config';
import { ethers } from 'ethers';
import { loadConfig } from '../src/config.js';
import { ChainClient } from '../src/chain/client.js';
import { SnapshotCollector } from '../src/collector/snapshot-collector.js';
import { DecisionDriver } from '../src/runtime/decision-driver.js';
import { loadBootstrapArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import { createKeeperExecutor } from '../src/execution/keeper-executor.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new ChainClient({ rpcUrl: config.baseRpcUrl, chainId: config.chainId });
  const collector = new SnapshotCollector(client, {
    vaultAddress: config.vaultAddress,
    strategyAddresses: {
      aave: config.aaveStrategyAddress,
      compound: config.compoundStrategyAddress,
      moonwell: config.moonwellStrategyAddress,
    },
    usdcAddress: config.usdcAddress,
  });

  const artifact = loadBootstrapArtifact();
  const opts = {
    ...DEFAULT_DECIDE_OPTS,
    codeCommit: process.env.GIT_COMMIT ?? 'dev',
    plan: {
      ...DEFAULT_DECIDE_OPTS.plan,
      chainId: config.chainId,
      vaultAddress: config.vaultAddress,
      assetAddress: config.usdcAddress,
    },
  };

  const driver = new DecisionDriver({
    loadOrigin: () => buildRawOriginFromCollector(collector, prisma, gas, chainConfigDigests),
    artifact,
    opts,
    persist: async (out) => console.log(`[phase1] decision ${out.decisionHash} action=${out.action}`),
  });

  const out = await driver.runCycle();
  if (out === null) throw new Error('no finalized origin available from the fork');

  console.log(`[phase1] reasons: ${out.reasons.join('; ')}`);
  console.log(`[phase1] target: ${JSON.stringify([...out.target.entries()].map(([k, v]) => [k, v.toString()]))}`);
  console.log(`[phase1] reserve: ${out.reserve.requiredBase}`);
  console.log(`[phase1] enumeration regret: ${out.enumeration?.regretBps ?? 'n/a'} bps`);

  if (out.action !== 'rebalance' || !out.plan) {
    console.log('[phase1] HOLD — no plan to execute. Fund the vault or widen the gate to exercise execution.');
    return;
  }

  if (out.plan.header.snapshotHash === ethers.ZeroHash) throw new Error('E1 regression: zero snapshotHash');
  if (out.plan.header.reserve === 0n && out.reserve.requiredBase > 0n) throw new Error('E3 regression: reserve dropped from header');

  const keeper = createKeeperExecutor();
  const result = await keeper.executePlanDraft(out.plan);
  console.log(`[phase1] plan ${out.plan.planId} -> ${result.success ? 'OK' : 'FAILED'}`);
  console.log(`[phase1] txs: ${result.txHashes.join(', ')}`);
  if (!result.success) throw new Error(result.errors.join('; '));
}

main().catch((e) => {
  console.error('[phase1] FAILED:', e);
  process.exit(1);
});
```

`buildRawOriginFromCollector` is defined in Task 13. Construct `prisma`, `gas` (from `client.getGasPrice()` plus a Chainlink ETH/USD read) and `chainConfigDigests` (from `vault.currentConfigurationDigest()`) above the driver.

- [ ] **Step 3: Add the script**

In `srcla/package.json` `scripts`:

```json
    "phase1:check": "tsx scripts/phase1-fork-check.ts",
```

- [ ] **Step 4: Run the checkpoint**

Run: `source .env.anvil && pnpm phase1:check`
Expected: prints a decision hash, non-empty reasons, a target allocation, a reserve, a real enumeration regret in bps, and — if the vault holds assets — a plan id with transaction hashes and `OK`.

If it prints `HOLD`, fund the vault on the fork (`forge script script/FundVaultAnvil.s.sol --fork-url http://127.0.0.1:8545 --broadcast`) and re-run, because the exit gate requires observing a real on-chain execution.

- [ ] **Step 5: Run the whole suite one final time**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add scripts/phase1-fork-check.ts package.json src/runtime/decision-driver.ts
git commit -m "test(phase1): Anvil fork end-to-end checkpoint

Runs one real decision cycle against the fork and asserts the staged plan
executes on chain, guarding explicitly against the zero-snapshotHash revert
and dropped plan risk limits.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

## Phase 1 Exit Criteria

- [ ] `pnpm exec tsc --noEmit` clean
- [ ] `pnpm test` green, including the determinism, look-ahead-barrier and encoding-parity tests
- [ ] `pnpm phase1:check` executes a staged plan on the Anvil fork and prints transaction hashes
- [ ] `grep -rn "generateDecision\|SrclaController\|policy-engine\|market-engine\|evaluation-engine" src` returns nothing
- [ ] `srcla-paper.md` reads version 0.5 and contains the Amendment Record with the burned-window declaration

## Self-Review Notes

- **Type consistency checked:** `PlanDraft.actions[].kind` is `0|1|2|3` matching `NavyVaultSRCLA.ActionKind`; `hashPlanAction` takes `amountBase`/`minOutBase` in both Task 10 and Task 14; `RateCurve.points` is `bigint[]` throughout; `exitableFraction` returns `number` and is converted to bigint only inside `portfolioLowerBound`.
- **Known rough edge:** `optimize.ts` contains a local `rateAtHorizon` duplicating `rateAt` to avoid an import cycle with `simulate.ts`. If Task 8's implementer finds no cycle, import `rateAt` and delete the duplicate.
- **Deferred to Phase 4:** the forecast grid sweep, loss function, walk-forward calibration and the artifact that replaces `config/bootstrap-artifact.json`. Task 6 ships a provisional artifact so Phase 1 can run; **no result produced with it is citable.**
- **Deferred to Phase 2:** deleting the vault's `executeAction`, `VaultTypes.ActionKind`'s inverted duplicate, and the contract-side `liquidityFloorBps` that mirrors Task 8's off-chain `liquidityCapBase`.
