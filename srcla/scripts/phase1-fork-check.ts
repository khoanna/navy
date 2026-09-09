/**
 * Phase 1 exit gate. Runs ONE real decision cycle against a live chain (an
 * Anvil fork of Base in normal use) and — if the decision produces a plan —
 * attempts to execute it on chain through the real KeeperExecutor path.
 *
 * This is not a unit test: it makes RPC calls, reads/writes the srcla
 * Postgres database, and (only if a plan is produced and the pricing guard
 * allows it) submits real transactions. See the operator runbook in
 * task-16-report.md for how to bring up everything this script needs.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GUARDS AGAINST (Phase 1's own history of defects)
 * ---------------------------------------------------------------------------
 * Three regressions have each independently made every rebalance on this
 * project revert or silently under-protect the vault. This script asserts
 * against all three before ever calling the executor:
 *
 *   1. A zero `header.snapshotHash` — NavyVaultSRCLA.submitPlan reverts
 *      InvalidPlan on this. See src/policy/steps/plan.ts.
 *   2. A zero `header.decisionHash` — same InvalidPlan revert path.
 *   3. Plan risk limits (`reserve`, `minFinalAssets`, `maxRecognizedLoss`,
 *      `turnoverLimit`) silently dropped to zero. The contract does NOT
 *      reject a zero risk limit by itself (that's exactly why this was able
 *      to ship silently before) — only this script's explicit check catches
 *      it before a transaction is signed.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS THIS SCRIPT MUST HANDLE THAT THE ORIGINAL TASK BRIEF PREDATES
 * ---------------------------------------------------------------------------
 *
 * (1) THE EXECUTION LOCK. KeeperExecutor.executePlanDraft (Task 15 review)
 *     requires an injected KeeperExecutionLock. src/index.ts wires
 *     UNCONFIGURED_EXECUTION_LOCK there — a sentinel that throws on first use
 *     so live production execution cannot proceed silently. This script is a
 *     single, short-lived process with no concurrent executor, so an
 *     IN-MEMORY lock (createInMemoryExecutionLock, below) is a defensible
 *     substitute FOR THIS SCRIPT ONLY. It is not durable, not shared across
 *     processes, and provides none of the crash-recovery guarantees §10.3
 *     exists for. NEVER reuse it outside a single-process fork check.
 *
 * (2) THE PRICING GUARD. Four of the five GasObservation price inputs
 *     (l1BaseFeeWei, l1BlobBaseFeeWei, ethUsdE8, usdcUsdE8) are named,
 *     configurable placeholders — notably a hardcoded $3,500 ETH price
 *     (config.ts's SrclaConfigSchema) — until a real oracle is wired.
 *     assertExecutionAllowed (src/runtime/decision-driver.ts) blocks handing
 *     ANY produced plan to an executor while even one of them is a
 *     placeholder. This script calls that exact function — the same gate
 *     production goes through — and does NOT route around it, fabricate a
 *     price, or weaken the check. If it blocks, the script reports that
 *     honestly and exits in the "BLOCKED" bucket (see below), not "BROKEN".
 *
 * (3) THE PINNED CONFIG DIGESTS. config/bootstrap-artifact.json ships
 *     `pinnedConfigDigests: {}` by design (see policy/artifact.ts's comment)
 *     — with it as-is, admit.ts's CONFIG_DIGEST_UNPINNED rule rejects every
 *     market and the kernel holds on every cycle, forever, regardless of
 *     chain state. This script is the intended integration point: it reads
 *     each adapter's live `configurationDigest()` (and the vault's
 *     `currentConfigurationDigest()`) BEFORE building the artifact, and pins
 *     exactly those. It prints every digest it pins, because pinning
 *     whatever the chain currently reports makes admission trivially pass —
 *     an operator reading the output should be able to see exactly what was
 *     trusted and judge whether that's the configuration they intended.
 *
 * ---------------------------------------------------------------------------
 * EXIT CONTRACT
 * ---------------------------------------------------------------------------
 * Prints a `RESULT:` line and sets an exit code from one of four buckets:
 *
 *   EXECUTED — decided REBALANCE, no known-defect regression found, the
 *              pricing guard allowed execution, and the plan executed on
 *              chain successfully. exit 0.
 *   HOLD     — decided to hold for a reason this script can positively
 *              attribute to real chain/market state (paused vault, cost
 *              gate, no-op target, or an admission rejection whose failing
 *              rules are all data-dependent, not a pinning failure). This
 *              IS a successful, informative run of the pipeline. exit 0.
 *   BLOCKED  — the pipeline decided REBALANCE and built a valid plan, but
 *              something OPERATOR-CONFIGURABLE stopped it from executing:
 *              the pricing guard (placeholder prices in use) or missing
 *              keeper wiring (KEEPER_PRIVATE_KEY etc). Not a code defect.
 *              exit 0 (per this task's design note — only BROKEN is
 *              non-zero) but printed with equal prominence to EXECUTED/HOLD
 *              so it is never mistaken for a full proof of execution.
 *   BROKEN   — any of: a known-defect regression re-appeared, admission
 *              rejected a market on CONFIG_DIGEST_UNPINNED despite this
 *              script having pinned that exact market's live digest,
 *              on-chain execution itself failed/reverted, or an unexpected
 *              exception. exit 1.
 */
