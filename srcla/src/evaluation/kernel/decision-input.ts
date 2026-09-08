/**
 * Adapter: replay state + a time-ordered snapshot -> the kernel's
 * `DecisionInput`.
 *
 * This is the ONLY thing the evaluation harness reimplements, and it is
 * deliberately not policy: it produces the kernel's INPUTS. Every policy in
 * the evaluation (SRCLA, B0-B5, B2u, H1-H7) then runs the same
 * `src/policy/decide.ts` over the same input, which is what makes §11.1's
 * "all policies receive the same observations available at each origin"
 * structurally true instead of a promise two code paths could break.
 *
 * It mirrors `src/runtime/decision-driver.ts#buildRawOriginFromCollector`
 * field for field wherever the dataset carries the same quantity, including
 * that function's documented placeholders, so the offline and live paths
 * cannot disagree about what a market observation is.
 *
 * UNITS: money is bigint USDC base units (6 dp); rates and quantiles are WAD
 * (1e18) annualized; times are seconds; gas prices are wei; ETH/USD is 8 dp.
 */
import { createHash } from 'crypto';
import { protocolOf } from '../../domain/protocol.js';
import type { HorizonSeconds } from '../../policy/registered.js';
import type {
  CompletedLabel,
  DecisionInput,
  GasObservation,
  MarketObservation,
  WithdrawalObservation,
} from '../../policy/types.js';
import type { TimeOrderedSnapshot } from '../dataset.js';
import type { VaultState } from '../replay/state.js';

const WAD = 10n ** 18n;
/** Matches protocols/math.ts and replay.ts (365.25 days). */
const SECONDS_PER_YEAR = 31_557_600n;

/** Per-venue configuration the dataset does not carry. See NOT_OBSERVED. */
export interface HarnessMarketConfig {
  /** Percentage cap on this venue, bps of NAV. */
  capBps: number;
  /** Absolute cap on this venue, USDC base units. */
  absoluteCapBase: bigint;
  maxLossBps: number;
  /** Shared-dependency groups this venue belongs to (§8.2). */
  dependencyGroupIds: string[];
}

export interface HarnessVaultConfig {
  /** USDC base units. §8.1's admin floor. */
  adminReserveBase: bigint;
  /** bps of NAV. The other half of §8.1's floor. */
  minIdleBps: number;
  configurationDigest: string;
}

export interface HarnessConfig {
  vault: HarnessVaultConfig;
  /** Per-market configuration; `defaultMarket` covers anything unlisted. */
  markets: Record<string, HarnessMarketConfig>;
  defaultMarket: HarnessMarketConfig;
  dependencyGroups: DecisionInput['dependencyGroups'];
  /**
   * REGISTERED CONSTANT, NOT OBSERVED. srcla persists no gas/oracle snapshot
   * — there is no Prisma model for one, and the live service fills three of
   * these five fields from `config.srcla.placeholder*` (see config.ts). Any
   * cost-gate number produced from this is only as good as this constant.
   */
  gas: GasObservation;
  horizonSeconds: HorizonSeconds;
  /** §7.3: an outcome is usable only once it is readable off-chain. */
  availabilityLagSeconds: number;
}

/**
 * Quantities the paper's decision needs that the collector does NOT persist,
 * enumerated here rather than buried at their use sites. Each is supplied
 * from `HarnessConfig` as a REGISTERED constant, never inferred from data.
 */
export const NOT_OBSERVED = [
  // No Prisma model holds l1BaseFeeWei / l1BlobBaseFeeWei / ethUsdE8 /
  // usdcUsdE8, and MarketSnapshot has no gas columns.
  'gas and oracle observation (GasObservation)',
  // MarketSnapshot has capBps, but no absolute cap, no maxLossBps and no
  // dependency-group membership. The live driver hardcodes the same three.
  'per-venue absoluteCapBase / maxLossBps / dependencyGroupIds',
  // §8.2's shared-dependency groups have no collector output at all.
  'dependency group registry (id, capBps, absoluteCapBase, members)',
  // Protocol supply-cap headroom is not read; the replay uses venue cash as
  // the deployable ceiling, which is a LOWER bound on true headroom.
  'protocol supply-cap headroom (maxDeployableBase)',
  // The vault's on-chain adminReserve/minIdleBps are not in the dataset.
  'vault adminReserveBase / minIdleBps',
] as const;

