import { ethers } from 'ethers';
import { planDomain, hashPlanAction, buildPlan } from '../../../src/policy/steps/plan.js';
import type { BuildPlanOpts } from '../../../src/policy/steps/plan.js';
import type { DecisionInput, MarketObservation, PlanDraft } from '../../../src/policy/types.js';

const HEADER_TUPLE =
  '(uint256 planId,uint64 policyVersion,uint64 createdAt,uint64 expiresAt,uint32 actionCount,' +
  'uint256 snapshotBlockNumber,bytes32 snapshotHash,bytes32 decisionHash,bytes32 configurationDigest,' +
  'uint256 reserve,uint256 minFinalAssets,uint256 maxRecognizedLoss,uint256 turnoverLimit)';

function market(id: string, position: bigint): MarketObservation {
  return {
    marketId: id,
    adapter: ethers.getAddress(`0x${id.padEnd(40, '0')}`),
    protocol: 'aave',
    cash: 10n ** 12n,
    borrows: 0n,
    reserves: 0n,
    supplyRateWad: 10n ** 16n,
    utilizationWad: 0n,
    positionBase: position,
    maxDeployableBase: 10n ** 12n,
    maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd',
    regimeId: 'r1',
    paused: false,
    capBps: 10000,
    absoluteCapBase: 10n ** 13n,
    maxLossBps: 50,
    dependencyGroupIds: [],
  };
}

function input(markets: MarketObservation[]): DecisionInput {
  return {
    origin: { blockNumber: 12345, blockHash: '0x' + 'ab'.repeat(32), timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n,
      idleBase: 5_000_000_000n,
      sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0x' + 'cd'.repeat(32),
    },
    markets,
    dependencyGroups: [],
    withdrawals: [],
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: [],
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
  };
}

const OPTS: BuildPlanOpts = {
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

// ---------------------------------------------------------------------------
// A faithful, independent TypeScript port of MerkleTree.sol, kept entirely
// separate from src/policy/steps/plan.ts's own tree logic. This is the guard:
// if plan.ts's tree ever drifts from the contract's actual semantics, this
// port — read from contract/src/libraries/MerkleTree.sol, not from plan.ts —
// will not drift with it, and the parity assertions below will catch it.
//
//   function computeRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
//     if (leaves.length == 0) return bytes32(0);
//     if (leaves.length == 1) return leaves[0];
//     uint256 n = leaves.length;
//     while (n > 1) {
//       uint256 k = (n + 1) / 2;
//       for (uint256 i = 0; i < k; i++) {
//         uint256 j = i * 2;
//         if (j + 1 < n) {
//           leaves[i] = leaves[j] < leaves[j + 1]
//             ? keccak256(abi.encodePacked(leaves[j], leaves[j + 1]))
//             : keccak256(abi.encodePacked(leaves[j + 1], leaves[j]));
//         } else {
//           leaves[i] = leaves[j];   // ODD TRAILING NODE: PROMOTED, NOT DUPLICATED
//         }
//       }
//       n = k;
//     }
//     return leaves[0];
//   }
//
//   function verifyProof(bytes32 leaf, bytes32[] memory proof, bytes32 root) internal pure returns (bool) {
//     bytes32 computedHash = leaf;
//     for (uint256 i = 0; i < proof.length; i++) {
//       computedHash = computedHash < proof[i]
//         ? keccak256(abi.encodePacked(computedHash, proof[i]))
//         : keccak256(abi.encodePacked(proof[i], computedHash));
//     }
//     return computedHash == root;
//   }
// ---------------------------------------------------------------------------

/** Numeric bytes32 comparison, matching Solidity's `<` on bytes32 — NOT a JS string compare. */
function bytes32Lt(a: string, b: string): boolean {
  return BigInt(a) < BigInt(b);
}

function portedPairHash(a: string, b: string): string {
  return bytes32Lt(a, b) ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));
}