import 'dotenv/config';
import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';
import { loadConfig, type Config } from '../src/config.js';
import { ChainClient } from '../src/chain/client.js';
import { SnapshotCollector } from '../src/collector/snapshot-collector.js';
import {
  DecisionDriver,
  buildRawOriginFromCollector,
  persistDecisionOutput,
  assertExecutionAllowed,
  ExecutionBlockedError,
  type PricingGuardStatus,
} from '../src/runtime/decision-driver.js';
import { computeArtifactHash, loadBootstrapArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS, type DecideOpts } from '../src/policy/decide.js';
import { createKeeperExecutor, type KeeperExecutionLock } from '../src/execution/keeper-executor.js';
import type { DecisionOutput, GasObservation, PolicyArtifact } from '../src/policy/types.js';

const HEADER = '[phase1]';

/** The three adapter names the collector reports, in the exact casing
 * buildRawOriginFromCollector uses as each MarketObservation.marketId (see
 * SnapshotCollector.collectStrategies) — pinnedConfigDigests keys and any
 * other per-market lookup MUST use these, not the lowercase config field
 * names ('aave'/'compound'/'moonwell'), or the pin silently never matches. */
const MARKET_NAMES = ['Aave', 'Compound', 'Moonwell'] as const;

const ADAPTER_DIGEST_ABI = ['function configurationDigest() view returns (bytes32)'];
const VAULT_DIGEST_ABI = ['function currentConfigurationDigest() view returns (bytes32)'];

/**
 * (1) THE EXECUTION LOCK — see module header. This lock is IN-MEMORY,
 * single-process, and non-durable. It is suitable ONLY for this one-shot
 * fork-check script, where one process runs one plan to completion with no
 * concurrent executor. It provides none of §10.3's crash-recovery guarantees
 * (no persisted intent survives this process exiting) and MUST NEVER be
 * wired into the live scheduler or any production entry point — that is
 * exactly what UNCONFIGURED_EXECUTION_LOCK (src/execution/keeper-executor.ts)
 * exists to prevent by failing loudly instead.
 */
function createInMemoryExecutionLock(): KeeperExecutionLock {
  let held: string | null = null;
  const intents: Array<{ planId: string; index: number }> = [];
  return {
    acquireLock: async (planId: string) => {
      if (held !== null) {
        console.warn(`${HEADER} [in-memory lock] plan ${planId} could not acquire — held by ${held}`);
        return false;
      }
      held = planId;
      console.log(`${HEADER} [in-memory lock, SINGLE-PROCESS ONLY] acquired for plan ${planId}`);
      return true;
    },
    persistIntent: async (planId: string, index: number) => {
      intents.push({ planId, index });
      console.log(`${HEADER} [in-memory lock] intent recorded (process memory only): plan ${planId} action ${index}`);
    },
    releaseLock: async (planId: string) => {
      if (held === planId) held = null;
      console.log(`${HEADER} [in-memory lock] released for plan ${planId}`);
    },
  };
}

