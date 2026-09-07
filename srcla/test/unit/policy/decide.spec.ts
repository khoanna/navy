import { jest } from '@jest/globals';
import { decide, computeCanonicalSnapshotHash, DEFAULT_DECIDE_OPTS } from '../../../src/policy/decide.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import type { DecisionInput, MarketObservation, PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

function market(id: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id,
    adapter: `0x${id.padEnd(40, '0')}`,
    protocol: 'aave',
    cash: 10n ** 12n,
    borrows: 0n,
    reserves: 0n,
    supplyRateWad: WAD / 100n,
    utilizationWad: 0n,
    positionBase: 0n,
    maxDeployableBase: 10n ** 12n,
    maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd',
    regimeId: 'r1',
    paused: false,
    capBps: 10000,
    absoluteCapBase: 10n ** 13n,
    maxLossBps: 50,
    dependencyGroupIds: [],
    ...over,
  };
}

function input(): DecisionInput {
  return {
    origin: { blockNumber: 12345, blockHash: '0x' + 'ab'.repeat(32), timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n,
      idleBase: 10_000_000_000n,
      sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0x' + 'cd'.repeat(32),
    },
    markets: [market('aa'), market('bb')],
    dependencyGroups: [],
    withdrawals: [],
    gas: {
      l2BaseFeeWei: 5_000_000n,
      l1BaseFeeWei: 8_000_000_000n,
      l1BlobBaseFeeWei: 1n,
      ethUsdE8: 350_000_000_000n,
      usdcUsdE8: 100_000_000n,
    },
    // 40 completed labels, all for market 'aa' regime 'r1' - deliberately
    // does NOT satisfy market 'bb''s REGIME_MIN_HISTORY rule (bootstrap
    // minObservations is 30, and 'bb' has zero labels of its own), so 'bb'
    // is admission-rejected and only 'aa' is eligible in the base fixture.
    // The dedicated rebalance fixture below (`rebalanceInput`/`rebalanceArtifact`)
    // gives both markets their own history so both are eligible there.
    history: Array.from({ length: 40 }, () => ({
      marketId: 'aa',
      regimeId: 'r1',
      originSeconds: 1,
      horizonSeconds: 604_800 as const,
      horizonEndSeconds: 2,
      availableAtSeconds: 3,
      realizedReturnWad: WAD,
      realizedMinCashBase: 1n,
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

/**
 * A fixture engineered to genuinely rebalance, for the "plan header carries
 * the snapshot hash" assertion below. The base `input()`/`artifact()` pair
 * above is deliberately admission-thin (only 'aa' clears REGIME_MIN_HISTORY)
 * and, depending on cost-gate parameters, may not clear MIN_TURNOVER against
 * DEFAULT_DECIDE_OPTS.cost - wrapping the assertion in
 * `if (out.action === 'rebalance')` would make it pass vacuously whenever
 * nothing is deployed (exactly issue (1) in the task brief). This fixture
 * gives both markets sufficient history, a healthy positive rate, a
 * generous quantum-affordable universe, and cost-gate params sized so the
 * gain from deploying idle cash clears cost - proven below by asserting
 * `action === 'rebalance'` unconditionally BEFORE checking the header.
 */
function rebalanceHistory(marketId: string) {
  return Array.from({ length: 40 }, () => ({
    marketId,
    regimeId: 'r1',
    originSeconds: 1,
    horizonSeconds: 604_800 as const,
    horizonEndSeconds: 2,
    availableAtSeconds: 3,
    realizedReturnWad: WAD,
    realizedMinCashBase: 1n,
  }));
}

function rebalanceInput(): DecisionInput {
  const base = input();
  return {
    ...base,
    markets: [
      // protocol: 'compound', not 'aave' - Aave's default IRM (baseRate 0%)
      // produces a genuinely zero supply rate whenever borrows is 0 (the
      // observed supplyRateWad only seeds curve point[0]; every simulated
      // point beyond it is real IRM math over cash/borrows, so an
      // inconsistent hand-set observed rate on a zero-borrow Aave market
      // does not survive into the curve the optimiser actually searches).
      // Compound's kinked-linear model has a non-zero baseRate (3% APY)
      // even at zero utilisation, which is what actually produces a
      // deployable positive curve here.
      market('aa', { protocol: 'compound', supplyRateWad: (WAD * 3n) / 100n }),
      market('bb', { protocol: 'compound', supplyRateWad: (WAD * 3n) / 100n }),
    ],
    history: [...rebalanceHistory('aa'), ...rebalanceHistory('bb')],
  };
}

function rebalanceArtifact(): PolicyArtifact {
  return {
    ...artifact(),
    // Small, non-zero, conservative (paper P1) - this is what actually lets
    // idle cash clear the objective; the shipped bootstrap value already
    // satisfies this (see config/bootstrap-artifact.json's derivation note)
    // but the override keeps this fixture self-contained regardless of the
    // artifact file's contents.
    portfolioResidualQuantileWad: -1_000_000n,
  };
}

const REBALANCE_OPTS = {
  ...DEFAULT_DECIDE_OPTS,
  cost: {
    ...DEFAULT_DECIDE_OPTS.cost,
    // Cost-gate params tuned so a genuinely profitable deployment of this
    // fixture's full 10,000 USDC clears every gate:
    //  - minTurnoverBps down to 1 (DEFAULT's 10bps floor is already low
    //    enough, kept explicit for clarity);
    //  - maxTurnoverBps raised to 100% so deploying the whole vault in one
    //    decision (this fixture's optimizer result) doesn't trip MAX_TURNOVER
    //    against DEFAULT's 50% cap - a real deployment would be staged over
    //    several cycles, this fixture just needs ONE decision to rebalance;
    //  - slippage/mev/impact bps zeroed so the ~5.75M base-unit gain from a
    //    7-day 3% APY deployment clears C_move, which those bps-of-notional
    //    terms otherwise dominate (8bps of a 10,000 USDC move is 8M base
    //    units, larger than the gain itself).
    minTurnoverBps: 1,
    maxTurnoverBps: 10000,
    slippageBps: 0,
    mevBps: 0,
    impactBps: 0,
  },
};

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

  // Correctness check for defect (2) in the task brief: the SHIPPED bootstrap
  // artifact carries pinnedConfigDigests: {} by design (a pinned digest is
  // only knowable against a live deployment; a later task populates it from
  // chain). admit.ts's CONFIG_DIGEST_UNPINNED rule therefore rejects every
  // market against the real shipped artifact, and decide() must hold with an
  // admission-empty reason - that is correct behaviour, not a bug, and this
  // test pins it so a future change cannot silently "fix" it by weakening
  // the admission rule or inventing digests.
  it('holds with an admission-empty reason when run against the real shipped bootstrap artifact', () => {
    const out = decide(input(), loadBootstrapArtifact(), DEFAULT_DECIDE_OPTS);
    expect(out.action).toBe('hold');
    expect(out.reasons).toContain('ADMISSION_EMPTY');
    expect(out.admission.eligible).toHaveLength(0);
    expect(
      out.admission.reasons.some((r) => r.code === 'CONFIG_DIGEST_UNPINNED' && r.passed === false)
    ).toBe(true);
  });

  // Issue (3) in the task brief: this assertion must be unconditional, not
  // guarded by `if (out.action === 'rebalance')` - a guarded version passes
  // vacuously whenever nothing is deployed, which (given defect (1)) was
  // always. `rebalanceInput`/`rebalanceArtifact`/`REBALANCE_OPTS` above are
  // engineered specifically to make the kernel genuinely rebalance.
  it('emits a plan whose header carries a non-zero snapshot hash when it rebalances', () => {
    const out = decide(rebalanceInput(), rebalanceArtifact(), REBALANCE_OPTS);
    expect(out.action).toBe('rebalance');
    expect(out.plan).not.toBeNull();
    expect(out.snapshotHash).not.toBe('0'.repeat(64));
    const expectedSnapshotHash = out.snapshotHash.startsWith('0x') ? out.snapshotHash : `0x${out.snapshotHash}`;
    expect(out.plan!.header.snapshotHash).toBe(expectedSnapshotHash);
    expect(out.plan!.header.snapshotHash).not.toBe('0x' + '00'.repeat(32));
  });

  it('does not read the wall clock', () => {
    const spy = jest.spyOn(Date, 'now');
    decide(input(), artifact(), DEFAULT_DECIDE_OPTS);
    decide(rebalanceInput(), rebalanceArtifact(), REBALANCE_OPTS);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