/**
 * A deterministic 20-byte address for a market id.
 *
 * The dataset carries no adapter deployment addresses, but `buildPlan` ABI-
 * encodes `action.adapter` as a Solidity `address` when it hashes a plan
 * action, so a bare market id makes the kernel throw. This is a stable
 * stand-in used ONLY as a hashing input inside the replay — it is never a
 * real deployment and nothing on chain is addressed by it. Lowercase, so
 * ethers accepts it without a checksum.
 */
export function replayAdapterAddress(marketId: string): string {
  return '0x' + createHash('sha256').update(marketId).digest('hex').slice(0, 40);
}

function marketConfig(config: HarnessConfig, marketId: string): HarnessMarketConfig {
  return config.markets[marketId] ?? config.defaultMarket;
}

/**
 * Build the kernel input for one decision origin.
 *
 * `labels` must already be filtered to outcomes available at or before this
 * origin — see `deriveCompletedLabels`, which owns the availability barrier.
 */
export function buildDecisionInput(
  state: VaultState,
  snapshot: TimeOrderedSnapshot,
  labels: CompletedLabel[],
  withdrawals: WithdrawalObservation[],
  config: HarnessConfig,
  lastAction: DecisionInput['lastAction'],
): DecisionInput {
  const originSeconds = Math.floor(snapshot.timestamp.getTime() / 1000);

  const markets: MarketObservation[] = snapshot.snapshots.map((m) => {
    const cfg = marketConfig(config, m.marketId);
    const positionBase = state.strategyBalances.get(m.marketId) ?? 0n;
    return {
      marketId: m.marketId,
      // The dataset carries no adapter deployment address; see
      // replayAdapterAddress for what this is and is not.
      adapter: replayAdapterAddress(m.marketId),
      protocol: protocolOf(m.marketId),
      cash: m.cashBase,
      borrows: m.borrowsBase,
      reserves: m.reservesBase,
      supplyRateWad: m.supplyRateE18,
      utilizationWad: m.utilizationE18,
      positionBase,
      // NOT OBSERVED: the collector persists no protocol supply cap, so the
      // replay treats supply headroom as NON-BINDING and lets the registered
      // absolute cap govern. Using venue cash here instead would silently
      // equate deployable headroom with exit capacity, and P4's phi (which
      // compares the target against `maxWithdrawableBase`) could then never
      // be anything but 1 — an ablation that removes nothing by
      // construction. Compound III's base supply really is uncapped while
      // its withdrawal really is bounded by cash, so equating them is not a
      // conservative simplification, it is the wrong shape.
      maxDeployableBase: cfg.absoluteCapBase,
      // The venue's synchronous exit CAPACITY, not the current position's
      // exit — see MarketObservation's doc comment for why min(position,
      // cash) is a cold-start deadlock. Same value the live driver uses.
      maxWithdrawableBase: m.cashBase,
      configDigest: m.configDigest,
      // §6.2: a regime IS a configuration digest (ContractRegime.digest), so
      // a configuration change starts a new regime and resets the history
      // requirement — which is the behaviour the admission rule wants.
      regimeId: m.configDigest,
      paused: m.paused,
      capBps: m.capBps,
      absoluteCapBase: cfg.absoluteCapBase,
      maxLossBps: cfg.maxLossBps,
      dependencyGroupIds: cfg.dependencyGroupIds,
    };
  });

  return {
    origin: {
      // The dataset stores a block HASH but no block number; the snapshot's
      // ordinal position is the replay's monotone origin index.
      blockNumber: snapshot.index,
      blockHash: snapshot.blockHash,
      timestampSeconds: originSeconds,
      finalized: true,
    },
    vault: {
      totalAssetsBase: state.totalAssets,
      idleBase: state.idleBase,
      sharesOutstanding: state.totalShares,
      adminReserveBase: config.vault.adminReserveBase,
      // No plan has been activated in a replay, so there is no persisted
      // dynamic reserve to carry forward.
      dynamicReserveBase: 0n,
      minIdleBps: config.vault.minIdleBps,
      paused: false,
      configurationDigest: config.vault.configurationDigest,
    },
    markets,
    dependencyGroups: config.dependencyGroups,
    withdrawals,
    gas: config.gas,
    history: labels,
    lastAction,
  };
}