interface LiveDigests {
  vaultDigest: string;
  marketDigests: Record<string, string>;
}

/**
 * (3) THE PINNED CONFIG DIGESTS — see module header. Reads the live
 * on-chain `configurationDigest()` off each adapter and the vault's
 * `currentConfigurationDigest()`, so the artifact this script builds can
 * actually admit markets instead of holding forever against the shipped
 * `pinnedConfigDigests: {}` bootstrap.
 *
 * Deliberate ordering hazard, stated plainly: this reads digests moments
 * before deciding, then trusts exactly those digests for admission. That
 * makes admission trivially pass whatever the chain currently reports —
 * it does NOT independently verify the adapters are configured the way an
 * operator intends. Pinning is only as good as the chain state it was read
 * from; that is why every digest pinned here is printed.
 */
async function readLiveConfigDigests(provider: ethers.JsonRpcProvider, config: Config): Promise<LiveDigests> {
  const vaultContract = new ethers.Contract(config.vaultAddress, VAULT_DIGEST_ABI, provider);
  const vaultDigest: string = await vaultContract.currentConfigurationDigest!();

  const adapterAddresses: Record<(typeof MARKET_NAMES)[number], string> = {
    Aave: config.aaveStrategyAddress,
    Compound: config.compoundStrategyAddress,
    Moonwell: config.moonwellStrategyAddress,
  };

  const marketDigests: Record<string, string> = {};
  for (const name of MARKET_NAMES) {
    const address = adapterAddresses[name];
    const adapter = new ethers.Contract(address, ADAPTER_DIGEST_ABI, provider);
    const digest: string = await adapter.configurationDigest!();
    marketDigests[name] = digest;
  }

  return { vaultDigest, marketDigests };
}

/** Rebuilds the bootstrap artifact with pinnedConfigDigests populated from
 * `live`, recomputing artifactHash (computeArtifactHash) so the returned
 * artifact's hash is never stale relative to the pins it actually carries —
 * a caller trusting `artifact.artifactHash` (e.g. persistDecisionOutput's
 * PolicyVersion upsert) must see a hash that matches the pins used to reach
 * this decision, not the placeholder-empty bootstrap's original hash. */
function buildPinnedArtifact(live: LiveDigests): PolicyArtifact {
  const bootstrap = loadBootstrapArtifact();
  const { artifactHash: _stale, ...body } = bootstrap;
  const pinned: Omit<PolicyArtifact, 'artifactHash'> = {
    ...body,
    pinnedConfigDigests: { ...live.marketDigests },
  };
  return { ...pinned, artifactHash: computeArtifactHash(pinned) };
}

function printPricingGuardStatus(guard: PricingGuardStatus): void {
  console.log(`${HEADER} pricing guard: placeholderPricesInUse=${guard.placeholderPricesInUse}`);
  if (guard.placeholderPricesInUse) {
    console.log(
      `${HEADER}   placeholder (NOT real oracle) fields in use: ${guard.placeholderPriceFields.join(', ')} ` +
        '-- see SRCLA_REAL_* in .env.example. Any produced plan will be BLOCKED from execution ' +
        'while any of these remain unset.'
    );
  } else {
    console.log(`${HEADER}   all four price inputs are operator-configured (no placeholders in use).`);
  }
}

function printAdmission(out: DecisionOutput): void {
  console.log(`${HEADER} admission: eligible=[${out.admission.eligible.join(', ')}]`);
  for (const r of out.admission.reasons) {
    console.log(`${HEADER}   ${r.marketId} ${r.code}: ${r.passed ? 'PASS' : 'FAIL'} — ${r.detail}`);
  }
}

