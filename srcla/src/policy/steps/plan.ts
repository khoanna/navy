import { ethers } from 'ethers';
import type { DecisionInput, PlanDraft } from '../types.js';

/**
 * ABI tuple for `VaultTypes.PlanHeader`, field order and types read directly
 * from `contract/src/libraries/VaultTypes.sol`:
 *
 *   struct PlanHeader {
 *     uint256 planId;
 *     uint64 policyVersion;
 *     uint64 createdAt;
 *     uint64 expiresAt;
 *     uint32 actionCount;
 *     uint256 snapshotBlockNumber;
 *     bytes32 snapshotHash;
 *     bytes32 decisionHash;
 *     bytes32 configurationDigest;
 *     uint256 reserve;
 *     uint256 minFinalAssets;
 *     uint256 maxRecognizedLoss;
 *     uint256 turnoverLimit;
 *   }
 */
const HEADER_TUPLE =
  '(uint256 planId,uint64 policyVersion,uint64 createdAt,uint64 expiresAt,uint32 actionCount,' +
  'uint256 snapshotBlockNumber,bytes32 snapshotHash,bytes32 decisionHash,bytes32 configurationDigest,' +
  'uint256 reserve,uint256 minFinalAssets,uint256 maxRecognizedLoss,uint256 turnoverLimit)';

/**
 * `NavyVaultSRCLA.ActionKind` — the vault's own ordering, which is what
 * `planDomain`, `hashPlanAction` and `executeNextActionWithProof` all take.
 *
 * There used to be an inverted duplicate (`VaultTypes.ActionKind`, Divest=0,
 * Deploy=1) in the contract tree; anything reaching for it silently encoded a
 * deploy as a divest. It was deleted in 71958a21, so this ordering is now the
 * only one that exists.
 */
export const ActionKind = {
  Deploy: 0,
  Divest: 1,
  Harvest: 2,
  EmergencyExit: 3,
} as const;

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

/**
 * Mirrors `NavyVaultSRCLA.planDomain` exactly:
 *
 *   function planDomain(VaultTypes.PlanHeader calldata header) public view returns (bytes32) {
 *     return keccak256(abi.encode(block.chainid, address(this), asset(), keccak256(abi.encode(header))));
 *   }
 *
 * Read from contract/src/NavyVaultSRCLA.sol.
 */
export function planDomain(chainId: number, vault: string, asset: string, header: PlanDraft['header']): string {
  const headerHash = ethers.keccak256(coder.encode([HEADER_TUPLE], [header]));
  return ethers.keccak256(coder.encode(['uint256', 'address', 'address', 'bytes32'], [chainId, vault, asset, headerHash]));
}

/**
 * Mirrors `NavyVaultSRCLA.hashPlanAction` exactly:
 *
 *   function hashPlanAction(bytes32 domain, Action memory action) public pure returns (bytes32) {
 *     return keccak256(abi.encode(
 *       domain, action.planId, action.index, action.kind, action.adapter, action.amount, action.minOut, action.dataHash
 *     ));
 *   }
 *
 * Read from contract/src/NavyVaultSRCLA.sol. This is the leaf consumed by
 * `executeNextActionWithProof` (via `MerkleTree.verifyProof`) — NOT the older,
 * domain-less `executeAction` leaf still present in the contract
 * (`abi.encodePacked(actionIndex, uint8(kind), adapter, amount, minOut, dataHash)`),
 * which Task 14 does not use.
 */
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

/**
 * Sorted-pair hash of two bytes32 values, comparing them NUMERICALLY (as the
 * EVM does for `bytes32`), not as JS strings. `MerkleTree.sol` compares with
 * `<` on `bytes32`; since every hash here is a lowercase 0x-prefixed 64-hex
 * string of identical length, string and numeric comparison happen to agree,
 * but we compare numerically anyway so that invariant is never load-bearing.
 */
function sortedHash(a: string, b: string): string {
  return BigInt(a) < BigInt(b) ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));
}

/**
 * Mirrors `MerkleTree.computeRoot`'s tree shape exactly, level by level:
 *
 *   uint256 k = (n + 1) / 2;
 *   for (i = 0; i < k; i++) {
 *     j = i * 2;
 *     if (j + 1 < n) leaves[i] = hash(sorted(leaves[j], leaves[j+1]));
 *     else leaves[i] = leaves[j];   // odd trailing node: PROMOTED unchanged
 *   }
 *
 * Read from contract/src/libraries/MerkleTree.sol. An odd node at the end of
 * a level is promoted to the next level as-is — it is never duplicated or
 * hashed with itself. (A prior draft of this function did duplicate the odd
 * node; that produces a different root than the contract for any leaf count
 * that hits an odd level, which is silent on chain until the very first
 * `executeNextActionWithProof` call reverts with `InvalidMerkleProof`.)
 */