/**
 * Derive the completed, availability-lagged training labels from the dataset
 * itself (§7.1's target quantity, §7.3's no-look-ahead rule).
 *
 * For an origin snapshot at t_j, the realized H-horizon return of a venue is
 * the mean of its observed supply rates over [t_j, t_j + H], converted to the
 * horizon:
 *
 *   realizedReturnWad = meanSupplyRateWad * H / SECONDS_PER_YEAR
 *
 * and `realizedMinCashBase` is the minimum observed venue cash over the same
 * window. The label becomes usable only at t_j + H + availabilityLag.
 *
 * Deriving labels here rather than reading `ForecastLabel` rows is
 * deliberate: `persistForecastLabel` writes neither `regimeId` nor
 * `horizonEndsAt`, so every persisted label would collapse to regime
 * 'unknown' and fail `admit`'s REGIME_MIN_HISTORY against a market whose
 * regime is its configuration digest. Derived labels carry the regime the
 * venue was actually in at the origin, by construction.
 *
 * Returns labels for the WHOLE dataset, sorted by availability; the caller
 * filters by origin. Nothing here reads a value from after t_j + H.
 */
export function deriveCompletedLabels(
  snapshots: TimeOrderedSnapshot[],
  horizonSeconds: HorizonSeconds,
  availabilityLagSeconds: number,
): CompletedLabel[] {
  const seconds = (s: TimeOrderedSnapshot): number => Math.floor(s.timestamp.getTime() / 1000);
  const labels: CompletedLabel[] = [];

  for (let j = 0; j < snapshots.length; j++) {
    const origin = snapshots[j]!;
    const originSeconds = seconds(origin);
    const endSeconds = originSeconds + horizonSeconds;

    for (const m of origin.snapshots) {
      let rateSum = 0n;
      let observations = 0n;
      let minCash = m.cashBase;

      for (let k = j; k < snapshots.length; k++) {
        const s = snapshots[k]!;
        if (seconds(s) > endSeconds) break;
        const obs = s.snapshots.find((x) => x.marketId === m.marketId);
        if (obs === undefined) continue;
        rateSum += obs.supplyRateE18;
        observations += 1n;
        if (obs.cashBase < minCash) minCash = obs.cashBase;
      }

      // A window that never reached the horizon end has no realized outcome.
      const last = snapshots[snapshots.length - 1]!;
      if (observations < 2n || seconds(last) < endSeconds) continue;

      labels.push({
        marketId: m.marketId,
        regimeId: m.configDigest,
        originSeconds,
        horizonSeconds,
        horizonEndSeconds: endSeconds,
        availableAtSeconds: endSeconds + availabilityLagSeconds,
        realizedReturnWad: (rateSum / observations) * BigInt(horizonSeconds) / SECONDS_PER_YEAR,
        realizedMinCashBase: minCash,
        // §7.2's second target needs a denominator to be scale-free. The
        // origin's own observed cash is that denominator, and it is
        // available here by construction — `m` IS the origin observation.
        originCashBase: m.cashBase,
      });
    }
  }

  labels.sort((a, b) => a.availableAtSeconds - b.availableAtSeconds);
  return labels;
}

