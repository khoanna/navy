/**
 * Main replay engine.
 *
 * UNITS: money is bigint USDC base units (6 dp); rates are WAD (1e18)
 * annualized; times are seconds; gas prices are wei.
 */
import { VaultReplay, type RedeemFailure } from './erc4626.js';
import { modelExecution } from './execution.js';
import { stressedCoverage } from '../../policy/steps/coverage.js';
import {
  displayedVsRealizedGap,
  timeToFullExit,
  venueStressContribution,
  type DisplayedOrigin,
  type ExitOrigin,
} from './sustainability-metrics.js';
// Type-only from the kernel's side is not possible here: the registered exit
// bound is a VALUE, and it decides censoring. `sustainability.ts` imports
// `harness.ts` for types only, which tsc erases, so there is no runtime cycle.
import { REGISTERED_MAX_EXIT_ORIGINS } from '../kernel/sustainability.js';
import type { EvaluationDataset, TimeOrderedSnapshot } from '../dataset.js';
import type { VaultState } from './state.js';

const WAD = 10n ** 18n;
/** Matches protocols/math.ts's SECONDS_PER_YEAR (365.25 days). */
const SECONDS_PER_YEAR = 31_557_600n;

export interface BaselineAction {
  kind: 'deploy' | 'divest';
  adapter: string;
  /** USDC base units. */
  amount: bigint;
}

export type PolicyFn = (
  state: VaultState,
  snapshot: TimeOrderedSnapshot,
) => BaselineAction[];

/** A redemption the replay will actually attempt. */
export interface WithdrawalRequest {
  /** Index into `dataset.snapshots` at which the redemption is attempted. */
  snapshotIndex: number;
  /** USDC base units requested. */
  assetsBase: bigint;
  /**
   * When set, the request is a fraction of the vault's NAV AT EXECUTION TIME
   * (bps), and `assetsBase` is only the value it resolved to for reporting.
   *
   * A registered schedule MUST use this rather than a fixed fraction of the
   * initial tier. A fixed 5% of tier every 7 days demands 190% of the vault
   * over a 267-day era: the cohort's shares are exhausted after 20 of 38
   * redemptions and the remaining 18 fail for want of SHARES, not liquidity.
   * That produced an identical 52.6% withdrawal-success rate for all fifteen
   * policies at all four tiers -- including the all-cash baseline, which
   * cannot fail a redemption for liquidity reasons -- and drained the vault
   * two thirds of the way through, so the last ~90 days were evaluated on an
   * empty vault. A NAV fraction is self-limiting and does not silently scale
   * with the length of the window.
   */
  navFractionBps?: number;
}

export interface WithdrawalOutcome {
  snapshotIndex: number;
  /** USDC base units. */
  requestedBase: bigint;
  /** USDC base units actually paid out; 0n on a failed redemption. */
  grantedBase: bigint;
  success: boolean;
  reason: RedeemFailure;
  /** Venues the vault had to unwind to fund this redemption. */
  divestedFrom: string[];
}

export interface ReplaySnapshot {
  timestamp: Date;
  totalAssets: bigint;
  totalShares: bigint;
  sharePriceWad: bigint;
  /** Cumulative share-price growth since the first snapshot, dimensionless. */
  totalReturn: number;
  idleBase: bigint;
  /**
   * §11.4 "stressed liquid coverage": the worst ratio, over the registered
   * §8.1 demand set {5,10,25,50}% of TVL, of what the vault could have paid
   * synchronously to what was demanded — computed on the CONSERVATIVE exit
   * capacity (the vault's own supplied cash assumed borrowed out). 1 means
   * every stress demand was coverable. This is a measurement, not a
   * constraint: it never changes the replay's state.
   */
  stressedLiquidCoverage: number;
}

