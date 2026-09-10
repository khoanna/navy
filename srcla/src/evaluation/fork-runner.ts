/**
 * Paper §11.1's per-policy PINNED-PRESTATE FORK REPLAY.
 *
 * §11.1: "Counterfactual Base-fork executions restore the same pinned
 * prestate before each candidate policy." `runForkReplays` is what does
 * that, and `kernel/harness.ts#runRegisteredForkReplays` is its caller.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ESTABLISHES, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * It establishes that the allocation a policy PROPOSES is one the deployed
 * `NavyVaultSRCLA` on a Base fork will actually accept: the plan is built
 * exactly as the production keeper builds one (`policy/steps/plan.ts`'s
 * `planDomain`/`hashPlanAction`/Merkle shape), submitted through
 * `submitPlan`, and executed action by action through
 * `executeNextActionWithProof` — so every on-chain guardrail (adapter
 * registration, exposure caps, `minIdleBps`, the plan's own
 * `minFinalAssets`/`maxRecognizedLoss`/`turnoverLimit`, the sequential index,
 * the Merkle proof and the configuration-digest recheck) is applied by the
 * contract, not asserted here.
 *
 * It does NOT re-derive returns on chain, and it does not replay every origin
 * of an era: each `ForkReplayPlan` carries ONE origin's proposal per
 * (policy, tier). A replay of all ~17,700 origins would need an archive fork
 * per origin and is not what the §11.5 completeness check asks for; what it
 * asks for is that each required (policy, tier) has a replay that executed.
 * The `detail` on every result says which origin was replayed so a reader is
 * never left to assume it was all of them.
 *
 * TIME. The plan HEADER's `createdAt`/`expiresAt` are taken from the fork's
 * block timestamp, not the historical origin's: `submitPlan` reverts
 * `InvalidPlan` on `createdAt > block.timestamp` and `PlanExecutionExpired`
 * on an `expiresAt` in the past, so a 2024 origin's window could never be
 * submitted against a 2026 fork head. The plan's IDENTITY — its
 * `decisionHash`, its action list, amounts and ordering — is the policy's and
 * is replayed unchanged. `snapshotBlockNumber` is the PINNED prestate block.
 *
 * PRESTATE. `evm_snapshot` is taken once, before the first policy; every
 * policy is preceded by an `evm_revert` back to it and a re-snapshot (Anvil
 * invalidates a snapshot id on revert). A FINGERPRINT of the prestate
 * (block number, vault NAV, idle asset balance, every adapter's
 * `strategyAssets`) is recomputed after each restore and compared against the
 * pinned one: a policy whose prestate does not match the pin is reported
 * `executed: false` rather than silently being run against a different chain.
 */

import { ethers, JsonRpcProvider, Contract, Wallet } from 'ethers';
import { merkleLevels, planDomain, hashPlanAction, proofFor, ActionKind } from '../policy/steps/plan.js';
import type { ForkReplayResult } from './kernel/gates.js';
import type { PlanDraft } from '../policy/types.js';

/** One proposed move, in the shape `replay/replay.ts` emits. */
export interface ForkReplayAction {
  kind: 'deploy' | 'divest';
  /** Registered venue id (`compound` | `aave` | `moonwell`), NOT an address. */
  marketId: string;
  /** USDC base units (6 dp). */
  amountBase: bigint;
}

/** One (policy, tier)'s proposal at ONE origin, to be replayed on the fork. */
/**
 * A kernel decision hash as the `bytes32` `submitPlan` takes.
 *
 * The kernel stores `decisionHash` UNPREFIXED -- `decide.ts` adds `0x` only
 * when it builds a plan -- while a stand-in produced by `keccak256` for a
 * shape that never ran the kernel arrives already prefixed. `buildForkPlan`
 * derives the planId with `BigInt(decisionHash)`, which throws on the
 * unprefixed form. Left unnormalised, every policy that RAN THE KERNEL failed
 * to replay with "Cannot convert <64 hex> to a BigInt" while the two
 * hash-less shapes replayed fine: §11.1 reported 2 of 64 executed and the
 * release gate blocked on infrastructure rather than on anything the chain
 * had decided.
 *
 * Throws rather than coercing anything that is not 32 bytes of hex: a
 * malformed hash must fail here, where the message names the policy, not
 * inside an `eth_call`.
 */