/** Labels an origin at `originSeconds` is allowed to see. */
export function labelsAvailableAt(labels: CompletedLabel[], originSeconds: number): CompletedLabel[] {
  return labels.filter((l) => l.availableAtSeconds <= originSeconds);
}

/**
 * Per-venue residual quantiles for the artifact, calibrated on the
 * CALIBRATION labels only (P1: solved per venue to the coverage target).
 *
 * The quantile is the empirical `1 - coverage` lower quantile of the label
 * residuals against the venue's own mean realized return, clamped at <= 0 as
 * `lowerBoundAt` requires. A venue with fewer than `minObservations` labels
 * gets 0n — a zero shrink, not a fabricated dispersion.
 */
export function calibrateResidualQuantiles(
  labels: CompletedLabel[],
  coverageTarget: number,
  minObservations: number,
): Record<string, bigint> {
  const byMarket = new Map<string, bigint[]>();
  for (const l of labels) {
    const list = byMarket.get(l.marketId) ?? [];
    list.push(l.realizedReturnWad);
    byMarket.set(l.marketId, list);
  }

  const out: Record<string, bigint> = {};
  for (const [marketId, returns] of byMarket) {
    if (returns.length < minObservations) {
      out[marketId] = 0n;
      continue;
    }
    const mean = returns.reduce((s, v) => s + v, 0n) / BigInt(returns.length);
    const residuals = returns.map((r) => r - mean).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const idx = Math.min(residuals.length - 1, Math.floor((1 - coverageTarget) * residuals.length));
    const q = residuals[idx]!;
    out[marketId] = q > 0n ? 0n : q;
  }
  return out;
}

/**
 * §7.2's SECOND registered target, calibrated with THE SAME MACHINERY as the
 * first: the empirical `1 - coverage` lower quantile of each venue's
 * withdrawable-cash residuals, on the CALIBRATION labels only.
 *
 * The residual is RELATIVE, not absolute:
 *
 *     r = (realizedMinCash - originCash) * WAD / originCash
 *
 * so it transfers across venues and vault sizes. It is <= 0 by construction
 * whenever the minimum over the horizon is at or below the origin's cash, and
 * is clamped at <= 0 for the same reason `calibrateResidualQuantiles` clamps:
 * `withdrawableLowerBoundBase` refuses a positive quantile, because a
 * "conservative" exit larger than the observed one is the one direction this
 * quantity must never move.
 *
 * A label with no `originCashBase` is SKIPPED, not counted as a zero
 * residual: the live `ForecastLabel` table cannot supply that denominator,
 * and folding those rows in as zeros would drag every calibrated quantile
 * toward "the cash will still all be there", which is precisely the spot
 * reading this target replaces.
 *
 * A venue with fewer than `minObservations` usable labels gets NO ENTRY at
 * all rather than a `0n` entry. That difference matters here in a way it
 * does not for the return quantile: `cashQuantileFor` falls back to the most
 * conservative calibrated peer and then to the artifact's registered
 * negative scalar, so an absent entry is conservative while a `0n` entry
 * would be the most optimistic value available.
 */
export function calibrateCashResidualQuantiles(
  labels: CompletedLabel[],
  coverageTarget: number,
  minObservations: number,
): Record<string, bigint> {
  const byMarket = new Map<string, bigint[]>();
  for (const l of labels) {
    if (l.originCashBase === null || l.originCashBase <= 0n) continue;
    const residual = ((l.realizedMinCashBase - l.originCashBase) * WAD) / l.originCashBase;
    const list = byMarket.get(l.marketId) ?? [];
    list.push(residual);
    byMarket.set(l.marketId, list);
  }

  const out: Record<string, bigint> = {};
  for (const [marketId, residuals] of byMarket) {
    if (residuals.length < minObservations) continue;
    const sorted = [...residuals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const idx = Math.min(sorted.length - 1, Math.floor((1 - coverageTarget) * sorted.length));
    const q = sorted[idx]!;
    out[marketId] = q > 0n ? 0n : q;
  }
  return out;
}