export interface ReplayResult {
  policyId: string;
  tier: bigint;
  cohortId: string;
  snapshots: ReplaySnapshot[];
  realizedNetApy: number;
  totalTurnover: bigint;
  /**
   * Fraction of ATTEMPTED redemptions that filled.
   *
   * `null` — never 1 — when no redemption was attempted. The old replay
   * returned a hardcoded 1 here because `totalWithdrawals` was never
   * incremented (`void totalWithdrawals; // placeholder`), which fed a
   * >= 0.99 safety gate and made a policy holding zero cash costless. A
   * caller that cannot distinguish "measured 100%" from "never measured"
   * cannot gate on this at all, so the type forces the distinction.
   */
  withdrawalSuccessRate: number | null;
  withdrawals: WithdrawalOutcome[];
  /** USDC base units. Already charged against NAV — see runReplay. */
  totalCosts: bigint;
  /**
   * Worst `stressedLiquidCoverage` over the whole replay; 1 when never
   * squeezed. This is what the §11.5 gate (`gates.ts`) actually tests — see
   * `coverageDistribution` below for the figures that distinguish a single
   * bad hour from chronic illiquidity, which this minimum alone cannot.
   */
  minStressedLiquidCoverage: number;
  /**
   * The full shape of the `stressedLiquidCoverage` series, not just its
   * worst point. `minStressedLiquidCoverage` is the single worst origin out
   * of thousands, so one market-wide dry hour scores identically to chronic
   * illiquidity — this field lets a reader tell them apart. It does NOT
   * change what the gate tests: the gate reads `minStressedLiquidCoverage`
   * (== `coverageDistribution.min`) exclusively.
   */
  coverageDistribution: CoverageDistribution;
  /**
   * §11.5's sustainability measurements (P24–P26, P28). See
   * `sustainability-metrics.ts` for each definition and its declared bias.
   */
  /**
   * Origins needed to redeem 100% of NAV starting from the run's WORST
   * coverage origin, executing only same-transaction exits. `null` means the
   * vault did not fully exit inside the window; `timeToFullExitCensored`
   * below says whether that is a measured incapacity or a window that ran
   * out before the registered bound could be tested.
   *
   * PROXY, disclosed: the worst-COVERAGE origin need not be the worst
   * EXIT-TIME origin. It is the moment the redeemability claim is about, and
   * it is the same origin S2 is graded at, but it is not a search over every
   * possible stress onset.
   */
  timeToFullExitOrigins: number | null;
  /**
   * True when the exit did not complete only because the observation window
   * ended first (fewer than the registered bound's worth of origins remained
   * after the stress origin). Right-censoring is a MISSING measurement, not
   * a failure — see `sustainability-metrics.ts`.
   */
  timeToFullExitCensored: boolean;
  /** Per venue, the LARGEST share of that venue the vault itself was. */
  venueStressContribution: Record<string, number>;
  /** Deployed-weighted advertised APY minus `realizedNetApy`. */
  displayedVsRealizedGapApy: number;
  /**
   * Actions the replay could not honour as proposed: a deploy into a venue
   * that was paused or absent from the snapshot, or a divest from a venue
   * the vault held nothing in. §11.5's operational-continuity criterion
   * grades this; a correct policy scores 0.
   */
  policyViolations: number;
}

/** min/p05/median over a `stressedLiquidCoverage` series. */
export interface CoverageDistribution {
  min: number;
  p05: number;
  median: number;
}

/**
 * Summarize a `stressedLiquidCoverage` series as min/p05/median.
 *
 * An empty series returns all-1s rather than all-0s: no measurement was
 * taken, so nothing was observed to be illiquid — a 0 would misreport an
 * absence of data as maximal stress.
 */
export function coverageDistribution(series: readonly number[]): CoverageDistribution {
  if (series.length === 0) return { min: 1, p05: 1, median: 1 };
  const sorted = [...series].sort((a, b) => a - b);
  const percentile = (p: number): number => {
    const idx = p * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo]!;
    const frac = idx - lo;
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
  };
  return { min: sorted[0]!, p05: percentile(0.05), median: percentile(0.5) };
}

/**
 * Configuration for replay execution
 */
export interface ReplayConfig {
  dataset: EvaluationDataset;
  evaluationId: string;
  startDate: string | Date;
  endDate: string | Date;
  forecastMethod?: { method: string; config: Record<string, unknown> };
  horizons?: string[];
  tiers?: string[];
  coverageTarget?: number;
  significanceLevel?: number;
  tier: bigint;
  policy: PolicyFn;
  /**
   * Redemptions to execute. Empty/absent means none were attempted, and
   * `withdrawalSuccessRate` will be `null` rather than a flattering 1.
   */
  withdrawals?: WithdrawalRequest[];
  /** wei per gas unit. Registered constant — the collector persists no gas
   *  observation, see the harness's `REPLAY_GAS` note. */
  gasPriceWei?: bigint;
  /** USD per ETH, 8 decimals. Same provenance caveat as `gasPriceWei`. */
  ethUsdE8?: bigint;
}

/** Base-chain gas price used when the caller supplies none. wei per gas. */
export const DEFAULT_REPLAY_GAS_PRICE_WEI = 30_000_000n; // 0.03 gwei
/** ETH/USD used when the caller supplies none. USD, 8 decimals. */
export const DEFAULT_REPLAY_ETH_USD_E8 = 350_000_000_000n; // $3,500.00

