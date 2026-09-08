/**
 * §9.2 - reward admission and recognised reward NAV.
 *
 * "A reward contributes to forecast or accounting only if its token, emission,
 * denominator, remaining horizon, funding, claim simulation, Chainlink price
 * feeds, and approved Uniswap V3 route all pass admission. Expired, off-chain,
 * underfunded, unverified, or unpriceable rewards contribute zero."
 *
 * Two properties this module exists to guarantee:
 *
 *   1. NO PARTIAL CREDIT. A failure on any single rule yields exactly zero
 *      recognised value - never a discounted or pro-rated one. `admitReward`
 *      evaluates every rule (so a caller can see all failures at once) but
 *      `recognizedRewardValueBase` is all-or-nothing.
 *   2. A STALE OR INVALID SOURCE CANNOT INCREASE NAV. The price feeds are
 *      admission rules, not just valuation inputs, so a stale feed drives the
 *      recognised value to zero rather than valuing the reward at the last
 *      known price.
 *
 * PURE. No I/O, no `Date.now()`, no randomness - the observation carries its
 * own `observedAtSeconds`, exactly as `decide()` takes its time from
 * `input.origin.timestampSeconds`.
 *
 * UNITS. `claimableAmount`/`heldAmount`/`controllerFundedAmount` are RAW token
 * units at `tokenDecimals`. `rewardUsdE8`/`usdcUsdE8` are Chainlink answers at
 * 8 decimals. Every value this module returns is USDC base units (6 dp).
 */

/** One venue's reward position at one observation instant. */
export interface RewardObservation {
  /** Strategy adapter holding the reward (§9.2 - never the allocator wallet). */
  adapter: string;
  /** Reward ERC-20 address. */
  token: string;
  /** Decimals of `token` (raw token units -> whole tokens). */
  tokenDecimals: number;
  /** Observation instant, seconds. Time enters only here (purity). */
  observedAtSeconds: number;
  /** Claimable-but-unclaimed reward, raw token units. */
  claimableAmount: bigint;
  /** Already-claimed reward still held in the adapter, raw token units.
   *  §9.2: recognised NAV uses "actual claimable plus held amounts". */
  heldAmount: bigint;
  /** Whether a `claim` simulation against the live controller succeeded. */
  claimSimulationSucceeded: boolean;
  /** Distribution end from the reward controller, unix seconds. */
  emissionEndSeconds: number;
  /**
   * §9.2's DENOMINATOR: the total supply the reward controller divides its
   * emission across when it advances the distribution index, in that
   * controller's own units.
   *
   * Every venue's controller accrues per-unit as
   * `emissionPerSecond * dt / totalSupply` - Aave's RewardsController over
   * the scaled aToken supply, Compound III's CometRewards over the tracked
   * base supply, Moonwell's comptroller over the mToken supply. If that
   * figure is zero the per-unit rate is undefined (the controller is
   * dividing by zero) and ANY claimable amount read against it is not
   * attributable to this adapter.
   */
  distributionDenominatorAmount: bigint;
  /**
   * This adapter's own share of `distributionDenominatorAmount`, same units.
   * A share exceeding the denominator means the two figures were read from
   * different indexes or one of them is stale, so the accrual again cannot
   * be attributed.
   */
  adapterShareAmount: bigint;
  /** Reward balance the controller still holds to pay claims, raw token units. */
  controllerFundedAmount: bigint;
  /** Chainlink reward/USD answer, 8 dp. Non-positive => the feed is invalid. */
  rewardUsdE8: bigint;
  /** `updatedAt` of the reward/USD round, unix seconds. */
  rewardFeedUpdatedAtSeconds: number;
  /** Chainlink USDC/USD answer, 8 dp - the independent second feed §9.2 requires. */
  usdcUsdE8: bigint;
  /** `updatedAt` of the USDC/USD round, unix seconds. */
  usdcFeedUpdatedAtSeconds: number;
  /** Admin-approved route id in the immutable reward executor (§9.4), or null. */
  routeId: string | null;
  /** Whether that route is currently active and approved for this token. */
  routeApproved: boolean;
}

