/**
 * Merkle Utilities for Plan Execution
 *
 * Implements Merkle tree operations matching NavyVaultSRCLA.sol:
 * - Leaf hash: keccak256(abi.encodePacked(actionIndex, uint8(kind), adapter, amount, minOut, dataHash))
 * - Tree building: pairs are sorted (smaller hash first)
 * - Proof verification: sorted pair hashing
 *
 * This ensures full compatibility with the contract's Merkle verification.
 */
import { ethers } from 'ethers';
import type { ActionKind } from './rebalancer-ordering.js';

/**
 * Action kind mapping
 */
export function kindToNumber(kind: ActionKind): number {
  switch (kind) {
    case 'deploy': return 0;
    case 'divest': return 1;
    case 'harvest': return 2;
    case 'emergency': return 3;
    default: return 0;
  }
}

/**
 * Action data for Merkle tree hashing
 */
export interface MerkleAction {
  /** Action index in execution order */
  index: number;
  /** Action kind (0=deploy, 1=divest, 2=harvest, 3=emergency) */
  kind: ActionKind | number;
  /** Target adapter address */
  adapter: string;
  /** Amount in base units */
  amount: bigint;
  /** Minimum output amount */
  minOut?: bigint;
  /** Data hash for verification */
  dataHash?: string;
}

/**
 * Hash an action to create a Merkle leaf
 * Matches NavyVaultSRCLA.sol:688-695:
 * keccak256(abi.encodePacked(actionIndex, uint8(kind), adapter, amount, minOut, dataHash))
 */
export function hashActionLeaf(action: MerkleAction): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['uint32', 'uint8', 'address', 'uint256', 'uint256', 'bytes32'],
      [
        action.index,
        typeof action.kind === 'string' ? kindToNumber(action.kind) : action.kind,
        action.adapter,
        action.amount,
        action.minOut ?? 0n,
        action.dataHash ?? ethers.ZeroHash,
      ]
    )
  );
}

/**
 * Combine two hashes for Merkle tree level
 * Contract sorts the pair (smaller hash first) per MerkleTree.sol:25-27
 */
function combineHash(left: string, right: string): string {
  // Sort to match contract behavior
  return left < right
    ? ethers.keccak256(ethers.concat([left, right]))
    : ethers.keccak256(ethers.concat([right, left]));
}

/**
 * Build Merkle tree from leaves and return all levels
 * Returns array of levels, level 0 is leaves, last level is root
 */
export function buildMerkleTree(leaves: string[]): string[][] {
  if (leaves.length === 0) {
    // Empty tree: return zero hash as root
    return [[ethers.ZeroHash]];
  }

  let currentLevel = leaves.map((leaf) => leaf);
  const tree: string[][] = [currentLevel];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]!;
      const right = currentLevel[i + 1] ?? left;
      nextLevel.push(combineHash(left, right));
    }

    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  return tree;
}

/**
 * Get Merkle root from leaves
 */
export function getMerkleRoot(leaves: string[]): string {
  const tree = buildMerkleTree(leaves);
  return tree[tree.length - 1]![0]!;
}

/**
 * Generate Merkle proof for an action at given index
 * Returns siblings from bottom to top (excluding root)
 */
export function generateMerkleProof(
  actions: MerkleAction[],
  targetIndex: number
): { proof: string[]; root: string } {
  if (actions.length === 0) {
    return { proof: [], root: ethers.ZeroHash };
  }

  // Hash all actions to get leaves
  const leaves = actions.map((action) => hashActionLeaf(action));

  // Build tree
  const tree = buildMerkleTree(leaves);
  const root = tree[tree.length - 1]![0]!;

  // Generate proof
  const proof: string[] = [];
  let currentIndex = targetIndex;

  for (let level = 0; level < tree.length - 1; level++) {
    const levelNodes = tree[level]!;
    const isRightNode = currentIndex % 2 === 1;

    if (isRightNode && levelNodes[currentIndex - 1] !== undefined) {
      proof.push(levelNodes[currentIndex - 1]!);
    } else if (!isRightNode && levelNodes[currentIndex + 1] !== undefined) {
      proof.push(levelNodes[currentIndex + 1]!);
    }

    currentIndex = Math.floor(currentIndex / 2);
  }

  return { proof, root };
}

/**
 * Verify Merkle proof
 * Matches MerkleTree.verifyProof in contract
 */
export function verifyMerkleProof(
  leaf: string,
  proof: string[],
  root: string
): boolean {
  let computedHash = leaf;

  for (const sibling of proof) {
    computedHash = combineHash(computedHash, sibling);
  }

  return computedHash === root;
}

/**
 * Verify a single action against a proof and root
 */
export function verifyActionProof(
  action: MerkleAction,
  proof: string[],
  root: string
): boolean {
  const leaf = hashActionLeaf(action);
  return verifyMerkleProof(leaf, proof, root);
}

/**
 * Convert OrderedAction to MerkleAction
 */
export function orderedActionToMerkleAction(
  action: {
    originalIndex: number;
    kind: ActionKind;
    adapter: string;
    amountBase: bigint;
  },
  minOut: bigint = 0n,
  dataHash: string = ethers.ZeroHash
): MerkleAction {
  return {
    index: action.originalIndex,
    kind: action.kind,
    adapter: action.adapter,
    amount: action.amountBase,
    minOut,
    dataHash,
  };
}

/**
 * Build complete Merkle tree for actions and get proofs for all
 */
export function buildActionMerkleTree(
  actions: Array<{
    originalIndex: number;
    kind: ActionKind;
    adapter: string;
    amountBase: bigint;
  }>
): {
  root: string;
  proofs: Map<number, string[]>;
} {
  if (actions.length === 0) {
    return { root: ethers.ZeroHash, proofs: new Map() };
  }

  // Create MerkleActions with proper ordering
  const merkleActions: MerkleAction[] = actions.map((a) => ({
    index: a.originalIndex,
    kind: a.kind,
    adapter: a.adapter,
    amount: a.amountBase,
    minOut: 0n,
    dataHash: ethers.ZeroHash,
  }));

  // Get root for single action
  const { root } = generateMerkleProof(merkleActions, 0);

  // For single action, proof is empty
  if (actions.length === 1) {
    return { root, proofs: new Map([[0, []]]) };
  }

  // Generate proofs for each action
  const proofs = new Map<number, string[]>();
  for (let i = 0; i < actions.length; i++) {
    const { proof: p } = generateMerkleProof(merkleActions, i);
    proofs.set(i, p);
  }

  return { root, proofs };
}