/**
 * Structural preflight the same shape as KeeperExecutor.executePlanDraft's
 * own, run here BEFORE we hand anything to the executor. KeeperExecutor
 * already checks snapshotHash/decisionHash/planId/actionCount/merkleRoot/
 * expiry — mirrored here so this script fails with its own clear message
 * rather than relying solely on the executor's returned `errors` array.
 * Distinctly, KeeperExecutor does NOT check the four risk-limit fields
 * (reserve/minFinalAssets/maxRecognizedLoss/turnoverLimit) being zero — the
 * contract doesn't revert on that by itself, which is exactly how it shipped
 * silently before. That check exists ONLY here.
 */
function assertNoKnownRegressions(out: DecisionOutput): void {
  if (out.plan === null) return;
  const header = out.plan.header;
  const zero = ethers.ZeroHash;

  const hashDefects: string[] = [];
  if (header.snapshotHash === zero) hashDefects.push('header.snapshotHash is zero (submitPlan reverts InvalidPlan)');
  if (header.decisionHash === zero) hashDefects.push('header.decisionHash is zero (submitPlan reverts InvalidPlan)');
  if (hashDefects.length > 0) {
    throw new Error(`REGRESSION (defect #1/#3 — zero plan hash): ${hashDefects.join('; ')}`);
  }

  const zeroedLimits: string[] = [];
  if (header.reserve === 0n) zeroedLimits.push('reserve');
  if (header.minFinalAssets === 0n) zeroedLimits.push('minFinalAssets');
  if (header.maxRecognizedLoss === 0n) zeroedLimits.push('maxRecognizedLoss');
  if (header.turnoverLimit === 0n) zeroedLimits.push('turnoverLimit');
  if (zeroedLimits.length > 0) {
    throw new Error(
      `REGRESSION (defect #2 — plan risk limits silently zero): ${zeroedLimits.join(', ')}. ` +
        `The contract does not reject this by itself; this script's check is the only guard.`
    );
  }

  if (header.reserve !== out.reserve.requiredBase) {
    throw new Error(
      `REGRESSION: header.reserve (${header.reserve}) does not match the decision's computed ` +
        `required reserve (${out.reserve.requiredBase}) -- the plan header's reserve was not threaded ` +
        'through from the decision that produced it.'
    );
  }
}

/**
 * Given a HOLD decision, distinguishes a hold this script can positively
 * attribute to real chain/market state from one that looks like a pipeline
 * defect. Per this task's design note: printing "HOLD" and exiting zero
 * without this distinction is not a checkpoint.
 */
