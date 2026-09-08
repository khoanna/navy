import { evaluateHarvest, type HarvestParams } from '../../../src/policy/harvest.js';
import {
  admitReward,
  recognizedRewardValueBase,
  type RewardObservation,
  type RewardTokenPolicy,
} from '../../../src/policy/steps/reward-admission.js';
import { MOVE_COST_TERMS, type CostParams } from '../../../src/policy/steps/cost.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import type { DecisionInput, PolicyArtifact } from '../../../src/policy/types.js';

const NOW = 1_000_000;
/** COMP on Base (contract/config/base-reward-routes.json). Address only -- no
 *  live emission claim is made here; that is the Task 1 probe's job. */
const TOKEN = '0x9e1028F5F1D5eDE59748FFceE5532509976840E0';
const ADAPTER = '0x00000000000000000000000000000000000000a1';

/**
 * Gas/oracle observation. Identical to test/unit/policy/cost.spec.ts's, so the
 * per-term arithmetic asserted below can be checked against that suite:
 *   weiToUsdcBase(w) = w * 3.5e11 / 1e18 * 1e6 / 1e8 = w * 3.5 / 1e9
 */
function input(): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: NOW, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n,
      idleBase: 10_000_000_000n,
      sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0xv',
    },
    markets: [],
    dependencyGroups: [],
    withdrawals: [],
    gas: {
      l2BaseFeeWei: 5_000_000n, // 0.005 gwei, typical Base
      l1BaseFeeWei: 8_000_000_000n, // not read by the post-Ecotone cost model
      l1BlobBaseFeeWei: 10_000_000n, // ~0.01 gwei-equivalent, matches a pinned Base fork
      ethUsdE8: 350_000_000_000n, // $3,500
      usdcUsdE8: 100_000_000n, // $1.00
    },
    history: [],
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
  };
}

const artifact = (): PolicyArtifact => loadBootstrapArtifact();

/**
 * Deliberately high notional-scaled terms (impact 300 bps + slippage 400 bps +
 * MEV 300 bps = 10% of notional). A reward-token -> USDC swap runs through a
 * far thinner pool than a USDC venue move, so this is a defensible harvest
 * parameterisation -- and it is what makes the last two cases in this file
 * genuinely discriminate a full-cost gate from a gas-only one: with the
 * repo's 8 bps allocation defaults the window between "exceeds gas" and
 * "exceeds the full sum" is ~10 USDC base units wide, which no test could
 * meaningfully straddle.
 */
const COST: CostParams = {
  cooldownSeconds: 3600,
  minTurnoverBps: 10,
  maxTurnoverBps: 5000,
  turnoverWindowSeconds: 86_400,
  reversalWindowSeconds: 86_400,
  reversalAllowanceBps: 200,
  slippageBps: 400,
  mevBps: 300,
  impactBps: 300,
  failureRateBps: 50,
  bufferBps: 100,
  gasPerAction: 250_000n,
  planGasOverhead: 150_000n,
  actionDispatchGas: 15_000n,
  approveResetGas: 50_000n,
  swapGas: 180_000n,
  l1BytesPerAction: 400n,
};

/**
 * Hand-computed from COST and input().gas, INDEPENDENTLY of movementCostBase:
 *   l2           (150_000 + 1*15_000) * 5e6 wei = 8.25e11  -> 2887
 *   l1Data       1 * 400 * 1 * 1e7 wei = 4e9              ->   14
 *   exit/entry   no divest/deploy in a harvest-only move  ->    0
 *   claim        250_000 * 5e6 = 1.25e12                  -> 4375
 *   approveReset 2 * 50_000 * 5e6 = 5e11                  -> 1750
 *   swap         180_000 * 5e6 = 9e11                     -> 3150
 *   failure      (l2+l1Data+exit+entry+claim) * 50/10_000 ->   36
 * Sum of the gas-priced terms:                                12_212
 * The remaining terms (impact, slippageMev, buffer) scale with notional.
 */
const GAS_TERMS = ['l2', 'l1Data', 'exit', 'entry', 'claim', 'approveReset', 'swap', 'failure'] as const;
const GAS_ONLY_BASE = 12_212n;