/**
 * Run replay for a specific tier and policy.
 *
 * Two properties the previous implementation did not have:
 *
 *  1. **Yield comes from the snapshot.** Each venue accrues its own observed
 *     `supplyRateE18` over the real elapsed time between snapshots, applied
 *     to the vault's balance in that venue. The old engine awarded a flat 5%
 *     APY on everything deployed and discarded the snapshot entirely, which
 *     made venue choice causally irrelevant to the returns it reported.
 *
 *  2. **Redemptions are executed.** A redemption is paid out of idle; if idle
 *     is short, the vault unwinds venues (in sorted id order, each capped by
 *     its observed synchronous exit capacity) and pays gas for every unwind.
 *     If it still cannot reach the requested amount, the redemption FAILS —
 *     atomically, as ERC-4626 `redeem` does on NavyVaultSRCLA. That is the
 *     penalty a zero-cash policy was previously exempt from.
 *
 * Costs are charged to NAV at the moment they occur, so every reported
 * return series is already after-cost per period (§11.5's criterion) rather
 * than gross with a lump subtracted at the end.
 */
export function runReplay(config: ReplayConfig): ReplayResult {
  const { dataset, evaluationId, tier, policy } = config;
  const gasPriceWei = config.gasPriceWei ?? DEFAULT_REPLAY_GAS_PRICE_WEI;
  const ethUsdE8 = config.ethUsdE8 ?? DEFAULT_REPLAY_ETH_USD_E8;

  const cohortId = `tier-${tier}`;
  // Start EMPTY and let the tier arrive as a deposit. Constructing with
  // `tier` and then depositing `tier` again (what this did before) seeded the
  // vault with twice the tier and left the cohort holding only half the
  // shares — so no tier in the manifest was the size it claimed, and a
  // redemption sized as a fraction of the tier was really half that fraction
  // of NAV.
  const vault = new VaultReplay(0n);
  vault.deposit(tier, cohortId);

  const snapshots: ReplaySnapshot[] = [];
  const withdrawalOutcomes: WithdrawalOutcome[] = [];
  let totalTurnover = 0n;
  let totalCosts = 0n;
  let minStressedLiquidCoverage = 1;
  let worstCoverageIndex = 0;
  const coverageSeries: number[] = [];
  // §11.5 sustainability inputs, accumulated per origin.
  const exitSeries: ExitOrigin[] = [];
  const venueShareSeries: Array<Record<string, number>> = [];
  const displayedSeries: DisplayedOrigin[] = [];
  let policyViolations = 0;
  const initialSharePrice = vault.currentSharePrice();

  const requestsByIndex = new Map<number, WithdrawalRequest[]>();
  for (const w of config.withdrawals ?? []) {
    const list = requestsByIndex.get(w.snapshotIndex) ?? [];
    list.push(w);
    requestsByIndex.set(w.snapshotIndex, list);
  }

  const charge = (costBase: bigint): void => {
    if (costBase <= 0n) return;
    totalCosts += costBase;
    vault.applyLoss(costBase);
  };

  let previousTimestampSeconds: number | null = null;

  // Replay each snapshot
  for (let i = 0; i < dataset.snapshots.length; i++) {
    const snapshot = dataset.snapshots[i]!;
    const nowSeconds = Math.floor(snapshot.timestamp.getTime() / 1000);

    // Accrue the yield earned SINCE the previous snapshot, on the positions
    // that were held over that interval, before this snapshot's policy gets
    // to act on new information.
    if (previousTimestampSeconds !== null) {
      const elapsed = BigInt(Math.max(0, nowSeconds - previousTimestampSeconds));
      vault.addYield(accruedYieldBase(vault.getState(), snapshot, elapsed));
    }
    previousTimestampSeconds = nowSeconds;

    // Get policy actions
    const actions = policy(vault.getState(), snapshot);

    // §11.5 S4: an action the venue set could not honour as proposed is an
    // operational-continuity violation, counted BEFORE the replay silently
    // clips it. A correct policy proposes none.
    const observed = new Map(snapshot.snapshots.map((m) => [m.marketId, m]));
    for (const action of actions) {
      if (action.amount <= 0n) continue;
      if (action.kind === 'deploy') {
        const market = observed.get(action.adapter);
        if (market === undefined || market.paused) policyViolations += 1;
      } else if ((vault.getState().strategyBalances.get(action.adapter) ?? 0n) <= 0n) {
        policyViolations += 1;
      }
    }

    // Execute actions
    for (const action of actions) {
      const state = vault.getState();
      if (action.kind === 'deploy') {
        const available = state.idleBase;
        const amount = action.amount < available ? action.amount : available;
        if (amount <= 0n) continue;
        charge(modelExecution({ ...action, amount, gasPriceWei, ethUsdE8 }, state).totalCostBase);
        totalTurnover += amount;
        vault.deploy(action.adapter, amount);
      } else {
        if (action.amount <= 0n) continue;
        charge(modelExecution({ ...action, gasPriceWei, ethUsdE8 }, state).totalCostBase);
        const moved = vault.divest(action.adapter, action.amount);
        totalTurnover += moved;
      }
    }

    // Attempt this snapshot's redemptions against real liquidity.
    for (const request of requestsByIndex.get(i) ?? []) {
      // A NAV-fraction request is sized HERE, against the vault as it stands,
      // so the demand series cannot outrun the vault it is drawn on.
      const sized: WithdrawalRequest =
        request.navFractionBps === undefined
          ? request
          : {
              ...request,
              assetsBase:
                (vault.getState().totalAssets * BigInt(request.navFractionBps)) / 10_000n,
            };
      withdrawalOutcomes.push(
        executeRedemption(vault, cohortId, sized, i, snapshot, {
          gasPriceWei,
          ethUsdE8,
          charge,
          onTurnover: (moved) => {
            totalTurnover += moved;
          },
        }),
      );
    }

    // Record state
    const sharePriceWad = vault.currentSharePrice();
    const totalReturn = Number(sharePriceWad - initialSharePrice) / Number(WAD);
    const coverage = stressedCoverage({
      holdings: vault.getState().strategyBalances,
      idleBase: vault.getState().idleBase,
      venueCashByMarket: new Map(snapshot.snapshots.map((m) => [m.marketId, m.cashBase])),
      totalAssetsBase: vault.getState().totalAssets,
    }).worst;
    if (coverage < minStressedLiquidCoverage) {
      minStressedLiquidCoverage = coverage;
      worstCoverageIndex = i;
    }
    coverageSeries.push(coverage);

    // §11.5 sustainability inputs for this origin, read from the SAME state
    // the coverage figure above was read from.
    const post = vault.getState();
    let exitCapacityBase = 0n;
    let deployedBase = 0n;
    let weightedRate = 0;
    const shares: Record<string, number> = {};
    for (const [marketId, balance] of post.strategyBalances) {
      if (balance <= 0n) continue;
      deployedBase += balance;
      const market = observed.get(marketId);
      const venueCash = market?.cashBase ?? 0n;
      exitCapacityBase += balance < venueCash ? balance : venueCash;
      const venueTotal = market?.totalAssetsBase ?? 0n;
      if (venueTotal > 0n) shares[marketId] = Number(balance) / Number(venueTotal);
      weightedRate += Number(balance) * (Number(market?.supplyRateE18 ?? 0n) / 1e18);
    }
    exitSeries.push({ navBase: post.totalAssets, idleBase: post.idleBase, exitCapacityBase });
    venueShareSeries.push(shares);
    displayedSeries.push({
      displayedApy: deployedBase === 0n ? 0 : weightedRate / Number(deployedBase),
      deployedBase,
    });

    snapshots.push({
      timestamp: snapshot.timestamp,
      totalAssets: vault.getState().totalAssets,
      totalShares: vault.getState().totalShares,
      sharePriceWad,
      totalReturn,
      idleBase: vault.getState().idleBase,
      stressedLiquidCoverage: coverage,
    });
  }

  const successful = withdrawalOutcomes.filter((w) => w.success).length;
  const realizedNetApy = annualizedSharePriceGrowth(snapshots);
  const exitTime = timeToFullExit(exitSeries, {
    startIndex: worstCoverageIndex,
    boundOrigins: REGISTERED_MAX_EXIT_ORIGINS,
  });

  return {
    policyId: evaluationId,
    tier,
    cohortId,
    snapshots,
    realizedNetApy,
    totalTurnover,
    withdrawalSuccessRate:
      withdrawalOutcomes.length > 0 ? successful / withdrawalOutcomes.length : null,
    withdrawals: withdrawalOutcomes,
    totalCosts,
    minStressedLiquidCoverage,
    coverageDistribution: coverageDistribution(coverageSeries),
    // Graded from the run's WORST coverage origin: the moment the vault was
    // least able to pay is the only moment a redeemability claim is about.
    timeToFullExitOrigins: exitTime.origins,
    timeToFullExitCensored: exitTime.censored,
    venueStressContribution: venueStressContribution(venueShareSeries),
    displayedVsRealizedGapApy: displayedVsRealizedGap(displayedSeries, realizedNetApy),
    policyViolations,
  };
}