/** Admin-set, per-token admission policy. */
export interface RewardTokenPolicy {
  /** Token this policy governs; must match the observation's token. */
  token: string;
  /** Whether the token is on the admin allowlist at all. */
  admitted: boolean;
  /** §9.2 token-specific haircut applied to recognised value, basis points. */
  haircutBps: number;
  /** §9.2 absolute contribution cap, USDC base units. */
  maxContributionBase: bigint;
  /** Maximum tolerated Chainlink round age, seconds. */
  maxFeedAgeSeconds: number;
}

export interface AdmitRewardResult {
  admitted: boolean;
  reasons: Array<{ code: string; passed: boolean; detail: string }>;
}

/** The policy applied when no entry exists for an observed token at all. */
export function unadmittedPolicy(token: string): RewardTokenPolicy {
  return { token, admitted: false, haircutBps: 10_000, maxContributionBase: 0n, maxFeedAgeSeconds: 0 };
}

interface Rule {
  code: string;
  check(o: RewardObservation, p: RewardTokenPolicy): { passed: boolean; detail: string };
}

/**
 * §9.2's eligibility list, in the paper's own order - all EIGHT named
 * criteria: token, emission, denominator, remaining horizon, funding, claim
 * simulation, Chainlink price feeds, approved Uniswap V3 route. Every rule
 * runs on every call so a caller sees all failures, not just the first.
 *
 * `EMISSION_ENDED` carries both "emission" and "remaining horizon" (a
 * distribution whose end has passed has neither); `FEED_INVALID` and
 * `FEED_STALE` split the single "Chainlink price feeds" criterion into its
 * two independent failure modes.
 */
const RULES: Rule[] = [
  {
    code: 'TOKEN_NOT_ADMITTED',
    check: (o, p) => {
      if (p.token.toLowerCase() !== o.token.toLowerCase()) {
        return { passed: false, detail: `policy governs ${p.token}, observation is ${o.token}` };
      }
      return { passed: p.admitted, detail: p.admitted ? 'token allowlisted' : 'token not on the admin allowlist' };
    },
  },
  {
    code: 'CLAIM_SIMULATION_FAILED',
    check: (o) => ({
      passed: o.claimSimulationSucceeded,
      detail: o.claimSimulationSucceeded ? 'claim simulates' : 'claim simulation reverted',
    }),
  },
  {
    code: 'EMISSION_ENDED',
    check: (o) => {
      const live = o.emissionEndSeconds > o.observedAtSeconds;
      return {
        passed: live,
        detail: live
          ? `${o.emissionEndSeconds - o.observedAtSeconds}s of distribution horizon remaining`
          : `distribution ended at ${o.emissionEndSeconds}, observed at ${o.observedAtSeconds}`,
      };
    },
  },
  {
    // §9.2's eighth named criterion - "its token, emission, DENOMINATOR,
    // remaining horizon, funding, claim simulation, Chainlink price feeds,
    // and approved Uniswap V3 route all pass admission" - and the one this
    // module was missing (readiness audit NEW-26).
    //
    // It is a distinct failure from EMISSION_ENDED. A distribution can be
    // live, funded and inside its horizon while its denominator is zero or
    // inconsistent, and in that state the controller's own index arithmetic
    // is undefined: the claimable figure is not evidence of anything the
    // vault owns. The other seven rules all pass in exactly that state,
    // which is why its absence was invisible.
    code: 'DENOMINATOR_INVALID',
    check: (o) => {
      if (o.distributionDenominatorAmount <= 0n) {
        return {
          passed: false,
          detail:
            `distribution denominator is ${o.distributionDenominatorAmount}: the controller's per-unit ` +
            'accrual is undefined, so no claimable amount is attributable',
        };
      }
      if (o.adapterShareAmount < 0n || o.adapterShareAmount > o.distributionDenominatorAmount) {
        return {
          passed: false,
          detail:
            `adapter share ${o.adapterShareAmount} is outside the distribution denominator ` +
            `${o.distributionDenominatorAmount}: the two figures cannot come from one consistent index`,
        };
      }
      return {
        passed: true,
        detail: `adapter holds ${o.adapterShareAmount} of a ${o.distributionDenominatorAmount} distribution base`,
      };
    },
  },
  {
    code: 'UNDERFUNDED',
    check: (o) => {
      // The controller must actually hold what we intend to claim; an
      // emission schedule the controller cannot pay is not a reward.
      const funded = o.controllerFundedAmount >= o.claimableAmount;
      return {
        passed: funded,
        detail: `controller holds ${o.controllerFundedAmount} against ${o.claimableAmount} claimable`,
      };
    },
  },
  {
    code: 'FEED_INVALID',
    check: (o) => {
      const ok = o.rewardUsdE8 > 0n && o.usdcUsdE8 > 0n;
      return { passed: ok, detail: `rewardUsdE8=${o.rewardUsdE8} usdcUsdE8=${o.usdcUsdE8}` };
    },
  },
  {
    code: 'FEED_STALE',
    check: (o, p) => {
      // Both feeds are checked: valuing a fresh reward price against a stale
      // USDC price is just as unsound as the reverse. A future-dated round is
      // treated as stale too - it is not a source this can trust either.
      const rewardAge = o.observedAtSeconds - o.rewardFeedUpdatedAtSeconds;
      const usdcAge = o.observedAtSeconds - o.usdcFeedUpdatedAtSeconds;
      const fresh = (age: number) => age >= 0 && age <= p.maxFeedAgeSeconds;
      const ok = fresh(rewardAge) && fresh(usdcAge);
      return { passed: ok, detail: `reward round ${rewardAge}s old, usdc round ${usdcAge}s old, max ${p.maxFeedAgeSeconds}s` };
    },
  },
  {
    code: 'NO_APPROVED_ROUTE',
    check: (o) => {
      const ok = o.routeApproved && o.routeId !== null;
      return { passed: ok, detail: ok ? `route ${o.routeId}` : 'no active admin-approved Uniswap V3 route' };
    },
  },
];

