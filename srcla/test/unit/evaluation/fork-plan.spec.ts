/**
 * `buildForkPlan` is the pure half of §11.1's fork replay: it turns a
 * policy's proposal into the exact plan the vault verifies. It is unit-tested
 * here; the transaction half needs a chain and lives behind `NAVY_FORK_E2E=1`
 * in `test/integration/fork-replay.spec.ts`.
 */
import { ethers } from 'ethers';
import { buildForkPlan, isChainRefusal, type ForkReplayPlan } from '../../../src/evaluation/fork-runner.js';
import { ActionKind, hashPlanAction, planDomain } from '../../../src/policy/steps/plan.js';

const ADAPTERS = {
  compound: '0x' + '11'.repeat(20),
  aave: '0x' + '22'.repeat(20),
  moonwell: '0x' + '33'.repeat(20),
};

const CTX = {
  chainId: 8453,
  vaultAddress: '0x' + 'aa'.repeat(20),
  assetAddress: '0x' + 'bb'.repeat(20),
  adapterByMarketId: ADAPTERS,
  configurationDigest: '0x' + 'cd'.repeat(32),
  totalAssetsBase: 1_000_000_000_000n,
  prestateBlock: 51_105_786,
  nowSeconds: 1_800_000_000,
  expirySeconds: 3_600,
  maxLossBps: 100,
};

function plan(actions: ForkReplayPlan['actions']): ForkReplayPlan {
  return {
    policyId: 'srcla',
    tier: 1_000_000_000_000n,
    originIndex: 7,
    decisionHash: ethers.keccak256(ethers.toUtf8Bytes('decision')),
    actions,
  };
}

/** MerkleTree.sol's sorted-pair hash, re-derived independently here. */
function verify(leaf: string, proof: string[], root: string): boolean {
  let computed = leaf;
  for (const sibling of proof) {
    computed =
      BigInt(computed) < BigInt(sibling)
        ? ethers.keccak256(ethers.concat([computed, sibling]))
        : ethers.keccak256(ethers.concat([sibling, computed]));
  }
  return computed === root;
}

describe('buildForkPlan', () => {
  it('is null when the policy proposed nothing — a HOLD is not a plan', () => {
    expect(buildForkPlan(plan([]), CTX)).toBeNull();
  });

  it('orders every divest ahead of every deploy, as the vault requires', () => {
    const built = buildForkPlan(
      plan([
        { kind: 'deploy', marketId: 'aave', amountBase: 10n },
        { kind: 'divest', marketId: 'moonwell', amountBase: 20n },
        { kind: 'deploy', marketId: 'compound', amountBase: 30n },
      ]),
      CTX,
    );
    expect(built).not.toBeNull();
    expect(built!.actions.map((a) => a.kind)).toEqual([
      ActionKind.Divest,
      ActionKind.Deploy,
      ActionKind.Deploy,
    ]);
    expect(built!.actions.map((a) => a.index)).toEqual([0, 1, 2]);
  });

  it('produces proofs that verify against the root it publishes', () => {
    const built = buildForkPlan(
      plan([
        { kind: 'deploy', marketId: 'aave', amountBase: 150_000_000_000n },
        { kind: 'deploy', marketId: 'compound', amountBase: 200_000_000_000n },
        { kind: 'deploy', marketId: 'moonwell', amountBase: 100_000_000_000n },
      ]),
      CTX,
    )!;
    const domain = planDomain(CTX.chainId, CTX.vaultAddress, CTX.assetAddress, built.header);
    for (const action of built.actions) {
      const leaf = hashPlanAction(domain, {
        planId: action.planId,
        index: action.index,
        kind: action.kind,
        adapter: action.adapter,
        amountBase: action.amount,
        minOutBase: action.minOut,
        dataHash: action.dataHash,
      });
      expect(verify(leaf, action.proof, built.merkleRoot)).toBe(true);
    }
  });

  it('derives the planId from the decision hash and pins the prestate block', () => {
    const p = plan([{ kind: 'deploy', marketId: 'compound', amountBase: 1_000n }]);
    const built = buildForkPlan(p, CTX)!;
    expect(built.header.planId).toBe(BigInt(p.decisionHash) & ((1n << 255n) - 1n));
    expect(built.header.decisionHash).toBe(p.decisionHash);
    expect(built.header.snapshotBlockNumber).toBe(BigInt(CTX.prestateBlock));
    expect(built.header.snapshotHash).not.toBe(ethers.ZeroHash);
    expect(built.header.configurationDigest).toBe(CTX.configurationDigest);
    // turnoverLimit and the loss bound are sized from the plan itself.
    expect(built.header.turnoverLimit).toBe(1_000n);
    expect(built.header.maxRecognizedLoss).toBe(10n);
    expect(built.header.minFinalAssets).toBe(CTX.totalAssetsBase - 10n);
  });

  it('refuses a market with no adapter on the fork rather than guessing one', () => {
    expect(() =>
      buildForkPlan(plan([{ kind: 'deploy', marketId: 'euler', amountBase: 1n }]), CTX),
    ).toThrow(/no fork adapter registered for market 'euler'/);
  });

  it('refuses a zero decision hash — submitPlan reverts InvalidPlan on it', () => {
    expect(() =>
      buildForkPlan(
        { ...plan([{ kind: 'deploy', marketId: 'aave', amountBase: 1n }]), decisionHash: ethers.ZeroHash },
        CTX,
      ),
    ).toThrow(/zero decisionHash/);
  });
});

/**
 * A gate that says "the chain refused this allocation" must only say that
 * when the chain did. Everything else — an unmapped venue, a transport
 * failure, a nonce-class client bug — blocks too, but as infrastructure.
 */
describe('isChainRefusal', () => {
  it('is true for an EVM revert', () => {
    expect(isChainRefusal(Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' }))).toBe(true);
  });

  it('is true for a receipt mined with status 0', () => {
    expect(isChainRefusal(Object.assign(new Error('mined'), { receipt: { status: 0 } }))).toBe(true);
  });

  it('is false for a nonce fault — the class that was already misattributed once', () => {
    expect(isChainRefusal(Object.assign(new Error('nonce has already been used'), { code: 'NONCE_EXPIRED' }))).toBe(false);
  });

  it('is false for a transport failure and for a plain config error', () => {
    expect(isChainRefusal(Object.assign(new Error('could not connect'), { code: 'NETWORK_ERROR' }))).toBe(false);
    expect(isChainRefusal(new Error("no fork adapter registered for market 'euler'"))).toBe(false);
    expect(isChainRefusal('not an error at all')).toBe(false);
  });
});