function classifyHold(
  out: DecisionOutput,
  pinnedMarketNames: ReadonlySet<string>
): { expected: boolean; detail: string } {
  const tag = out.reasons[0] ?? 'UNKNOWN';

  if (tag === 'VAULT_PAUSED') {
    return { expected: true, detail: 'vault is paused on-chain -- a legitimate hold, not a pipeline defect.' };
  }

  if (tag === 'ADMISSION_EMPTY') {
    // Whole-branch review, Critical 3: decide() pushes a distinct
    // NO_MARKET_DATA reason (in addition to ADMISSION_EMPTY) when every
    // market observation carries a literal zero rate/cash/borrows -- the
    // collector's "I could not read this" signature (snapshot-collector.ts).
    // That is the pipeline being broken, not an expected hold on a fresh
    // environment, and must not be classified the same as e.g.
    // REGIME_MIN_HISTORY on an empty database.
    if (out.reasons.includes('NO_MARKET_DATA')) {
      return {
        expected: false,
        detail:
          'every market failed admission via NO_MARKET_DATA: the collector returned a literal zero ' +
          'supplyRate/cash/borrows for every market (snapshot-collector.ts cannot yet read protocol-specific ' +
          'rate/liquidity data). This is the collector supplying no market data, not a legitimate hold -- ' +
          'do not treat this run as an expected checkpoint result.',
      };
    }
    const badPins = out.admission.reasons.filter(
      (r) => r.code === 'CONFIG_DIGEST_UNPINNED' && !r.passed && pinnedMarketNames.has(r.marketId)
    );
    if (badPins.length > 0) {
      const markets = [...new Set(badPins.map((b) => b.marketId))].join(', ');
      return {
        expected: false,
        detail:
          `pinned digests were supplied for ${markets} (see the pinned digests printed above) but ` +
          `CONFIG_DIGEST_UNPINNED still failed for ${markets} -- this is the pinning integration itself ` +
          'failing, not an infrastructure gap.',
      };
    }
    return {
      expected: true,
      detail:
        'every market failed admission for data-dependent reasons (see the admission log above -- ' +
        'typically REGIME_MIN_HISTORY on a database with no forecast history yet, or NO_SYNC_LIQUIDITY/' +
        'CAP_ZERO on an unfunded vault) -- expected on a fresh environment, not a defect.',
    };
  }

  // P17 renamed the prefix when the single cost gate became §9.1's two
  // per-leg movement hurdles plus §9.1.4's aggregate brakes. `COST_GATE` is
  // still accepted so a record produced before that change still classifies
  // rather than falling through to the terminal "unrecognized tag" branch.
  if (tag.startsWith('HURDLES') || tag.startsWith('COST_GATE')) {
    return {
      expected: true,
      detail:
        `the movement hurdles or the churn brakes refused the move (${tag}) -- a legitimate ` +
        'hold. ALL_LEGS_BLOCKED means no leg repaid its own movement cost within the ' +
        "artifact's payback period; MIN_TURNOVER/COOLDOWN/MAX_TURNOVER/REVERSAL_ALLOWANCE are " +
        'the §9.1.4 brakes; INFEASIBLE_AFTER_HURDLES means the surviving legs did not pass ' +
        'the reserve/cap re-check.',
    };
  }

  if (tag === 'NO_ACTIONS') {
    return {
      expected: true,
      detail: 'the optimizer target equals the current position (e.g. an empty/unfunded vault) -- nothing to rebalance.',
    };
  }

  return { expected: false, detail: `unrecognized reason tag '${tag}' -- inspect manually, this is not a known-expected hold.` };
}

type Bucket = 'EXECUTED' | 'HOLD' | 'BLOCKED' | 'BROKEN';