/**
 * §9.2 admission. Returns every rule's verdict; `admitted` is the conjunction.
 * An `OK` reason is appended only when every rule passed, so a caller can key
 * on its presence without re-deriving the conjunction.
 */
export function admitReward(o: RewardObservation, p: RewardTokenPolicy): AdmitRewardResult {
  const reasons = RULES.map((r) => ({ code: r.code, ...r.check(o, p) }));
  const admitted = reasons.every((r) => r.passed);
  if (admitted) {
    reasons.push({ code: 'OK', passed: true, detail: 'all §9.2 admission rules passed' });
  }
  return { admitted, reasons };
}

/**
 * §9.2 recognised reward NAV, in USDC base units.
 *
 * - `grossBase`: claimable + held, priced through the two independent feeds.
 *   This is the notional that would actually be swapped, so it is what the
 *   §9.3 cost model should be charged against.
 * - `conservativeBase`: `grossBase` after the token-specific haircut and the
 *   absolute contribution cap. This is what may be recognised, and what the
 *   §9.3 gate compares against cost.
 *
 * Both are exactly zero for an unadmitted reward - no partial credit.
 */
export function recognizedRewardValueBase(
  o: RewardObservation,
  p: RewardTokenPolicy
): { grossBase: bigint; conservativeBase: bigint } {
  const ZERO = { grossBase: 0n, conservativeBase: 0n };
  if (!admitReward(o, p).admitted) return ZERO;

  const amount = o.claimableAmount + o.heldAmount; // raw token units
  if (amount <= 0n) return ZERO;

  // raw token units -> USD (8 dp) -> USDC base units (6 dp), using the
  // observation's own two feeds and never a hardcoded price.
  const usdE8 = (amount * o.rewardUsdE8) / 10n ** BigInt(o.tokenDecimals);
  const grossBase = (usdE8 * 1_000_000n) / o.usdcUsdE8;

  const haircutBps = BigInt(Math.max(0, Math.min(10_000, p.haircutBps)));
  const afterHaircut = (grossBase * (10_000n - haircutBps)) / 10_000n;
  const conservativeBase = afterHaircut < p.maxContributionBase ? afterHaircut : p.maxContributionBase;

  return { grossBase, conservativeBase };
}
