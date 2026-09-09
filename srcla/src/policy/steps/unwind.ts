/**
 * §9.1 - "A market that becomes ineligible invokes a bounded safety unwind
 * and bypasses the economic gate." §12 - "Market paused or ineligible |
 * Block deployment and invoke bounded unwind when possible".
 *
 * WHAT WAS WRONG. `optimize` builds `target` only over ADMITTED markets, so
 * a paused or de-admitted venue's position became an ordinary divest in the
 * economic path and was put through the whole of it: cooldown, MIN_TURNOVER,
 * MAX_TURNOVER and the movement threshold of the day (a `k*sigma` no-trade
 * band then; §9.1.2's deployment hurdle and §9.1.3's rotation hurdle in
 * `steps/hurdles.ts` now). A safety exit from a paused venue could therefore
 * be suppressed by MIN_TURNOVER - the smaller the stranded position, the more
 * certainly it was suppressed. Worse, when EVERY market fails admission,
 * `decide` returns at ADMISSION_EMPTY before a target is built at all, so the
 * one situation that most needs an unwind produced a HOLD. (Readiness audit
 * NEW-20.)
 *
 * Still true after P17's per-leg rewrite, and for a second reason: `planLegs`
 * skips any venue with no simulated curve, which is exactly a de-admitted one,
 * so the economic path cannot exit it at all. This unwind is the only exit.
 *
 * `ActionKind.EmergencyExit` was defined in `plan.ts` and never emitted;
 * `buildPlan` produced kinds 0|1 only.
 *
 * PURE: no I/O, no clock, no randomness.
 */

import type { AdmissionResult, DecisionInput, MarketObservation } from '../types.js';

/**
 * THE REGISTERED SAFETY SET. An admission code in here means the venue is
 * unsafe to remain in, not merely unattractive or not-yet-qualified. Adding a
 * code here gives it the power to bypass the economic gate, so the set is
 * deliberately small and each entry is justified against §12's table:
 *
 *   PAUSED                 - §12 "Market paused or ineligible | Block
 *                            deployment and invoke bounded unwind when
 *                            possible". The venue itself has stopped.
 *   CONFIG_DIGEST_MISMATCH - §12 "Implementation or material configuration
 *                            change | Quarantine the market and start a new
 *                            regime". The contract we deployed into is not
 *                            the one we registered.
 *
 * DELIBERATELY EXCLUDED, and why each exclusion matters:
 *   CONFIG_DIGEST_UNPINNED  - no pin was ever registered. The market has not
 *                             changed. The shipped bootstrap artifact has an
 *                             EMPTY pin map, so admitting this code would
 *                             emergency-exit every venue on every cycle.
 *   REGIME_MIN_HISTORY      - not enough labels yet. A brand-new regime is a
 *                             reason not to deploy MORE, not a reason to
 *                             dump what is already there at any cost.
 *   NO_MARKET_DATA          - §12 row 1 is "do not decide", not "exit". A
 *                             read failure is not evidence of danger, and
 *                             acting on it would make an RPC outage a
 *                             liquidation trigger.
 *   NO_SYNC_LIQUIDITY,
 *   KINK_EXCEEDED           - §12 "Illiquid adapter withdrawal | Reduce
 *                             synchronous limits; never borrow or exceed
 *                             loss bounds". Forcing an exit out of a venue
 *                             that has no cash is precisely the loss this
 *                             row forbids.
 *   CAP_ZERO,
 *   DEPENDENCY_UNREGISTERED - configuration states that block deployment.
 */
export const SAFETY_EXIT_CODES: readonly string[] = ['PAUSED', 'CONFIG_DIGEST_MISMATCH'];

export interface SafetyExit {
  marketId: string;
  adapter: string;
  /** Position being unwound, USDC base units. Always the FULL position. */
  positionBase: bigint;
  /** Which registered safety codes fired, sorted. */
  codes: string[];
}

export interface SafetyUnwindResult {
  exits: SafetyExit[];
  /** Total notional this plan unwinds. */
  notionalBase: bigint;
  /** The cap that was applied, USDC base units. */
  boundBase: bigint;
  /** Venues that qualified but did not fit under the bound this cycle. */
  deferred: string[];
}

export interface UnwindOpts {
  /**
   * The bound on §9.1's "bounded safety unwind": at most this many basis
   * points of total assets may leave venues in ONE plan. Whatever does not
   * fit is deferred to the next decision cycle, so a multi-venue incident
   * unwinds over several plans rather than as one mass liquidation into
   * thin markets.
   */
  maxBps: number;
}

/**
 * The venues a safety unwind must exit, in the order it exits them, capped.
 *
 * FULL POSITIONS ONLY, and this is forced by the chain, not a choice: the
 * vault's `_executeAction` handles `ActionKind.EmergencyExit` by divesting
 * `strategyAssets[adapter]` in full and IGNORING `action.amount`
 * (contract/src/NavyVaultSRCLA.sol). Emitting a partial amount on a kind-3
 * action would state a bound the chain does not honour. The bound is
 * therefore expressed in WHICH venues one plan exits, not in how much of
 * each.
 *
 * ORDER: largest position first (the biggest stranded exposure leaves
 * first), market id ascending as a total tie-break, so the result is
 * deterministic byte-for-byte.
 *
 * THE ONE-VENUE ESCAPE HATCH: the largest qualifying venue is always
 * included, even when it alone exceeds the cap. Without it a single venue
 * holding more than `maxBps` of the vault could never be exited at all - a
 * "bounded unwind" that never unwinds, which is a worse failure than
 * exceeding the bound once. The plan's own `maxRecognizedLoss` and per-action
 * `minOut` still bound the LOSS in that case; only the notional bound gives
 * way.
 */
export function safetyUnwind(
  input: DecisionInput,
  admission: AdmissionResult,
  opts: UnwindOpts
): SafetyUnwindResult {
  const failing = new Map<string, string[]>();
  for (const r of admission.reasons) {
    if (r.passed) continue;
    if (!SAFETY_EXIT_CODES.includes(r.code)) continue;
    const list = failing.get(r.marketId) ?? [];
    list.push(r.code);
    failing.set(r.marketId, list);
  }

  const byId = new Map<string, MarketObservation>(input.markets.map((m) => [m.marketId, m]));
  const candidates: SafetyExit[] = [];
  for (const [marketId, codes] of failing) {
    const m = byId.get(marketId);
    // A market with nothing in it needs no unwind; emitting a zero-amount
    // action would burn gas to move nothing.
    if (m === undefined || m.positionBase <= 0n) continue;
    candidates.push({
      marketId,
      adapter: m.adapter,
      positionBase: m.positionBase,
      codes: [...codes].sort(),
    });
  }

  candidates.sort((a, b) => {
    if (a.positionBase !== b.positionBase) return a.positionBase > b.positionBase ? -1 : 1;
    return a.marketId < b.marketId ? -1 : a.marketId > b.marketId ? 1 : 0;
  });

  const boundBase = (input.vault.totalAssetsBase * BigInt(opts.maxBps)) / 10_000n;
  const exits: SafetyExit[] = [];
  const deferred: string[] = [];
  let notionalBase = 0n;

  for (const c of candidates) {
    if (exits.length > 0 && notionalBase + c.positionBase > boundBase) {
      deferred.push(c.marketId);
      continue;
    }
    exits.push(c);
    notionalBase += c.positionBase;
  }

  return { exits, notionalBase, boundBase, deferred };
}