function merkleLevels(leaves: string[]): string[][] {
  const levels: string[][] = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      if (i + 1 < current.length) {
        next.push(sortedHash(left, current[i + 1]!));
      } else {
        next.push(left); // lone trailing node: promoted unchanged, not duplicated
      }
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

/**
 * Sibling path for `index`, matching what `MerkleTree.verifyProof` expects to
 * consume: a promoted (unpaired) node contributes NO entry at that level.
 */
function proofFor(levels: string[][], index: number): string[] {
  const proof: string[] = [];
  let idx = index;
  for (let level = 0; level < levels.length - 1; level++) {
    const nodes = levels[level]!;
    if (idx % 2 === 0) {
      if (idx + 1 < nodes.length) proof.push(nodes[idx + 1]!);
      // else: this node was promoted unchanged at this level — no sibling recorded
    } else {
      proof.push(nodes[idx - 1]!);
    }
    idx = Math.floor(idx / 2);
  }
  return proof;
}

interface ActionDraft {
  kind: 0 | 1;
  adapter: string;
  amountBase: bigint;
  minOutBase: bigint;
}

/**
 * §9.5 — a staged execution plan. Divestment actions precede deployment
 * actions so the vault is never asked to deploy funds it has not yet
 * recovered from another venue.
 *
 * PURE: takes all time/state from `input` and `opts`; no `Date.now()`, no
 * randomness, no I/O. Same inputs always produce the same plan, including the
 * same `merkleRoot` and per-action proofs.
 */
export function buildPlan(
  input: DecisionInput,
  target: Map<string, bigint>,
  reserveBase: bigint,
  decisionHash: string,
  opts: BuildPlanOpts
): PlanDraft | null {
  if (opts.snapshotHash === ethers.ZeroHash) {
    throw new Error('snapshotHash must be non-zero: NavyVaultSRCLA.submitPlan reverts InvalidPlan on a zero snapshot hash');
  }
  if (decisionHash === ethers.ZeroHash) {
    throw new Error('decisionHash must be non-zero: NavyVaultSRCLA.submitPlan reverts InvalidPlan on a zero decision hash');
  }
  if (opts.expirySeconds <= 0) {
    throw new Error('expirySeconds must be positive: submitPlan reverts InvalidPlan when expiresAt <= createdAt');
  }

  const divests: ActionDraft[] = [];
  const deploys: ActionDraft[] = [];

  for (const m of [...input.markets].sort((a, b) => (a.marketId < b.marketId ? -1 : a.marketId > b.marketId ? 1 : 0))) {
    const delta = (target.get(m.marketId) ?? 0n) - m.positionBase;
    if (delta === 0n) continue;
    const amount = delta > 0n ? delta : -delta;
    const minOut = (amount * BigInt(10_000 - opts.maxLossBps)) / 10_000n;
    if (delta < 0n) {
      divests.push({ kind: ActionKind.Divest, adapter: m.adapter, amountBase: amount, minOutBase: minOut });
    } else {
      deploys.push({ kind: ActionKind.Deploy, adapter: m.adapter, amountBase: amount, minOutBase: minOut });
    }
  }

  const ordered = [...divests, ...deploys];
  if (ordered.length === 0) return null;

  const planId = BigInt(decisionHash) & ((1n << 255n) - 1n);
  if (planId === 0n) {
    // Astronomically unlikely (requires the low 255 bits of decisionHash to
    // be all zero) but one line to guard, versus an unexplained on-chain
    // InvalidPlan revert if it ever happened.
    throw new Error('planId derived from decisionHash is zero: submitPlan reverts InvalidPlan on a zero plan id');
  }
  const createdAt = BigInt(input.origin.timestampSeconds);
  const turnover = ordered.reduce((sum, a) => sum + a.amountBase, 0n);
  const maxRecognizedLoss = (turnover * BigInt(opts.maxLossBps)) / 10_000n;
  const minFinalAssets = input.vault.totalAssetsBase - maxRecognizedLoss;
  if (minFinalAssets < 0n) {
    throw new Error(
      `minFinalAssets would be negative (totalAssetsBase=${input.vault.totalAssetsBase} < maxRecognizedLoss=${maxRecognizedLoss}): ` +
        'turnover is too large relative to vault assets for maxLossBps'
    );
  }

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
    minFinalAssets,
    maxRecognizedLoss,
    turnoverLimit: opts.turnoverLimitBase,
  };

  const domain = planDomain(opts.chainId, opts.vaultAddress, opts.assetAddress, header);

  const leaves = ordered.map((a, index) =>
    hashPlanAction(domain, {
      planId,
      index,
      kind: a.kind,
      adapter: a.adapter,
      amountBase: a.amountBase,
      minOutBase: a.minOutBase,
      dataHash: ethers.ZeroHash,
    })
  );
  const levels = merkleLevels(leaves);
  const merkleRoot = levels[levels.length - 1]![0]!;

  return {
    planId: `0x${planId.toString(16).padStart(64, '0')}`,
    decisionHash,
    merkleRoot,
    actions: ordered.map((a, index) => ({
      index,
      kind: a.kind,
      adapter: a.adapter,
      amountBase: a.amountBase,
      minOutBase: a.minOutBase,
      dataHash: ethers.ZeroHash,
      proof: proofFor(levels, index),
    })),
    header,
  };
}