export function forkDecisionHash(hash: string, label: string): string {
  const withPrefix = hash.startsWith('0x') ? hash : `0x${hash}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error(
      `decision hash '${hash}' for ${label} is not 32 bytes of hex; submitPlan takes a bytes32`,
    );
  }
  return withPrefix;
}

export interface ForkReplayPlan {
  policyId: string;
  tier: bigint;
  /** Index of the origin within the evaluated era whose proposal this is. */
  originIndex: number;
  /** The kernel decision hash for that origin. Must be non-zero. */
  decisionHash: string;
  actions: readonly ForkReplayAction[];
  /** §8.1's reserve for that decision, if the run recorded one. */
  reserveBase?: bigint;
}

export interface ForkReplayOptions {
  /** RPC of a RUNNING Anvil fork of Base. */
  rpcUrl: string;
  /** The block the prestate is pinned at. Must be the fork's current head. */
  prestateBlock: number;
  /** Deployed `NavyVaultSRCLA` on that fork. */
  vaultAddress: string;
  /** Key holding ALLOCATOR_ROLE on that vault. */
  allocatorPrivateKey: string;
  /** marketId -> the `IYieldAdapter` registered on the vault for that venue. */
  adapterByMarketId: Readonly<Record<string, string>>;
  /** Per-action tolerated slippage; also sizes `maxRecognizedLoss`. */
  maxLossBps?: number;
  /** Plan validity window, seconds from the fork head's timestamp. */
  planExpirySeconds?: number;
  /** Gas limit for plan transactions. */
  gasLimit?: bigint;
}

const VAULT_ABI = [
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function strategyAssets(address) view returns (uint256)',
  'function registeredAdapters(address) view returns (bool)',
  'function currentConfigurationDigest() view returns (bytes32)',
  'function activePlanId() view returns (bytes32)',
  'function activePlanNextActionIndex() view returns (uint64)',
  'function ALLOCATOR_ROLE() view returns (bytes32)',
  'function hasRole(bytes32,address) view returns (bool)',
  'function cancelPlan()',
  'function submitPlan((uint256 planId, uint64 policyVersion, uint64 createdAt, uint64 expiresAt, uint32 actionCount, uint256 snapshotBlockNumber, bytes32 snapshotHash, bytes32 decisionHash, bytes32 configurationDigest, uint256 reserve, uint256 minFinalAssets, uint256 maxRecognizedLoss, uint256 turnoverLimit) header, bytes32 merkleRoot)',
  'function executeNextActionWithProof(bytes32[] merkleProof, (uint256 planId, uint32 index, uint8 kind, address adapter, uint256 amount, uint256 minOut, bytes32 dataHash) action)',
];

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

/** The measurable identity of the pinned prestate. */
export interface PrestateFingerprint {
  blockNumber: number;
  totalAssetsBase: bigint;
  idleBase: bigint;
  /** adapter address (lowercased) -> strategyAssets */
  strategyAssets: Record<string, bigint>;
}

export function fingerprintDigest(f: PrestateFingerprint): string {
  const legs = Object.keys(f.strategyAssets)
    .sort()
    .map((a) => `${a}:${f.strategyAssets[a]!.toString()}`)
    .join(',');
  return ethers.keccak256(
    ethers.toUtf8Bytes(`${f.blockNumber}|${f.totalAssetsBase}|${f.idleBase}|${legs}`),
  );
}

async function readPrestate(
  provider: JsonRpcProvider,
  vault: Contract,
  asset: Contract,
  adapters: readonly string[],
): Promise<PrestateFingerprint> {
  const blockNumber = await provider.getBlockNumber();
  const totalAssetsBase = (await vault.totalAssets!()) as bigint;
  const idleBase = (await asset.balanceOf!(await vault.getAddress())) as bigint;
  const strategyAssets: Record<string, bigint> = {};
  for (const a of adapters) {
    strategyAssets[a.toLowerCase()] = (await vault.strategyAssets!(a)) as bigint;
  }
  return { blockNumber, totalAssetsBase, idleBase, strategyAssets };
}

/**
 * A chain REFUSAL is the vault (or a venue) rejecting the plan: an EVM revert,
 * or a receipt mined with `status === 0`. Everything else — an unmapped
 * `marketId`, a transport or RPC failure, a nonce-class client bug, a gas-limit
 * problem — never established anything about the allocation and MUST NOT be
 * reported as the chain refusing it.
 *
 * Both outcomes are `executed: false` and both block. What differs is the
 * sentence a reader will quote out of the gate.
 */
export function isChainRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'CALL_EXCEPTION') {
    // A CALL_EXCEPTION with a receipt is a mined, reverted transaction; one
    // without is a failed eth_call/estimateGas, which is still the node
    // executing the transaction and rejecting it.
    return true;
  }
  const receipt = (error as { receipt?: { status?: number | null } }).receipt;
  if (receipt !== undefined && receipt !== null && receipt.status === 0) return true;
  return false;
}

/** Marks a failure that never reached — or never got a verdict from — the chain. */
class ForkInfrastructureError extends Error {}

/**
 * Assemble the on-chain plan for one proposal. Mirrors
 * `policy/steps/plan.ts#buildPlan`'s encoding exactly — divests before
 * deploys (`_enforceDivestBeforeDeploy`), the same header tuple, the same
 * domain-bound leaves, the same Merkle shape — but takes its header time and
 * configuration digest from the LIVE fork rather than from a `DecisionInput`,
 * for the reason in the module header.
 */
export function buildForkPlan(
  plan: ForkReplayPlan,
  ctx: {
    chainId: number;
    vaultAddress: string;
    assetAddress: string;
    adapterByMarketId: Readonly<Record<string, string>>;
    configurationDigest: string;
    totalAssetsBase: bigint;
    prestateBlock: number;
    nowSeconds: number;
    expirySeconds: number;
    maxLossBps: number;
  },
): {
  header: PlanDraft['header'];
  merkleRoot: string;
  actions: Array<{
    planId: bigint;
    index: number;
    kind: number;
    adapter: string;
    amount: bigint;
    minOut: bigint;
    dataHash: string;
    proof: string[];
  }>;
} | null {
  if (plan.actions.length === 0) return null;
  if (plan.decisionHash === ethers.ZeroHash) {
    throw new Error(`plan ${plan.policyId}@${plan.tier}: zero decisionHash — submitPlan reverts InvalidPlan`);
  }

  const resolve = (marketId: string): string => {
    const addr = ctx.adapterByMarketId[marketId] ?? ctx.adapterByMarketId[marketId.toLowerCase()];
    if (addr === undefined) {
      throw new Error(
        `no fork adapter registered for market '${marketId}'; adapterByMarketId covers ` +
          `[${Object.keys(ctx.adapterByMarketId).join(', ')}]`,
      );
    }
    return addr;
  };

  const drafts = [...plan.actions]
    .sort((a, b) => (a.marketId < b.marketId ? -1 : a.marketId > b.marketId ? 1 : 0))
    .map((a) => ({
      kind: a.kind === 'divest' ? ActionKind.Divest : ActionKind.Deploy,
      adapter: resolve(a.marketId),
      amountBase: a.amountBase,
      minOutBase: (a.amountBase * BigInt(10_000 - ctx.maxLossBps)) / 10_000n,
    }))
    .filter((a) => a.amountBase > 0n);
  if (drafts.length === 0) return null;

  // Divests first: the vault refuses a Deploy once a Divest is pending.
  const ordered = [
    ...drafts.filter((a) => a.kind === ActionKind.Divest),
    ...drafts.filter((a) => a.kind !== ActionKind.Divest),
  ];

  const planId = BigInt(plan.decisionHash) & ((1n << 255n) - 1n);
  if (planId === 0n) throw new Error('planId derived from decisionHash is zero');

  const turnover = ordered.reduce((sum, a) => sum + a.amountBase, 0n);
  const maxRecognizedLoss = (turnover * BigInt(ctx.maxLossBps)) / 10_000n;
  const minFinalAssets =
    ctx.totalAssetsBase > maxRecognizedLoss ? ctx.totalAssetsBase - maxRecognizedLoss : 0n;

  const header: PlanDraft['header'] = {
    planId,
    policyVersion: 1n,
    createdAt: BigInt(ctx.nowSeconds),
    expiresAt: BigInt(ctx.nowSeconds + ctx.expirySeconds),
    actionCount: BigInt(ordered.length),
    snapshotBlockNumber: BigInt(ctx.prestateBlock),
    // Non-zero and bound to the replayed origin: submitPlan rejects zero.
    snapshotHash: ethers.keccak256(
      ethers.toUtf8Bytes(`${plan.policyId}|${plan.tier}|${plan.originIndex}|${ctx.prestateBlock}`),
    ),
    decisionHash: plan.decisionHash,
    configurationDigest: ctx.configurationDigest,
    reserve: plan.reserveBase ?? 0n,
    minFinalAssets,
    maxRecognizedLoss,
    turnoverLimit: turnover,
  };

  const domain = planDomain(ctx.chainId, ctx.vaultAddress, ctx.assetAddress, header);
  const leaves = ordered.map((a, index) =>
    hashPlanAction(domain, {
      planId,
      index,
      kind: a.kind,
      adapter: a.adapter,
      amountBase: a.amountBase,
      minOutBase: a.minOutBase,
      dataHash: ethers.ZeroHash,
    }),
  );
  const levels = merkleLevels(leaves);

  return {
    header,
    merkleRoot: levels[levels.length - 1]![0]!,
    actions: ordered.map((a, index) => ({
      planId,
      index,
      kind: a.kind,
      adapter: a.adapter,
      amount: a.amountBase,
      minOut: a.minOutBase,
      dataHash: ethers.ZeroHash,
      proof: proofFor(levels, index),
    })),
  };
}

/**
 * Replay each (policy, tier)'s proposal against the pinned prestate.
 *
 * One `ForkReplayResult` per input plan, in input order. A plan that reverts
 * on chain is `executed: false` with the revert reason in `detail`; it is
 * never dropped, because a dropped result is an absent one and the §11.5
 * check reads absence as failure by design.
 */
export async function runForkReplays(
  plans: readonly ForkReplayPlan[],
  opts: ForkReplayOptions,
): Promise<ForkReplayResult[]> {
  const maxLossBps = opts.maxLossBps ?? 100;
  const expirySeconds = opts.planExpirySeconds ?? 3_600;
  const gasLimit = opts.gasLimit ?? 3_000_000n;

  // `cacheTimeout: -1` disables ethers' internal per-call cache. Without it
  // `latest` is resolved from a block number ethers refreshes only on its
  // polling interval, so against an automining Anvil every transaction after
  // the first is signed with a stale (already used) nonce and comes back as
  // NONCE_EXPIRED — which would be misrecorded as the chain refusing the
  // policy's plan.
  const provider = new JsonRpcProvider(opts.rpcUrl, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 100;
  try {
    const wallet = new Wallet(opts.allocatorPrivateKey, provider);
    // NonceManager, not the bare wallet: ethers caches `eth_getTransactionCount`
    // briefly, and against an automining Anvil (where a submit and its actions
    // land inside that window) the second transaction re-uses the first's
    // nonce and fails with "nonce has already been used" — which would be
    // recorded as the POLICY's plan being refused by the chain.
    const signer = new ethers.NonceManager(wallet);
    const vault = new Contract(opts.vaultAddress, VAULT_ABI, signer);
    const assetAddress = (await vault.asset!()) as string;
    const asset = new Contract(assetAddress, ERC20_ABI, provider);
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const adapters = [...new Set(Object.values(opts.adapterByMarketId))];

    const head = await provider.getBlockNumber();
    if (head !== opts.prestateBlock) {
      throw new Error(
        `prestate pin mismatch: opts.prestateBlock=${opts.prestateBlock} but the fork head is ` +
          `${head}. The pin must name the state the replays are restored to.`,
      );
    }
    if (!((await vault.hasRole!(await vault.ALLOCATOR_ROLE!(), wallet.address)) as boolean)) {
      throw new Error(`${wallet.address} does not hold ALLOCATOR_ROLE on ${opts.vaultAddress}`);
    }

    const pinned = await readPrestate(provider, vault, asset, adapters);
    const pinnedDigest = fingerprintDigest(pinned);

    let snapshotId = (await provider.send('evm_snapshot', [])) as string;
    const results: ForkReplayResult[] = [];

    for (const plan of plans) {
      const label = `${plan.policyId}@${plan.tier}`;
      // §11.1: THE SAME pinned prestate, before EVERY candidate policy.
      const reverted = (await provider.send('evm_revert', [snapshotId])) as boolean;
      snapshotId = (await provider.send('evm_snapshot', [])) as string;
      // evm_revert rolls the account nonce back too; the local counter must
      // follow or every plan after the first is signed with a used nonce.
      signer.reset();
      const restored = await readPrestate(provider, vault, asset, adapters);
      const restoredDigest = fingerprintDigest(restored);
      if (!reverted || restoredDigest !== pinnedDigest) {
        results.push({
          policyId: plan.policyId,
          tier: plan.tier,
          prestateBlock: opts.prestateBlock,
          executed: false,
          detail:
            `prestate was NOT restored before this policy (pinned ${pinnedDigest}, ` +
            `observed ${restoredDigest} at block ${restored.blockNumber})`,
        });
        continue;
      }

      try {
        // PREPARATION. Nothing here touches the chain's verdict on the
        // allocation: a failure is an infrastructure or configuration fault
        // (an unmapped marketId, an RPC that would not answer) and is
        // labelled as one, never as the chain refusing the policy.
        let built: ReturnType<typeof buildForkPlan>;
        try {
          const digest = (await vault.currentConfigurationDigest!()) as string;
          const block = await provider.getBlock('latest');
          built = buildForkPlan(plan, {
            chainId,
            vaultAddress: opts.vaultAddress,
            assetAddress,
            adapterByMarketId: opts.adapterByMarketId,
            configurationDigest: digest,
            totalAssetsBase: restored.totalAssetsBase,
            prestateBlock: opts.prestateBlock,
            nowSeconds: block?.timestamp ?? Math.floor(Date.now() / 1000),
            expirySeconds,
            maxLossBps,
          });
        } catch (error) {
          throw new ForkInfrastructureError(
            `could not build the plan: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        if (built === null) {
          // A HOLD. Truthfully executable — there is nothing to execute — and
          // said so in the detail rather than reported as a plan that ran.
          results.push({
            policyId: plan.policyId,
            tier: plan.tier,
            prestateBlock: opts.prestateBlock,
            executed: true,
            held: true,
            detail: `HOLD at origin ${plan.originIndex}: the policy proposed no moves, so there is no plan to execute (NO chain interaction)`,
          });
          continue;
        }

        const submit = await vault.submitPlan!(built.header, built.merkleRoot, { gasLimit });
        const submitReceipt = await submit.wait();
        if (submitReceipt?.status !== 1) {
          // A mined receipt with status 0 IS the chain refusing the plan.
          throw Object.assign(new Error('submitPlan was mined with status 0'), {
            receipt: { status: 0 },
          });
        }

        let gasUsed = submitReceipt.gasUsed as bigint;
        for (const action of built.actions) {
          const tx = await vault.executeNextActionWithProof!(
            action.proof,
            {
              planId: action.planId,
              index: action.index,
              kind: action.kind,
              adapter: action.adapter,
              amount: action.amount,
              minOut: action.minOut,
              dataHash: action.dataHash,
            },
            { gasLimit },
          );
          const receipt = await tx.wait();
          if (receipt?.status !== 1) {
            throw Object.assign(
              new Error(`action ${action.index} was mined with status 0`),
              { receipt: { status: 0 } },
            );
          }
          gasUsed += receipt.gasUsed as bigint;
        }

        // The plan is CLEARED on completion; a still-active plan means the
        // vault did not accept the whole sequence.
        const stillActive = (await vault.activePlanId!()) as string;
        if (stillActive !== ethers.ZeroHash) {
          throw Object.assign(
            new Error(
              `plan ${built.header.planId} is still active after every action executed — the ` +
                'vault did not accept the whole sequence',
            ),
            { receipt: { status: 0 } },
          );
        }

        const after = await readPrestate(provider, vault, asset, adapters);
        const moved = Object.keys(after.strategyAssets)
          .filter((a) => after.strategyAssets[a] !== restored.strategyAssets[a])
          .map((a) => `${a}:+${after.strategyAssets[a]! - restored.strategyAssets[a]!}`)
          .join(',');

        results.push({
          policyId: plan.policyId,
          tier: plan.tier,
          prestateBlock: opts.prestateBlock,
          executed: true,
          held: false,
          detail:
            `origin ${plan.originIndex}: ${built.actions.length} action(s) executed on the fork from ` +
            `pinned prestate ${pinnedDigest}; gas ${gasUsed}; strategyAssets ${moved.length > 0 ? moved : 'unchanged'}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          policyId: plan.policyId,
          tier: plan.tier,
          prestateBlock: opts.prestateBlock,
          executed: false,
          detail:
            error instanceof ForkInfrastructureError || !isChainRefusal(error)
              ? `${label} NOT REPLAYED (infrastructure/configuration, NOT a chain verdict on the ` +
                `allocation): ${message}`
              : `${label} REFUSED BY THE CHAIN: the vault reverted the plan: ${message}`,
        });
      }
    }

    // Leave the chain on the pinned prestate rather than on the last policy's
    // outcome — the next caller's pin is this one's postcondition.
    await provider.send('evm_revert', [snapshotId]);
    return results;
  } finally {
    provider.destroy();
  }
}

/**
 * Resolve `ForkReplayOptions` from the environment, or `null` when the
 * environment does not describe a fork.
 *
 * `null` is NOT a soft pass: a caller that gets `null` must supply no
 * `forkResults` at all, so §11.5's completeness check reports NOT PRODUCED
 * and blocks. The environment can enable the evidence; it can never waive the
 * requirement.
 *
 *   SRCLA_FORK_REPLAY_RPC_URL        http://127.0.0.1:8545
 *   SRCLA_FORK_REPLAY_VAULT_ADDRESS  the deployed NavyVaultSRCLA
 *   SRCLA_FORK_REPLAY_ALLOCATOR_KEY  a key holding ALLOCATOR_ROLE on it
 *   SRCLA_FORK_REPLAY_ADAPTERS       compound=0x..,aave=0x..,moonwell=0x..
 *   SRCLA_FORK_REPLAY_BLOCK          optional; defaults to the fork head
 */
export async function forkReplayOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ForkReplayOptions | null> {
  const rpcUrl = env['SRCLA_FORK_REPLAY_RPC_URL'];
  const vaultAddress = env['SRCLA_FORK_REPLAY_VAULT_ADDRESS'];
  const allocatorPrivateKey = env['SRCLA_FORK_REPLAY_ALLOCATOR_KEY'];
  const adapterSpec = env['SRCLA_FORK_REPLAY_ADAPTERS'];
  if (
    rpcUrl === undefined ||
    vaultAddress === undefined ||
    allocatorPrivateKey === undefined ||
    adapterSpec === undefined
  ) {
    return null;
  }

  const adapterByMarketId: Record<string, string> = {};
  for (const entry of adapterSpec.split(',')) {
    const [marketId, address] = entry.split('=');
    if (marketId === undefined || address === undefined || address.length === 0) {
      throw new Error(
        `SRCLA_FORK_REPLAY_ADAPTERS entry '${entry}' is not 'marketId=0xaddress'`,
      );
    }
    adapterByMarketId[marketId.trim()] = address.trim();
  }

  const pinned = env['SRCLA_FORK_REPLAY_BLOCK'];
  let prestateBlock: number;
  if (pinned !== undefined) {
    prestateBlock = Number(pinned);
    if (!Number.isInteger(prestateBlock)) {
      throw new Error(`SRCLA_FORK_REPLAY_BLOCK '${pinned}' is not an integer block number`);
    }
  } else {
    const probe = new JsonRpcProvider(rpcUrl);
    try {
      prestateBlock = await probe.getBlockNumber();
    } finally {
      probe.destroy();
    }
  }

  return { rpcUrl, vaultAddress, allocatorPrivateKey, adapterByMarketId, prestateBlock };
}