function portedComputeRoot(leaves: string[]): string {
  if (leaves.length === 0) return ethers.ZeroHash;
  if (leaves.length === 1) return leaves[0]!;
  let level = leaves;
  let n = level.length;
  while (n > 1) {
    const k = Math.ceil(n / 2);
    const next: string[] = new Array(k);
    for (let i = 0; i < k; i++) {
      const j = i * 2;
      next[i] = j + 1 < n ? portedPairHash(level[j]!, level[j + 1]!) : level[j]!;
    }
    level = next;
    n = k;
  }
  return level[0]!;
}

function portedVerifyProof(leaf: string, proof: string[], root: string): boolean {
  let computed = leaf;
  for (const sibling of proof) {
    computed = bytes32Lt(computed, sibling)
      ? ethers.keccak256(ethers.concat([computed, sibling]))
      : ethers.keccak256(ethers.concat([sibling, computed]));
  }
  return computed === root;
}

/** Builds n distinct, valid-hex two-char market ids: 'a0', 'a1', ... */
function nMarketIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `a${i.toString(16)}`);
}

function leavesFor(plan: PlanDraft): string[] {
  const domain = planDomain(OPTS.chainId, OPTS.vaultAddress, OPTS.assetAddress, plan.header);
  return plan.actions.map((a) =>
    hashPlanAction(domain, {
      planId: plan.header.planId,
      index: a.index,
      kind: a.kind,
      adapter: a.adapter,
      amountBase: a.amountBase,
      minOutBase: a.minOutBase,
      dataHash: a.dataHash,
    })
  );
}