/** 18-dp token at $1.00: value in USDC base units = amount / 1e12. */
function amountForBase(base: bigint): bigint {
  return base * 10n ** 12n;
}

function obs(over: Partial<RewardObservation> = {}): RewardObservation {
  return {
    adapter: ADAPTER,
    token: TOKEN,
    tokenDecimals: 18,
    observedAtSeconds: NOW,
    /** raw token units */
    claimableAmount: amountForBase(15_000n),
    /** raw token units already sitting in the adapter (§9.2 "claimable plus held") */
    heldAmount: 0n,
    claimSimulationSucceeded: true,
    emissionEndSeconds: NOW + 30 * 86_400,
    /** raw token units the reward controller still holds */
    controllerFundedAmount: 10n ** 30n,
    /** reward/USD, Chainlink 8 dp */
    rewardUsdE8: 100_000_000n,
    rewardFeedUpdatedAtSeconds: NOW - 60,
    /** USDC/USD, Chainlink 8 dp */
    usdcUsdE8: 100_000_000n,
    usdcFeedUpdatedAtSeconds: NOW - 60,
    routeId: 'comp-usdc-3000',
    routeApproved: true,
    ...over,
  };
}

function policy(over: Partial<RewardTokenPolicy> = {}): RewardTokenPolicy {
  return {
    token: TOKEN,
    admitted: true,
    haircutBps: 0,
    maxContributionBase: 10n ** 12n, // $1,000,000 -- not binding unless overridden
    maxFeedAgeSeconds: 3600,
    ...over,
  };
}

function params(over: Partial<HarvestParams> = {}): HarvestParams {
  return {
    cost: COST,
    materialThresholdBase: 5_000n,
    rewards: [obs()],
    policies: { [TOKEN.toLowerCase()]: policy() },
    ...over,
  };
}

/** One reward in, one decision out. */
function only(p: HarvestParams) {
  const out = evaluateHarvest(input(), artifact(), p);
  expect(out).toHaveLength(1);
  return out[0]!;
}

function sumGasTerms(terms: Record<string, bigint>): bigint {
  return GAS_TERMS.reduce((s, k) => s + (terms[k] ?? 0n), 0n);
}

describe('admitReward (§9.2 eligibility)', () => {
  it('admits a fully eligible reward with an OK reason', () => {
    const r = admitReward(obs(), policy());
    expect(r.admitted).toBe(true);
    expect(r.reasons.every((x) => x.passed)).toBe(true);
    expect(r.reasons.map((x) => x.code)).toContain('OK');
  });

  it.each([
    ['TOKEN_NOT_ADMITTED', obs(), policy({ admitted: false })],
    ['EMISSION_ENDED', obs({ emissionEndSeconds: NOW - 1 }), policy()],
    ['UNDERFUNDED', obs({ controllerFundedAmount: 1n }), policy()],
    ['CLAIM_SIMULATION_FAILED', obs({ claimSimulationSucceeded: false }), policy()],
    ['FEED_STALE', obs({ rewardFeedUpdatedAtSeconds: NOW - 7200 }), policy()],
    ['FEED_INVALID', obs({ rewardUsdE8: 0n }), policy()],
    ['NO_APPROVED_ROUTE', obs({ routeApproved: false }), policy()],
  ])('rejects with %s', (code, o, p) => {
    const r = admitReward(o, p);
    expect(r.admitted).toBe(false);
    const failing = r.reasons.filter((x) => !x.passed).map((x) => x.code);
    expect(failing).toContain(code);
    expect(r.reasons.map((x) => x.code)).not.toContain('OK');
  });

  it('reports a stale USDC feed as FEED_STALE too, not only the reward feed', () => {
    const r = admitReward(obs({ usdcFeedUpdatedAtSeconds: NOW - 7200 }), policy());
    expect(r.admitted).toBe(false);
    expect(r.reasons.filter((x) => !x.passed).map((x) => x.code)).toContain('FEED_STALE');
  });

  it('gives no partial credit: a rejected reward recognises exactly zero value', () => {
    // The amount is large enough that any partial credit would be visible.
    const big = obs({ claimableAmount: amountForBase(1_000_000_000n) });
    expect(recognizedRewardValueBase(big, policy()).grossBase).toBeGreaterThan(0n);
    for (const [o, p] of [
      [big, policy({ admitted: false })],
      [obs({ ...big, emissionEndSeconds: NOW - 1 }), policy()],
      [obs({ ...big, rewardFeedUpdatedAtSeconds: NOW - 7200 }), policy()],
    ] as Array<[RewardObservation, RewardTokenPolicy]>) {
      const v = recognizedRewardValueBase(o, p);
      expect(v.grossBase).toBe(0n);
      expect(v.conservativeBase).toBe(0n);
    }
  });

  it('applies the token haircut and the absolute contribution cap (§9.2)', () => {
    const o = obs({ claimableAmount: amountForBase(100_000n) });
    const haircut = recognizedRewardValueBase(o, policy({ haircutBps: 1000 }));
    expect(haircut.grossBase).toBe(100_000n);
    expect(haircut.conservativeBase).toBe(90_000n);

    const capped = recognizedRewardValueBase(o, policy({ haircutBps: 1000, maxContributionBase: 25_000n }));
    expect(capped.grossBase).toBe(100_000n);
    expect(capped.conservativeBase).toBe(25_000n);
  });

  it('counts held amounts alongside claimable (§9.2)', () => {
    const o = obs({ claimableAmount: amountForBase(1_000n), heldAmount: amountForBase(3_000n) });
    expect(recognizedRewardValueBase(o, policy()).grossBase).toBe(4_000n);
  });
});