/**
 * Source `request.assetsBase` from idle, unwinding venues in sorted id order
 * when idle is short. Each unwind is a real transaction and pays gas.
 *
 * Exit capacity per venue is `min(vault balance there, venue cash)` — the
 * same conservative same-transaction exit `MarketObservation.maxWithdrawableBase`
 * uses in the policy kernel, read from the snapshot rather than assumed.
 */
function executeRedemption(
  vault: VaultReplay,
  cohortId: string,
  request: WithdrawalRequest,
  snapshotIndex: number,
  snapshot: TimeOrderedSnapshot,
  ctx: {
    gasPriceWei: bigint;
    ethUsdE8: bigint;
    charge: (costBase: bigint) => void;
    onTurnover: (movedBase: bigint) => void;
  },
): WithdrawalOutcome {
  const divestedFrom: string[] = [];
  const cashByMarket = new Map(snapshot.snapshots.map((m) => [m.marketId, m.cashBase]));

  const ordered = [...vault.getState().strategyBalances.keys()].sort();
  for (const marketId of ordered) {
    const state = vault.getState();
    const shortfall = request.assetsBase - state.idleBase;
    if (shortfall <= 0n) break;

    const balance = state.strategyBalances.get(marketId) ?? 0n;
    const venueCash = cashByMarket.get(marketId) ?? 0n;
    const exitable = balance < venueCash ? balance : venueCash;
    if (exitable <= 0n) continue;

    const amount = shortfall < exitable ? shortfall : exitable;
    ctx.charge(
      modelExecution(
        { kind: 'divest', adapter: marketId, amount, gasPriceWei: ctx.gasPriceWei, ethUsdE8: ctx.ethUsdE8 },
        state,
      ).totalCostBase,
    );
    const moved = vault.divest(marketId, amount);
    ctx.onTurnover(moved);
    divestedFrom.push(marketId);
  }

  const { grantedBase, reason } = vault.redeemAssets(cohortId, request.assetsBase);

  return {
    snapshotIndex,
    requestedBase: request.assetsBase,
    grantedBase,
    success: grantedBase >= request.assetsBase,
    reason,
    divestedFrom,
  };
}