describe('encoding parity with NavyVaultSRCLA', () => {
  it('planDomain matches keccak(abi.encode(chainid, vault, asset, keccak(abi.encode(header))))', () => {
    const header = {
      planId: 1n,
      policyVersion: 5n,
      createdAt: 100n,
      expiresAt: 200n,
      actionCount: 1n,
      snapshotBlockNumber: 12345n,
      snapshotHash: OPTS.snapshotHash,
      decisionHash: DECISION_HASH,
      configurationDigest: '0x' + 'cd'.repeat(32),
      reserve: 0n,
      minFinalAssets: 0n,
      maxRecognizedLoss: 0n,
      turnoverLimit: 0n,
    };
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const headerHash = ethers.keccak256(coder.encode([HEADER_TUPLE], [header]));
    const expected = ethers.keccak256(
      coder.encode(['uint256', 'address', 'address', 'bytes32'], [OPTS.chainId, OPTS.vaultAddress, OPTS.assetAddress, headerHash])
    );
    expect(planDomain(OPTS.chainId, OPTS.vaultAddress, OPTS.assetAddress, header)).toBe(expected);
  });

  it('hashPlanAction matches keccak(abi.encode(domain, planId, index, kind, adapter, amount, minOut, dataHash))', () => {
    const domain = '0x' + '77'.repeat(32);
    const action = {
      planId: 1n,
      index: 0,
      kind: 0 as const,
      adapter: ethers.getAddress('0x' + '22'.repeat(20)),
      amountBase: 1_000_000n,
      minOutBase: 999_000n,
      dataHash: ethers.ZeroHash,
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

// ---------------------------------------------------------------------------
// Golden vectors produced by the REAL, deployed NavyVaultSRCLA contract via
// Foundry — an oracle independent of this file's own ethers.AbiCoder calls.
// The "encoding parity" tests above recompute their "expected" value with the
// same AbiCoder call plan.ts uses, so they only prove self-consistency; they
// cannot catch a shared misunderstanding of the ABI encoding (e.g. a wrong
// field order or type that both plan.ts and the test happen to agree on).
// These vectors close that gap.
//
// Produced by:
//   cd contract && forge test --match-contract PlanEncodingGoldenVectorsTest -vv
//
// contract/test/vault/PlanEncodingGoldenVectors.t.sol deploys the real
// NavyVaultSRCLA (constructor-only dependency: an IERC20 asset), pins
// block.chainid to 8453 via vm.chainId, and calls the contract's own
// `planDomain(header)` and `hashPlanAction(domain, action)` — not a
// reimplementation — on the fixed inputs below. Raw `forge test -vv` output:
//
//   chainId 8453
//   vaultAddress 0x2e234DAe75C793f67A35089C9d99245E1C58470b
//   assetAddress 0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f
//   ---- header ----
//   planId 12345
//   policyVersion 7
//   createdAt 1700000001
//   expiresAt 1700003601
//   actionCount 2
//   snapshotBlockNumber 999999
//   snapshotHash 0x5886d976d335b9a18c8f4bb0e523acb577bea416864a9f220659914f5d3674f4  [64 hex digits after 0x]
//   decisionHash 0x8ef7bda8cbeec8a5db25c2d8f4cc25779da7b31a094795a99a7bb5e2ce4b3e4e
//   configurationDigest 0x32b88e33cfd58c3beef1ec61b91d84dd66fe0dea661dfdf5f5adcc4c09b0ef56
//   reserve 5000000
//   minFinalAssets 900000000
//   maxRecognizedLoss 25000000
//   turnoverLimit 50000000
//   ---- domain ----
//   0x82767e150a9370b2dee4881ad9aa3e1f56f1d260bb850256ad1eefb00f5fa63f
//   ---- action0 ----
//   adapter 0xAdA97e000000000000000000000000000000BEEf
//   amount 1234567
//   minOut 1200000
//   dataHash 0x9fe21052060c44e8fe0ba4fe77887af1936d55a869f594e0ff9d902a9c39c594
//   leaf0 0xfa05abaa02a2bb676687179a77eeb60f74c4d5593e50820bdf6f54d8fd20dc06
//   ---- action1 ----
//   adapter 0xaDa97E000000000000000000000000000001CaFe
//   amount 7654321
//   minOut 7600000
//   dataHash 0x3281c3a4cc5e7cb93f66a89f259a78eb737c939f43687da860b9068fc351524e
//   leaf1 0x8f569f612886048ffaebde53a8db73dcb2ecdcf359a680c0975c781d11c0bd0f
//
// (The console2 log lines above wrap each bytes32 onto its own line; the
// hex payload of every one of them is exactly 64 hex digits — verified with
// `python3 -c "print(len(...))"` while transcribing — the line-wrapped
// rendering above can look longer than 64 at a glance.)
describe('golden vectors from the real NavyVaultSRCLA contract (Foundry oracle)', () => {
  const GOLDEN_CHAIN_ID = 8453;
  const GOLDEN_VAULT_ADDRESS = ethers.getAddress('0x2e234DAe75C793f67A35089C9d99245E1C58470b');
  const GOLDEN_ASSET_ADDRESS = ethers.getAddress('0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f');

  const GOLDEN_HEADER: PlanDraft['header'] = {
    planId: 12345n,
    policyVersion: 7n,
    createdAt: 1_700_000_001n,
    expiresAt: 1_700_003_601n,
    actionCount: 2n,
    snapshotBlockNumber: 999_999n,
    snapshotHash: '0x5886d976d335b9a18c8f4bb0e523acb577bea416864a9f220659914f5d3674f4',
    decisionHash: '0x8ef7bda8cbeec8a5db25c2d8f4cc25779da7b31a094795a99a7bb5e2ce4b3e4e',
    configurationDigest: '0x32b88e33cfd58c3beef1ec61b91d84dd66fe0dea661dfdf5f5adcc4c09b0ef56',
    reserve: 5_000_000n,
    minFinalAssets: 900_000_000n,
    maxRecognizedLoss: 25_000_000n,
    turnoverLimit: 50_000_000n,
  };

  const GOLDEN_DOMAIN = '0x82767e150a9370b2dee4881ad9aa3e1f56f1d260bb850256ad1eefb00f5fa63f';

  const GOLDEN_ACTION_0 = {
    planId: GOLDEN_HEADER.planId,
    index: 0,
    kind: 0 as const, // Deploy
    adapter: ethers.getAddress('0xAdA97e000000000000000000000000000000BEEf'),
    amountBase: 1_234_567n,
    minOutBase: 1_200_000n,
    dataHash: '0x9fe21052060c44e8fe0ba4fe77887af1936d55a869f594e0ff9d902a9c39c594',
  };
  const GOLDEN_LEAF_0 = '0xfa05abaa02a2bb676687179a77eeb60f74c4d5593e50820bdf6f54d8fd20dc06';

  const GOLDEN_ACTION_1 = {
    planId: GOLDEN_HEADER.planId,
    index: 1,
    kind: 1 as const, // Divest
    adapter: ethers.getAddress('0xaDa97E000000000000000000000000000001CaFe'),
    amountBase: 7_654_321n,
    minOutBase: 7_600_000n,
    dataHash: '0x3281c3a4cc5e7cb93f66a89f259a78eb737c939f43687da860b9068fc351524e',
  };
  const GOLDEN_LEAF_1 = '0x8f569f612886048ffaebde53a8db73dcb2ecdcf359a680c0975c781d11c0bd0f';

  it('planDomain reproduces the on-chain NavyVaultSRCLA.planDomain(header) output', () => {
    expect(planDomain(GOLDEN_CHAIN_ID, GOLDEN_VAULT_ADDRESS, GOLDEN_ASSET_ADDRESS, GOLDEN_HEADER)).toBe(GOLDEN_DOMAIN);
  });

  it('hashPlanAction reproduces the on-chain NavyVaultSRCLA.hashPlanAction(domain, action) output for two distinct actions', () => {
    expect(hashPlanAction(GOLDEN_DOMAIN, GOLDEN_ACTION_0)).toBe(GOLDEN_LEAF_0);
    expect(hashPlanAction(GOLDEN_DOMAIN, GOLDEN_ACTION_1)).toBe(GOLDEN_LEAF_1);
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
    // Confirm this fixture actually creates a mixed divest+deploy plan, not a
    // one-action plan that would trivially satisfy "ordering".
    expect(plan.actions.length).toBe(2);
  });

  it('throws on a zero snapshotHash — the bug that made every submitPlan revert', () => {
    const i = input([market('aa', 0n)]);
    const zeroSnapshotOpts: BuildPlanOpts = { ...OPTS, snapshotHash: ethers.ZeroHash };
    expect(() => buildPlan(i, new Map([['aa', 1_000_000_000n]]), 0n, DECISION_HASH, zeroSnapshotOpts)).toThrow();
  });

  it('throws on a zero decisionHash — submitPlan reverts InvalidPlan on header.decisionHash == 0 too', () => {
    const i = input([market('aa', 0n)]);
    expect(() => buildPlan(i, new Map([['aa', 1_000_000_000n]]), 0n, ethers.ZeroHash, OPTS)).toThrow();
  });

  it('throws when expirySeconds is not positive — submitPlan reverts InvalidPlan when expiresAt <= createdAt', () => {
    const i = input([market('aa', 0n)]);
    const target = new Map([['aa', 1_000_000_000n]]);
    expect(() => buildPlan(i, target, 0n, DECISION_HASH, { ...OPTS, expirySeconds: 0 })).toThrow();
    expect(() => buildPlan(i, target, 0n, DECISION_HASH, { ...OPTS, expirySeconds: -1 })).toThrow();
  });

  it('throws when the masked planId would be zero, instead of letting submitPlan revert unexplained on chain', () => {
    // decisionHash chosen so BigInt(decisionHash) & ((1n<<255n)-1n) == 0n:
    // only the top (256th) bit is set, every bit buildPlan actually keeps is
    // zero. decisionHash itself is non-zero, so this exercises the planId
    // guard specifically, not the decisionHash guard above.
    const decisionHashWithZeroMaskedPlanId = '0x8' + '0'.repeat(63);
    expect(BigInt(decisionHashWithZeroMaskedPlanId) & ((1n << 255n) - 1n)).toBe(0n); // sanity on the fixture itself
    const i = input([market('aa', 0n)]);
    expect(() => buildPlan(i, new Map([['aa', 1_000_000_000n]]), 0n, decisionHashWithZeroMaskedPlanId, OPTS)).toThrow();
  });

  it('throws rather than emit a negative minFinalAssets when turnover swamps totalAssetsBase', () => {
    // maxLossBps=50 (0.5%): maxRecognizedLoss exceeds totalAssetsBase
    // (10_000_000_000n) once turnover passes 2_000_000_000_000n; 3e12 is
    // comfortably past that line, so this genuinely drives minFinalAssets
    // negative rather than merely approaching zero.
    const i = input([market('aa', 0n)]);
    const target = new Map([['aa', 3_000_000_000_000n]]);
    expect(() => buildPlan(i, target, 0n, DECISION_HASH, OPTS)).toThrow(/minFinalAssets/);
  });

  it('carries the real (non-zero) snapshot hash and block number through to the header when actions exist', () => {
    const i = input([market('aa', 0n)]);
    const plan = buildPlan(i, new Map([['aa', 1_000_000_000n]]), 0n, DECISION_HASH, OPTS)!;
    expect(plan.header.snapshotHash).toBe(OPTS.snapshotHash);
    expect(plan.header.snapshotHash).not.toBe(ethers.ZeroHash);
    expect(plan.header.snapshotBlockNumber).toBe(12345n);
  });

  it('carries real risk limits, not zeros', () => {
    const i = input([market('aa', 0n)]);
    const plan = buildPlan(i, new Map([['aa', 4_000_000_000n]]), 1_000_000_000n, DECISION_HASH, OPTS)!;
    expect(plan.header.reserve).toBe(1_000_000_000n);
    expect(plan.header.minFinalAssets).toBeGreaterThan(0n);
    expect(plan.header.minFinalAssets).toBeLessThan(i.vault.totalAssetsBase);
    expect(plan.header.maxRecognizedLoss).toBeGreaterThan(0n);
    expect(plan.header.turnoverLimit).toBeGreaterThan(0n);
  });

  it('assigns contiguous indices starting at zero', () => {
    const i = input([market('aa', 2_000_000_000n), market('bb', 0n)]);
    const plan = buildPlan(i, new Map([['aa', 0n], ['bb', 2_000_000_000n]]), 0n, DECISION_HASH, OPTS)!;
    expect(plan.actions.map((a) => a.index)).toEqual([0, 1]);
    expect(plan.header.actionCount).toBe(2n);
  });

  describe.each([1, 2, 3, 4, 5])('action count = %i (Merkle parity against the ported MerkleTree.sol)', (n) => {
    it(`buildPlan's merkleRoot equals the ported computeRoot, and every action's proof verifies via the ported verifyProof`, () => {
      const ids = nMarketIds(n);
      const markets = ids.map((id) => market(id, 0n));
      const target = new Map(ids.map((id, k) => [id, BigInt(1_000_000 * (k + 1))]));
      const i = input(markets);
      const plan = buildPlan(i, target, 0n, DECISION_HASH, OPTS)!;

      // Sanity: this fixture must actually produce n actions, or the parity
      // assertion below would pass vacuously without exercising the n-leaf
      // tree shape its describe block name claims.
      expect(plan.actions.length).toBe(n);
      expect(plan.header.actionCount).toBe(BigInt(n));

      const leaves = leavesFor(plan);
      const expectedRoot = portedComputeRoot(leaves);
      expect(plan.merkleRoot).toBe(expectedRoot);

      for (let idx = 0; idx < plan.actions.length; idx++) {
        const action = plan.actions[idx]!;
        expect(action.index).toBe(idx);
        expect(portedVerifyProof(leaves[idx]!, action.proof, plan.merkleRoot)).toBe(true);
      }
    });
  });

  it('produces a proof that verifies against the root for a mixed divest+deploy plan (regression for the original brief fixture)', () => {
    const i = input([market('aa', 2_000_000_000n), market('bb', 0n)]);
    const plan = buildPlan(i, new Map([['aa', 0n], ['bb', 2_000_000_000n]]), 0n, DECISION_HASH, OPTS)!;
    const leaves = leavesFor(plan);
    expect(portedComputeRoot(leaves)).toBe(plan.merkleRoot);
    for (let idx = 0; idx < plan.actions.length; idx++) {
      expect(portedVerifyProof(leaves[idx]!, plan.actions[idx]!.proof, plan.merkleRoot)).toBe(true);
    }
  });
});