describe('evaluateHarvest (§9.3 event-driven gate)', () => {
  it('is pure: the same input yields an identical result', () => {
    const p = params();
    expect(evaluateHarvest(input(), artifact(), p)).toEqual(evaluateHarvest(input(), artifact(), p));
  });

  it('returns one decision per observed reward', () => {
    const out = evaluateHarvest(
      input(),
      artifact(),
      params({ rewards: [obs(), obs({ adapter: '0x00000000000000000000000000000000000000a2' })] })
    );
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.adapter)).toEqual([ADAPTER, '0x00000000000000000000000000000000000000a2']);
  });

  // --- §9.2 admission failures: each amount is far above the cost sum, so a
  // --- gate that ignored admission would fire on every one of these.
  it('never fires and recognises zero when the token is not admitted', () => {
    const d = only(params({ policies: { [TOKEN.toLowerCase()]: policy({ admitted: false }) } }));
    expect(d.fire).toBe(false);
    expect(d.claimableBase).toBe(0n);
    expect(d.conservativeOutBase).toBe(0n);
    expect(d.reason).toContain('TOKEN_NOT_ADMITTED');
  });

  it('never fires past the emission end', () => {
    const d = only(params({ rewards: [obs({ emissionEndSeconds: NOW - 1 })] }));
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('EMISSION_ENDED');
  });

  it('never fires when the controller is underfunded', () => {
    const d = only(params({ rewards: [obs({ controllerFundedAmount: 1n })] }));
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('UNDERFUNDED');
  });

  it('never fires on a stale feed AND does not raise the recognised value', () => {
    const d = only(params({ rewards: [obs({ rewardFeedUpdatedAtSeconds: NOW - 7200 })] }));
    expect(d.fire).toBe(false);
    expect(d.claimableBase).toBe(0n);
    expect(d.conservativeOutBase).toBe(0n);
    expect(d.reason).toContain('FEED_STALE');
  });

  it('never fires on an invalid feed AND does not raise the recognised value', () => {
    const d = only(params({ rewards: [obs({ rewardUsdE8: -1n })] }));
    expect(d.fire).toBe(false);
    expect(d.claimableBase).toBe(0n);
    expect(d.conservativeOutBase).toBe(0n);
    expect(d.reason).toContain('FEED_INVALID');
  });

  it('never fires without an approved Uniswap route', () => {
    const d = only(params({ rewards: [obs({ routeApproved: false, routeId: null })] }));
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('NO_APPROVED_ROUTE');
  });

  // --- materiality
  it('does not fire below the material threshold even when it would clear cost', () => {
    // 20_000 base units clears the full cost sum (14_354) comfortably; only the
    // materiality rule stops it.
    const d = only(
      params({ rewards: [obs({ claimableAmount: amountForBase(20_000n) })], materialThresholdBase: 50_000n })
    );
    expect(d.claimableBase).toBe(20_000n);
    expect(d.costBase).toBeLessThan(20_000n);
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('IMMATERIAL');
  });

  // --- the decisive pair: a real economic gate, not a gas threshold
  it('does NOT fire when output exceeds gas but not the full §9.3 cost sum', () => {
    const d = only(params({ rewards: [obs({ claimableAmount: amountForBase(13_000n) })] }));
    const gasOnly = sumGasTerms(d.terms);
    expect(gasOnly).toBe(GAS_ONLY_BASE);
    // The output IS above every gas-priced term combined ...
    expect(d.conservativeOutBase).toBeGreaterThan(gasOnly);
    // ... but below the full sum, which also carries impact, slippage/MEV and buffer.
    expect(d.costBase).toBe(13_647n);
    expect(d.costBase).toBeGreaterThan(d.conservativeOutBase);
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('COST_EXCEEDS_OUTPUT');
  });

  it('DOES fire when output exceeds the full §9.3 cost sum', () => {
    const d = only(params({ rewards: [obs({ claimableAmount: amountForBase(15_000n) })] }));
    const gasOnly = sumGasTerms(d.terms);
    expect(gasOnly).toBe(GAS_ONLY_BASE);
    expect(d.conservativeOutBase).toBeGreaterThan(gasOnly);
    expect(d.costBase).toBe(13_849n);
    expect(d.conservativeOutBase).toBeGreaterThan(d.costBase);
    expect(d.fire).toBe(true);
    expect(d.reason).toContain('OUTPUT_EXCEEDS_COST');
  });

  it('prices §9.3 term by term, with no term duplicating another', () => {
    const d = only(params({ rewards: [obs({ claimableAmount: amountForBase(15_000n) })] }));

    // Each §9.3 component, recomputed independently of movementCostBase.
    expect(d.terms['claim']).toBe(4_375n);
    expect(d.terms['approveReset']).toBe(1_750n); // approve + zero-reset, §9.4
    expect(d.terms['swap']).toBe(3_150n);
    expect(d.terms['l1Data']).toBe(14n);
    expect(d.terms['impact']).toBe(450n); // 300 bps of 15_000
    expect(d.terms['slippageMev']).toBe(1_050n); // 700 bps of 15_000
    expect(d.terms['buffer']).toBe(137n); // 100 bps of everything else

    // A harvest moves nothing between venues, so exit/entry are structurally 0 ...
    expect(d.terms['exit']).toBe(0n);
    expect(d.terms['entry']).toBe(0n);
    // ... which means l2 must be the plan-submission + dispatch overhead ALONE.
    // The prior defect made l2 an exact duplicate of exit + entry + claim; here
    // that would make it 4_375n.
    expect(d.terms['l2']).toBe(2_887n);
    expect(d.terms['l2']).not.toBe(d.terms['claim']! + d.terms['exit']! + d.terms['entry']!);

    // total == sum(terms) alone cannot catch a duplicate, so it is asserted
    // together with the per-term equalities above.
    expect(d.costBase).toBe(MOVE_COST_TERMS.reduce((s, k) => s + (d.terms[k] ?? 0n), 0n));
  });

  it('scales the cost with the harvested notional rather than using a flat threshold', () => {
    const small = only(params({ rewards: [obs({ claimableAmount: amountForBase(15_000n) })] }));
    const large = only(params({ rewards: [obs({ claimableAmount: amountForBase(150_000n) })] }));
    expect(large.costBase).toBeGreaterThan(small.costBase);
    expect(large.terms['impact']).toBe(4_500n);
  });

  it('treats a reward with no policy entry as unadmitted', () => {
    const d = only(params({ policies: {} }));
    expect(d.fire).toBe(false);
    expect(d.claimableBase).toBe(0n);
    expect(d.reason).toContain('TOKEN_NOT_ADMITTED');
  });
});