function reportResult(bucket: Bucket, detail: string): void {
  console.log('');
  console.log(`${HEADER} ================================================================`);
  console.log(`${HEADER} RESULT: ${bucket}`);
  console.log(`${HEADER} ${detail}`);
  console.log(`${HEADER} ================================================================`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`${HEADER} chainId=${config.chainId} vault=${config.vaultAddress} rpc=${config.baseRpcUrl}`);
  console.log(
    `${HEADER} adapters: aave=${config.aaveStrategyAddress} compound=${config.compoundStrategyAddress} ` +
      `moonwell=${config.moonwellStrategyAddress}`
  );

  const pricingGuard: PricingGuardStatus = {
    placeholderPricesInUse: config.srcla.placeholderPricesInUse,
    placeholderPriceFields: config.srcla.placeholderPriceFields,
  };
  printPricingGuardStatus(pricingGuard);

  const chainClient = new ChainClient({ rpcUrl: config.baseRpcUrl, chainId: config.chainId });
  const prisma = new PrismaClient();

  const collector = new SnapshotCollector(chainClient, {
    vaultAddress: config.vaultAddress,
    strategyAddresses: {
      aave: config.aaveStrategyAddress,
      compound: config.compoundStrategyAddress,
      moonwell: config.moonwellStrategyAddress,
    },
    usdcAddress: config.usdcAddress,
  });

  try {
    // (3) Pin config digests from live chain BEFORE building the artifact.
    console.log(`${HEADER} reading live configuration digests (adapters + vault) to pin the artifact...`);
    const live = await readLiveConfigDigests(chainClient.provider, config);
    console.log(`${HEADER} pinned digests (this is exactly what admission will trust this cycle):`);
    console.log(`${HEADER}   vault.currentConfigurationDigest() = ${live.vaultDigest}`);
    for (const name of MARKET_NAMES) {
      console.log(`${HEADER}   ${name}.configurationDigest()      = ${live.marketDigests[name]}`);
    }

    const artifact = buildPinnedArtifact(live);
    console.log(`${HEADER} artifact: policyVersion=${artifact.policyVersion} artifactHash=${artifact.artifactHash}`);
    if (artifact._provisional) {
      console.log(`${HEADER}   NOTE: ${artifact._provisional} (results from this artifact are not citable)`);
    }

    const opts: DecideOpts = {
      ...DEFAULT_DECIDE_OPTS,
      codeCommit: process.env.GIT_COMMIT ?? 'phase1-fork-check',
      plan: {
        ...DEFAULT_DECIDE_OPTS.plan,
        chainId: config.chainId,
        vaultAddress: config.vaultAddress,
        assetAddress: config.usdcAddress,
      },
    };

    // chainConfigDigests (buildRawOriginFromCollector's 4th arg) feeds both
    // MarketObservation.regimeId and DecisionInput.vault.configurationDigest
    // (see decision-driver.ts). The vault entry is load-bearing: buildPlan
    // copies input.vault.configurationDigest straight into the plan header,
    // and KeeperExecutor's verifyChain step compares that header field
    // against a fresh on-chain read of the SAME function at submission time
    // — leaving it at the buildRawOriginFromCollector default ('0x') would
    // make every plan this script builds fail verifyChain's digest check.
    const chainConfigDigests: Record<string, string> = {
      vault: live.vaultDigest,
      ...live.marketDigests,
    };

    const gas: GasObservation = {
      l2BaseFeeWei: await chainClient.getGasPrice(),
      l1BaseFeeWei: config.srcla.placeholderL1BaseFeeWei,
      l1BlobBaseFeeWei: config.srcla.placeholderL1BlobBaseFeeWei,
      ethUsdE8: config.srcla.placeholderEthUsdE8,
      usdcUsdE8: config.srcla.placeholderUsdcUsdE8,
    };

    const driver = new DecisionDriver({
      artifact,
      opts,
      // §9.1's churn windows come from the SAME cost params `decide()` then
      // evaluates the gate with (see decision-driver.ts's loadLastAction
      // comment on why the measured window and the enforced window must be
      // one value) — mirrors src/index.ts's live wiring of this argument.
      loadOrigin: () =>
        buildRawOriginFromCollector(collector, prisma, gas, chainConfigDigests, {
          cooldownSeconds: opts.cost.cooldownSeconds,
          turnoverWindowSeconds: opts.cost.turnoverWindowSeconds,
          reversalWindowSeconds: opts.cost.reversalWindowSeconds,
        }),
      persist: (out, input) => persistDecisionOutput(prisma, artifact, out, input),
    });

    console.log(`${HEADER} running one decision cycle...`);
    const out = await driver.runCycle();
    if (out === null) {
      reportResult('BROKEN', 'no finalized origin available from the chain (collector returned null) — check RPC connectivity / finalized-block support.');
      process.exitCode = 1;
      return;
    }

    console.log(`${HEADER} decision hash: ${out.decisionHash}`);
    console.log(`${HEADER} snapshot hash: ${out.snapshotHash}`);
    console.log(`${HEADER} reasons: ${out.reasons.join('; ')}`);
    printAdmission(out);
    console.log(
      `${HEADER} target allocation: ${JSON.stringify([...out.target.entries()].map(([k, v]) => [k, v.toString()]))}`
    );
    console.log(`${HEADER} required reserve: ${out.reserve.requiredBase} (floor=${out.reserve.floorBase})`);
    console.log(`${HEADER} enumeration regret: ${out.enumeration ? `${out.enumeration.regretBps} bps (enumerated ${out.enumeration.enumerated}, passed=${out.enumeration.passed})` : 'n/a (no enumeration ran this cycle)'}`);
    console.log(`${HEADER} cost gate: passed=${out.costGate.passed} reason=${out.costGate.reason}`);

    if (out.action !== 'rebalance' || out.plan === null) {
      const pinnedMarketNames = new Set(MARKET_NAMES as readonly string[]);
      const verdict = classifyHold(out, pinnedMarketNames);
      if (verdict.expected) {
        reportResult('HOLD', verdict.detail);
        process.exitCode = 0;
      } else {
        reportResult('BROKEN', `HOLD but NOT for an expected reason: ${verdict.detail}`);
        process.exitCode = 1;
      }
      return;
    }

    // A plan was produced. Check it against every known-defect regression
    // BEFORE touching the executor at all.
    assertNoKnownRegressions(out);
    console.log(`${HEADER} plan ${out.plan.planId}: no known-defect regressions found (hashes non-zero, risk limits non-zero, reserve threaded through).`);
    console.log(`${HEADER} plan header: reserve=${out.plan.header.reserve} minFinalAssets=${out.plan.header.minFinalAssets} maxRecognizedLoss=${out.plan.header.maxRecognizedLoss} turnoverLimit=${out.plan.header.turnoverLimit}`);
    console.log(`${HEADER} plan actions: ${out.plan.actions.length}`);

    // (2) THE PRICING GUARD — the exact production gate, not a local
    // re-derivation of it. Called explicitly here (mirroring
    // Scheduler.runController's own call site) so a block is reported as
    // BLOCKED with a clean message, rather than as an uncaught exception
    // from inside KeeperExecutor.executePlanDraft (which re-asserts this
    // same check as ITS first statement regardless — this call does not
    // weaken or bypass that).
    try {
      assertExecutionAllowed(pricingGuard);
    } catch (error) {
      if (error instanceof ExecutionBlockedError) {
        reportResult(
          'BLOCKED',
          `plan ${out.plan.planId} is valid and ready, but execution is blocked by the pricing guard: ${error.message}`
        );
        process.exitCode = 0;
        return;
      }
      throw error;
    }

    // (1) THE EXECUTION LOCK — see module header: in-memory, single-process,
    // fork-check-only.
    const executionLock = createInMemoryExecutionLock();

    let keeper;
    try {
      keeper = createKeeperExecutor(pricingGuard, executionLock);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportResult(
        'BLOCKED',
        `plan ${out.plan.planId} is valid and the pricing guard allows execution, but the keeper executor ` +
          `could not be constructed (missing operator-supplied env, e.g. KEEPER_PRIVATE_KEY): ${message}`
      );
      process.exitCode = 0;
      return;
    }

    console.log(`${HEADER} keeper address: ${keeper.getAddress()}`);
    const hasAllocator = await keeper.hasAllocatorRole();
    console.log(`${HEADER} keeper has ALLOCATOR_ROLE: ${hasAllocator}`);
    if (!hasAllocator) {
      reportResult(
        'BLOCKED',
        `keeper ${keeper.getAddress()} does not hold ALLOCATOR_ROLE on the vault -- grant it on-chain before this can execute.`
      );
      process.exitCode = 0;
      return;
    }

    console.log(`${HEADER} submitting plan ${out.plan.planId} to the vault...`);
    const result = await keeper.executePlanDraft(out.plan);
    console.log(`${HEADER} plan ${out.plan.planId} -> ${result.success ? 'OK' : 'FAILED'}`);
    console.log(`${HEADER} tx hashes: ${result.txHashes.join(', ') || '(none)'}`);

    if (!result.success) {
      reportResult('BROKEN', `plan execution failed on chain: ${result.errors.join('; ')}`);
      process.exitCode = 1;
      return;
    }

    reportResult(
      'EXECUTED',
      `plan ${result.planId ?? out.plan.planId} executed on chain: ${result.txHashes.length} tx(es) [${result.txHashes.join(', ')}]`
    );
    process.exitCode = 0;
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    reportResult('BROKEN', `unexpected exception: ${message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    chainClient.close();
  }
}

main().catch((error) => {
  console.error(`${HEADER} FATAL (outside main's own handling):`, error);
  process.exit(1);
});