/**
 * Interest earned over `elapsedSeconds` by the vault's actual per-venue
 * balances at each venue's OWN observed supply rate.
 *
 *   yieldBase = balanceBase * supplyRateWad * elapsedSeconds
 *               / (SECONDS_PER_YEAR * WAD)
 *
 * A venue the vault holds but that is absent from this snapshot earns
 * nothing: a missing observation is not evidence of yield. Idle USDC earns
 * nothing either. There is no floor — the old engine returned a minimum of
 * 1n "to avoid zero-yield stall", which manufactured return for a policy
 * that deployed nothing.
 */
export function accruedYieldBase(
  state: VaultState,
  snapshot: TimeOrderedSnapshot,
  elapsedSeconds: bigint,
): bigint {
  if (elapsedSeconds <= 0n) return 0n;
  const rateByMarket = new Map(snapshot.snapshots.map((m) => [m.marketId, m.supplyRateE18]));

  let accrued = 0n;
  for (const [marketId, balance] of state.strategyBalances) {
    if (balance <= 0n) continue;
    const rateWad = rateByMarket.get(marketId);
    if (rateWad === undefined || rateWad <= 0n) continue;
    accrued += (balance * rateWad * elapsedSeconds) / (SECONDS_PER_YEAR * WAD);
  }
  return accrued;
}

/**
 * Annualized realized net APY, measured as SHARE-PRICE growth (§11.4's
 * "share-price growth"), not as total-asset growth.
 *
 * This has to be share price: the replay now executes redemptions, so total
 * assets fall for reasons that have nothing to do with performance, and a
 * total-asset measure would score every policy by how much of the vault
 * happened to be redeemed. Costs are already charged against NAV as they
 * occur, so this figure is after-cost.
 */
export function annualizedSharePriceGrowth(snapshots: ReplaySnapshot[]): number {
  if (snapshots.length < 2) return 0;
  const start = snapshots[0]!.sharePriceWad;
  const end = snapshots[snapshots.length - 1]!.sharePriceWad;
  if (start <= 0n) return 0;

  const growth = Number(end - start) / Number(start);

  const firstTime = snapshots[0]!.timestamp.getTime();
  const lastTime = snapshots[snapshots.length - 1]!.timestamp.getTime();
  const years = (lastTime - firstTime) / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 1 / 365) return growth; // less than a day — report the simple return

  if (growth <= -1) return -1;
  const base = 1 + growth;
  if (base <= 0) return -1;

  return Math.pow(base, 1 / years) - 1;
}
