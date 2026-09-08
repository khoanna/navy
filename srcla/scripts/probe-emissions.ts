/**
 * Emission probe - do the three venues actually emit anything?
 *
 * SRCLA-REPORT.md limitation #3 excluded reward tokens from the evaluation
 * entirely, and nobody had measured whether Aave V3 / Compound III / Moonwell
 * on Base currently emit anything material for a USDC supplier. This script
 * measures it, from chain, and prints the numbers behind every verdict so a
 * later reader can check the judgement rather than take it on trust.
 *
 * READ-ONLY. It makes `eth_call`s and nothing else: no transactions, no
 * database, no local node. It needs a Base RPC (chain 8453) and nothing more.
 *
 *   pnpm probe:emissions                      # uses BASE_RPC_URL
 *   BASE_RPC_URL=https://mainnet.base.org pnpm probe:emissions
 *   pnpm probe:emissions -- --rpc <url> --json
 *
 * ---------------------------------------------------------------------------
 * WHERE THE ADDRESSES COME FROM
 * ---------------------------------------------------------------------------
 * Every venue address below is copied from `contract/DEPLOYMENTS.md`'s "Key
 * addresses (Base mainnet)" table - NOT from memory. That file also carries an
 * "Ethereum Sepolia" section which is retired and dead; nothing here comes from
 * it. Reward controllers are NOT in that table, so this script DISCOVERS them
 * on chain from the addresses that are:
 *
 *   Aave V3      aUSDC.getIncentivesController()      -> RewardsController
 *   Moonwell     Comptroller.rewardDistributor()      -> MultiRewardDistributor
 *   Compound III Comet.baseTrackingSupplySpeed()      -> the supplier reward
 *                                                        accrual rate itself
 *
 * Compound's `CometRewards` address is the one thing neither derivable from
 * chain nor present in DEPLOYMENTS.md. It is therefore optional
 * (`COMET_REWARDS_ADDRESS`), and the verdict does not depend on it: a Comet
 * that accrues at zero speed emits nothing to suppliers regardless of what any
 * rewards contract holds.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS THE OUTPUT DELIBERATELY DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 * 1. The emission rates printed are MARKET-WIDE. A vault earns them pro-rata of
 *    its share of the market's supply, so the annualised USD figure is an upper
 *    bound on what any single depositor could receive - never a forecast of
 *    vault income.
 * 2. The USD prices used for the materiality screen are Uniswap V3 SPOT pool
 *    prices, read from `slot0`. They are adequate to answer "is this worth
 *    anything at all", and they are NOT admissible for accounting: paper §9.2
 *    requires fresh independent Chainlink feeds, and this script reports
 *    whether such a feed is configured separately from what it prices with.
 */

import { ethers } from 'ethers';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- contract/DEPLOYMENTS.md, "Key addresses (Base mainnet)" -----------------
const BASE_CHAIN_ID = 8453n;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AUSDC = '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB';
const COMET = '0xb125E6687d4313864e53df431d5425969c15Eb2F';
const MOONWELL_MUSDC = '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22';
const MOONWELL_COMPTROLLER = '0xfBb21d0380beE3312B33c4353c8936a0F13EF26C';
const UNISWAP_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const SECONDS_PER_YEAR = 31_536_000;
const FEE_TIERS = [100, 500, 3000, 10_000];

// --- minimal ABIs -----------------------------------------------------------
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];
const ATOKEN_ABI = ['function getIncentivesController() view returns (address)'];
const AAVE_REWARDS_ABI = [
  'function getRewardsByAsset(address asset) view returns (address[])',
  'function getRewardsData(address asset, address reward) view returns (uint256 index, uint256 emissionPerSecond, uint256 lastUpdateTimestamp, uint256 distributionEnd)',
  'function getTransferStrategy(address reward) view returns (address)',
];
const AAVE_TRANSFER_STRATEGY_ABI = ['function getRewardsVault() view returns (address)'];
const COMET_ABI = [
  'function baseTrackingSupplySpeed() view returns (uint64)',
  'function totalSupply() view returns (uint256)',
];
const COMET_REWARDS_ABI = [
  'function rewardConfig(address comet) view returns (address token, uint64 rescaleFactor, bool shouldUpscale)',
];
const COMPTROLLER_ABI = ['function rewardDistributor() view returns (address)'];
const MRD_ABI = [
  'function getAllMarketConfigs(address mToken) view returns (tuple(address owner, address emissionToken, uint256 endTime, uint224 supplyGlobalIndex, uint32 supplyGlobalTimestamp, uint224 borrowGlobalIndex, uint32 borrowGlobalTimestamp, uint256 supplyEmissionsPerSec, uint256 borrowEmissionsPerSec)[])',
];
const UNIV3_FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const UNIV3_POOL_ABI = [
  'function liquidity() view returns (uint128)',
  'function token0() view returns (address)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 a, uint16 b, uint16 c, uint8 d, bool unlocked)',
];
const CHAINLINK_ABI = [
  'function description() view returns (string)',
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
];

// --- shapes -----------------------------------------------------------------
type Verdict = 'MATERIAL' | 'IMMATERIAL' | 'NONE' | 'UNKNOWN';

interface PoolInfo {
  pool: string;
  feeTier: number;
  /** In-range liquidity. A pool can be DEPLOYED and hold exactly zero. */
  liquidity: bigint;
}

interface RouteInfo {
  /** Every DEPLOYED reward/USDC V3 pool, empty ones included. */
  deployedPools: PoolInfo[];
  /** Deepest pool with non-zero liquidity, or null when every pool is empty. */
  best: PoolInfo | null;
  /** Spot USDC per whole reward token, 6 dp. Null when unpriceable. */
  spotUsdcE6: bigint | null;
  /** Optional `--via <token>` two-hop check: reward -> via -> USDC. */
  via: { token: string; legA: PoolInfo | null; legB: PoolInfo | null } | null;
  /** True when the reward token IS the vault asset: nothing to swap, no route needed. */
  noSwapRequired: boolean;
}

interface FeedInfo {
  /** Feed address configured for this token, if any config was found. */
  address: string | null;
  description: string | null;
  answer: bigint | null;
  updatedAtSeconds: number | null;
  /** True only when a feed exists AND actually describes this reward token. */
  usableForToken: boolean;
  note: string;
}

interface VenueReport {
  venue: string;
  controller: string | null;
  controllerNote: string;
  rewardToken: string | null;
  rewardSymbol: string | null;
  rewardDecimals: number | null;
  /** Whole-market supplier emission, raw reward-token units per second. */
  emissionPerSecond: bigint | null;
  /** Unix seconds; null when the venue exposes no end timestamp. */
  distributionEndSeconds: number | null;
  remainingHorizonSeconds: number | null;
  /** Reward-token units the funding account still holds. */
  fundedAmount: bigint | null;
  fundedSource: string | null;
  /** Days of emission the funding covers at the current rate. */
  fundedDays: number | null;
  route: RouteInfo | null;
  feed: FeedInfo | null;
  annualisedUsd: number | null;
  verdict: Verdict;
  because: string[];
}

// --- helpers ----------------------------------------------------------------
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

/**
 * ethers v6 exposes contract methods through an index signature, which this
 * repo's `noUncheckedIndexedAccess` widens to `| undefined`. `getFunction` is
 * the typed accessor that does not, so every call below goes through it.
 */
function fn(c: ethers.Contract, name: string): ethers.ContractMethod {
  return c.getFunction(name);
}

/**
 * Why the last read returned null. A probe whose failures are indistinguishable
 * from "the venue emits nothing" is worse than useless, so the reason is kept
 * and printed rather than swallowed.
 */
let lastReadError: string | null = null;

/**
 * Every chain read goes through this: one unreadable call must not abort the
 * probe. A revert (`CALL_EXCEPTION`) or an undecodable response is final and is
 * not retried; anything else is treated as transport flakiness - public
 * endpoints rate-limit - and retried with backoff. Silently turning a 429 into
 * "no emissions" is exactly the failure this guards against.
 */
async function tryRead<T>(read: () => Promise<T>, attempts = 3): Promise<T | null> {
  let last: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      lastReadError = null;
      return await read();
    } catch (e) {
      last = e;
      const code = (e as { code?: string }).code;
      if (code === 'CALL_EXCEPTION' || code === 'BAD_DATA') break;
      await new Promise((r) => setTimeout(r, 250 * 2 ** i));
    }
  }
  const err = last as { shortMessage?: string; message?: string; code?: string } | null;
  lastReadError = err?.shortMessage ?? err?.message ?? String(err ?? 'unknown error');
  if (err?.code) lastReadError = `${err.code}: ${lastReadError}`;
  return null;
}

function fmtUnits(v: bigint | null, decimals: number | null): string {
  if (v === null || decimals === null) return 'n/a';
  return ethers.formatUnits(v, decimals);
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return 'n/a';
  if (seconds <= 0) return 'ended';
  const d = Math.floor(seconds / 86_400);
  return d >= 1 ? `${d}d` : `${Math.floor(seconds / 3600)}h`;
}

/**
 * Spot USDC per whole reward token from a Uniswap V3 pool's `slot0`, 6 dp.
 * price(token1/token0) = (sqrtPriceX96 / 2^96)^2, adjusted for decimals. Kept
 * in bigint until the final scaling so no float rounding enters the ratio.
 */
function spotUsdcE6FromSlot0(
  sqrtPriceX96: bigint,
  token0: string,
  rewardToken: string,
  rewardDecimals: number
): bigint {
  const Q96 = 1n << 96n;
  const rewardIsToken0 = token0.toLowerCase() === rewardToken.toLowerCase();
  const num = sqrtPriceX96 * sqrtPriceX96; // (sqrtP)^2, scaled by 2^192
  const one = 10n ** BigInt(rewardDecimals);

  if (rewardIsToken0) {
    // USDC(6dp) per 1e{rewardDecimals} of reward, then rescale to whole tokens.
    // price1per0 = num / 2^192 ; usdcE6 = price1per0 * one / 10^(6) * 10^6
    return (num * one) / (Q96 * Q96);
  }
  // Reward is token1: price0per1 = 2^192 / num.
  if (num === 0n) return 0n;
  return (Q96 * Q96 * one) / num;
}

interface RewardRouteConfig {
  address?: string;
  decimals?: number;
  usdcPriceFeed?: string;
  reason?: string;
  enabled?: boolean;
}

/**
 * The repo's own reward-route config (`contract/config/base-reward-routes.json`),
 * read ONLY to discover which Chainlink feed the deployment package believes
 * belongs to each reward token - so this probe can call that feed and print
 * what it actually is. Absent file => no feed configured, reported as such.
 */
function loadRouteConfig(): { path: string; byToken: Map<string, RewardRouteConfig> } {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = arg('routes') ?? resolve(here, '../../contract/config/base-reward-routes.json');
  const byToken = new Map<string, RewardRouteConfig>();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      rewardTokens?: Record<string, RewardRouteConfig>;
    };
    for (const cfg of Object.values(raw.rewardTokens ?? {})) {
      if (cfg.address) byToken.set(cfg.address.toLowerCase(), cfg);
    }
  } catch {
    /* absent or unreadable: reported as "no configured feed" below */
  }
  return { path, byToken };
}

/**
 * Deepest reward -> USDC Uniswap V3 pool, plus an honest inventory.
 *
 * "No pool exists" and "a pool exists but holds zero in-range liquidity" are
 * different facts with the same consequence, and an earlier revision of this
 * function reported both as "none found" - which would have let a reader
 * conclude Uniswap had never listed the token. Both are now reported.
 *
 * Only DIRECT reward/USDC pools are enumerated. §9.4 permits an ordered
 * multi-hop path, but the intermediate token is a deployment choice, not
 * something derivable from contract/DEPLOYMENTS.md, so a two-hop check runs
 * only when the operator names the intermediate with `--via <address>`.
 */
async function poolAt(
  provider: ethers.Provider,
  factory: ethers.Contract,
  a: string,
  b: string,
  fee: number
): Promise<PoolInfo | null> {
  const pool = await tryRead(() => fn(factory, 'getPool')(a, b, fee) as Promise<string>);
  if (!pool || pool === ethers.ZeroAddress) return null;
  const liquidity = await tryRead(
    () => fn(new ethers.Contract(pool, UNIV3_POOL_ABI, provider), 'liquidity')() as Promise<bigint>
  );
  return { pool, feeTier: fee, liquidity: liquidity ?? 0n };
}

async function deepest(
  provider: ethers.Provider,
  factory: ethers.Contract,
  a: string,
  b: string
): Promise<{ all: PoolInfo[]; best: PoolInfo | null }> {
  const all: PoolInfo[] = [];
  for (const fee of FEE_TIERS) {
    const p = await poolAt(provider, factory, a, b, fee);
    if (p) all.push(p);
  }
  const withLiquidity = all.filter((p) => p.liquidity > 0n);
  const best = withLiquidity.length
    ? withLiquidity.reduce((m, p) => (p.liquidity > m.liquidity ? p : m))
    : null;
  return { all, best };
}

async function probeRoute(
  provider: ethers.Provider,
  rewardToken: string,
  rewardDecimals: number
): Promise<RouteInfo> {
  // A reward paid in the vault asset itself needs no swap and therefore no
  // route; asking Uniswap for a USDC/USDC pool would report a spurious "no
  // route" against a reward that is already in the right denomination.
  if (rewardToken.toLowerCase() === USDC.toLowerCase()) {
    return { deployedPools: [], best: null, spotUsdcE6: 1_000_000n, via: null, noSwapRequired: true };
  }

  const factory = new ethers.Contract(UNISWAP_FACTORY, UNIV3_FACTORY_ABI, provider);
  const { all, best } = await deepest(provider, factory, rewardToken, USDC);

  let spotUsdcE6: bigint | null = null;
  if (best) {
    const c = new ethers.Contract(best.pool, UNIV3_POOL_ABI, provider);
    const token0 = await tryRead(() => fn(c, 'token0')() as Promise<string>);
    const slot0 = await tryRead(() => fn(c, 'slot0')() as Promise<{ sqrtPriceX96: bigint }>);
    if (token0 && slot0) {
      spotUsdcE6 = spotUsdcE6FromSlot0(slot0.sqrtPriceX96, token0, rewardToken, rewardDecimals);
    }
  }

  const viaToken = arg('via');
  let via: RouteInfo['via'] = null;
  if (viaToken) {
    const legA = await deepest(provider, factory, rewardToken, viaToken);
    const legB = await deepest(provider, factory, viaToken, USDC);
    via = { token: viaToken, legA: legA.best, legB: legB.best };
  }

  return { deployedPools: all, best, spotUsdcE6, via, noSwapRequired: false };
}

async function probeFeed(
  provider: ethers.Provider,
  rewardToken: string,
  rewardSymbol: string | null,
  routes: Map<string, RewardRouteConfig>
): Promise<FeedInfo> {
  const cfg = routes.get(rewardToken.toLowerCase());
  if (!cfg?.usdcPriceFeed) {
    return {
      address: null,
      description: null,
      answer: null,
      updatedAtSeconds: null,
      usableForToken: false,
      note: 'no Chainlink feed configured for this token in the reward-route config',
    };
  }
  const feed = new ethers.Contract(cfg.usdcPriceFeed, CHAINLINK_ABI, provider);
  const description = await tryRead(() => fn(feed, 'description')() as Promise<string>);
  const round = await tryRead(
    () => fn(feed, 'latestRoundData')() as Promise<{ answer: bigint; updatedAt: bigint }>
  );
  // A feed is usable for this reward ONLY if it actually describes it. The
  // configured feed is printed either way so a reader can see the mismatch.
  const usableForToken =
    description !== null &&
    rewardSymbol !== null &&
    description.toUpperCase().includes(rewardSymbol.toUpperCase());
  return {
    address: cfg.usdcPriceFeed,
    description,
    answer: round?.answer ?? null,
    updatedAtSeconds: round ? Number(round.updatedAt) : null,
    usableForToken,
    note: usableForToken
      ? 'feed describes this reward token'
      : `configured feed does NOT describe ${rewardSymbol ?? 'this token'} - not a usable reward/USD source`,
  };
}

// --- venue probes -----------------------------------------------------------

async function probeAave(
  provider: ethers.Provider,
  nowSeconds: number,
  routes: Map<string, RewardRouteConfig>
): Promise<VenueReport[]> {
  const base = (): VenueReport => ({
    venue: 'Aave V3 (aUSDC)',
    controller: null,
    controllerNote: '',
    rewardToken: null,
    rewardSymbol: null,
    rewardDecimals: null,
    emissionPerSecond: null,
    distributionEndSeconds: null,
    remainingHorizonSeconds: null,
    fundedAmount: null,
    fundedSource: null,
    fundedDays: null,
    route: null,
    feed: null,
    annualisedUsd: null,
    verdict: 'UNKNOWN',
    because: [],
  });

  const aToken = new ethers.Contract(AUSDC, ATOKEN_ABI, provider);
  const controller = await tryRead(() => fn(aToken, 'getIncentivesController')() as Promise<string>);
  if (!controller || controller === ethers.ZeroAddress) {
    const r = base();
    r.controllerNote = `aUSDC.getIncentivesController() unreadable or zero: ${lastReadError ?? 'returned zero address'}`;
    r.verdict = 'UNKNOWN';
    r.because.push('could not resolve the RewardsController from aUSDC');
    return [r];
  }

  const rc = new ethers.Contract(controller, AAVE_REWARDS_ABI, provider);
  const rewards = await tryRead(() => fn(rc, 'getRewardsByAsset')(AUSDC) as Promise<string[]>);
  if (rewards === null) {
    const r = base();
    r.controller = controller;
    r.controllerNote = 'RewardsController.getRewardsByAsset reverted';
    r.because.push('reward list unreadable');
    return [r];
  }
  if (rewards.length === 0) {
    const r = base();
    r.controller = controller;
    r.controllerNote = 'resolved from aUSDC.getIncentivesController()';
    r.verdict = 'NONE';
    r.because.push('RewardsController lists zero reward tokens for aUSDC');
    return [r];
  }

  const out: VenueReport[] = [];
  for (const reward of rewards) {
    const r = base();
    r.controller = controller;
    r.controllerNote = 'resolved from aUSDC.getIncentivesController()';
    r.rewardToken = reward;

    const erc = new ethers.Contract(reward, ERC20_ABI, provider);
    r.rewardSymbol = await tryRead(() => fn(erc, 'symbol')() as Promise<string>);
    const dec = await tryRead(() => fn(erc, 'decimals')() as Promise<bigint>);
    r.rewardDecimals = dec === null ? null : Number(dec);

    const data = await tryRead(
      () =>
        fn(rc, 'getRewardsData')(AUSDC, reward) as Promise<{
          emissionPerSecond: bigint;
          distributionEnd: bigint;
        }>
    );
    if (data) {
      r.emissionPerSecond = data.emissionPerSecond;
      r.distributionEndSeconds = Number(data.distributionEnd);
      r.remainingHorizonSeconds = r.distributionEndSeconds - nowSeconds;
    }

    // Funding: a PullRewardsTransferStrategy pulls from a separate vault; a
    // direct strategy pays from its own balance. Try the vault, fall back.
    const strategy = await tryRead(() => fn(rc, 'getTransferStrategy')(reward) as Promise<string>);
    let fundingAccount = controller;
    let fundedSource = 'RewardsController balance';
    if (strategy && strategy !== ethers.ZeroAddress) {
      const st = new ethers.Contract(strategy, AAVE_TRANSFER_STRATEGY_ABI, provider);
      const vault = await tryRead(() => fn(st, 'getRewardsVault')() as Promise<string>);
      if (vault && vault !== ethers.ZeroAddress) {
        fundingAccount = vault;
        fundedSource = `rewards vault ${vault} (via transfer strategy ${strategy})`;
      } else {
        fundingAccount = strategy;
        fundedSource = `transfer strategy ${strategy} balance`;
      }
    }
    r.fundedAmount = await tryRead(() => fn(erc, 'balanceOf')(fundingAccount) as Promise<bigint>);
    r.fundedSource = fundedSource;

    if (r.rewardDecimals !== null) {
      r.route = await probeRoute(provider, reward, r.rewardDecimals);
      r.feed = await probeFeed(provider, reward, r.rewardSymbol, routes);
    }
    out.push(r);
  }
  return out;
}

async function probeCompound(
  provider: ethers.Provider,
  nowSeconds: number,
  routes: Map<string, RewardRouteConfig>
): Promise<VenueReport> {
  const r: VenueReport = {
    venue: 'Compound III (Comet USDC)',
    controller: null,
    controllerNote: '',
    rewardToken: null,
    rewardSymbol: null,
    rewardDecimals: null,
    emissionPerSecond: null,
    distributionEndSeconds: null,
    remainingHorizonSeconds: null,
    fundedAmount: null,
    fundedSource: null,
    fundedDays: null,
    route: null,
    feed: null,
    annualisedUsd: null,
    verdict: 'UNKNOWN',
    because: [],
  };

  const comet = new ethers.Contract(COMET, COMET_ABI, provider);
  const speed = await tryRead(() => fn(comet, 'baseTrackingSupplySpeed')() as Promise<bigint>);
  if (speed === null) {
    r.controllerNote = `Comet.baseTrackingSupplySpeed() unreadable: ${lastReadError ?? 'unknown'}`;
    r.because.push('supplier accrual speed unreadable');
    return r;
  }

  // Comet accrues supplier rewards through a tracking index driven by
  // `baseTrackingSupplySpeed`, expressed per second scaled by 1e15. A speed of
  // zero means suppliers accrue nothing, whatever any rewards contract holds -
  // which is why the verdict does not need CometRewards to be resolvable.
  const TRACKING_SPEED_SCALE = 10n ** 15n;
  r.controllerNote =
    `Comet.baseTrackingSupplySpeed() = ${speed} raw (per second, scaled by 1e15) ` +
    `= ${ethers.formatUnits(speed, 15)} accrual units/s`;

  const rewardsAddr = process.env['COMET_REWARDS_ADDRESS'] ?? arg('comet-rewards') ?? null;
  if (rewardsAddr) {
    r.controller = rewardsAddr;
    const cr = new ethers.Contract(rewardsAddr, COMET_REWARDS_ABI, provider);
    const cfg = await tryRead(
      () =>
        fn(cr, 'rewardConfig')(COMET) as Promise<{ token: string; rescaleFactor: bigint; shouldUpscale: boolean }>
    );
    if (cfg && cfg.token !== ethers.ZeroAddress) {
      r.rewardToken = cfg.token;
      const erc = new ethers.Contract(cfg.token, ERC20_ABI, provider);
      r.rewardSymbol = await tryRead(() => fn(erc, 'symbol')() as Promise<string>);
      const dec = await tryRead(() => fn(erc, 'decimals')() as Promise<bigint>);
      r.rewardDecimals = dec === null ? null : Number(dec);
      r.fundedAmount = await tryRead(() => fn(erc, 'balanceOf')(rewardsAddr) as Promise<bigint>);
      r.fundedSource = `CometRewards ${rewardsAddr} balance`;
      // Reward units/second = accrual units/second, rescaled to the reward
      // token's own decimals exactly as CometRewards does on claim.
      const accrualPerSecond = speed; // 1e15-scaled
      const rescale = cfg.rescaleFactor === 0n ? 1n : cfg.rescaleFactor;
      r.emissionPerSecond = cfg.shouldUpscale
        ? (accrualPerSecond * rescale) / TRACKING_SPEED_SCALE
        : accrualPerSecond / (TRACKING_SPEED_SCALE * rescale);
      if (r.rewardDecimals !== null) {
        r.route = await probeRoute(provider, cfg.token, r.rewardDecimals);
        r.feed = await probeFeed(provider, cfg.token, r.rewardSymbol, routes);
      }
    } else {
      r.because.push(`CometRewards ${rewardsAddr} has no reward configured for this Comet`);
    }
  } else {
    r.because.push(
      'CometRewards address not supplied (COMET_REWARDS_ADDRESS / --comet-rewards) and it is not ' +
        'in contract/DEPLOYMENTS.md; verdict rests on the accrual speed alone'
    );
  }

  // Comet exposes no distribution-end timestamp: emissions run until governance
  // sets the speed to zero. Recorded as "no end timestamp", never as "forever".
  r.distributionEndSeconds = null;
  r.remainingHorizonSeconds = null;
  if (speed === 0n) {
    r.verdict = 'NONE';
    r.because.push('baseTrackingSupplySpeed is 0: suppliers accrue no COMP');
  }
  void nowSeconds;
  return r;
}

async function probeMoonwell(
  provider: ethers.Provider,
  nowSeconds: number,
  routes: Map<string, RewardRouteConfig>
): Promise<VenueReport[]> {
  const base = (): VenueReport => ({
    venue: 'Moonwell (mUSDC)',
    controller: null,
    controllerNote: '',
    rewardToken: null,
    rewardSymbol: null,
    rewardDecimals: null,
    emissionPerSecond: null,
    distributionEndSeconds: null,
    remainingHorizonSeconds: null,
    fundedAmount: null,
    fundedSource: null,
    fundedDays: null,
    route: null,
    feed: null,
    annualisedUsd: null,
    verdict: 'UNKNOWN',
    because: [],
  });

  const comptroller = new ethers.Contract(MOONWELL_COMPTROLLER, COMPTROLLER_ABI, provider);
  const mrdAddr = await tryRead(() => fn(comptroller, 'rewardDistributor')() as Promise<string>);
  if (!mrdAddr || mrdAddr === ethers.ZeroAddress) {
    const r = base();
    r.controllerNote = `Comptroller.rewardDistributor() unreadable or zero: ${lastReadError ?? 'returned zero address'}`;
    r.because.push('could not resolve the MultiRewardDistributor');
    return [r];
  }

  const mrd = new ethers.Contract(mrdAddr, MRD_ABI, provider);
  const configs = await tryRead(
    () =>
      fn(mrd, 'getAllMarketConfigs')(MOONWELL_MUSDC) as Promise<
        Array<{ emissionToken: string; endTime: bigint; supplyEmissionsPerSec: bigint }>
      >
  );
  if (configs === null) {
    const r = base();
    r.controller = mrdAddr;
    r.controllerNote = 'MultiRewardDistributor.getAllMarketConfigs reverted';
    r.because.push('market configs unreadable');
    return [r];
  }
  if (configs.length === 0) {
    const r = base();
    r.controller = mrdAddr;
    r.controllerNote = 'resolved from Comptroller.rewardDistributor()';
    r.verdict = 'NONE';
    r.because.push('no reward configs registered for mUSDC');
    return [r];
  }

  const out: VenueReport[] = [];
  for (const cfg of configs) {
    const r = base();
    r.controller = mrdAddr;
    r.controllerNote = 'resolved from Comptroller.rewardDistributor()';
    r.rewardToken = cfg.emissionToken;
    r.emissionPerSecond = cfg.supplyEmissionsPerSec;
    r.distributionEndSeconds = Number(cfg.endTime);
    r.remainingHorizonSeconds = r.distributionEndSeconds - nowSeconds;

    const erc = new ethers.Contract(cfg.emissionToken, ERC20_ABI, provider);
    r.rewardSymbol = await tryRead(() => fn(erc, 'symbol')() as Promise<string>);
    const dec = await tryRead(() => fn(erc, 'decimals')() as Promise<bigint>);
    r.rewardDecimals = dec === null ? null : Number(dec);
    r.fundedAmount = await tryRead(() => fn(erc, 'balanceOf')(mrdAddr) as Promise<bigint>);
    r.fundedSource = `MultiRewardDistributor ${mrdAddr} balance`;

    if (r.rewardDecimals !== null) {
      r.route = await probeRoute(provider, cfg.emissionToken, r.rewardDecimals);
      r.feed = await probeFeed(provider, cfg.emissionToken, r.rewardSymbol, routes);
    }
    out.push(r);
  }
  return out;
}

// --- verdict ----------------------------------------------------------------

/**
 * Step 2 - deliberately conservative. MATERIAL requires ALL of:
 *   emitting > 0, still inside its horizon, funded for >= `minFundedDays` of
 *   emission at the current rate, a Uniswap route with non-zero liquidity, and
 *   an annualised market-wide value >= `minAnnualUsd`.
 * Anything emitting that misses one of those is IMMATERIAL; a zero rate or an
 * elapsed horizon is NONE; an unreadable input is UNKNOWN (never MATERIAL).
 */
function decide(r: VenueReport, minAnnualUsd: number, minFundedDays: number): void {
  const say = (s: string) => r.because.push(s);

  if (r.emissionPerSecond === null) {
    if (r.verdict === 'UNKNOWN' && r.because.length === 0) say('emission rate unreadable');
    if (r.verdict !== 'NONE') r.verdict = r.verdict === 'UNKNOWN' ? 'UNKNOWN' : r.verdict;
    return;
  }

  if (r.emissionPerSecond === 0n) {
    r.verdict = 'NONE';
    say('supplier emission rate is exactly 0');
    return;
  }
  say(`emitting ${fmtUnits(r.emissionPerSecond, r.rewardDecimals)} ${r.rewardSymbol ?? '?'}/s (market-wide)`);

  if (r.remainingHorizonSeconds !== null && r.remainingHorizonSeconds <= 0) {
    r.verdict = 'NONE';
    say(`distribution ended at ${r.distributionEndSeconds} (${-r.remainingHorizonSeconds}s ago)`);
    return;
  }

  if (r.fundedAmount !== null && r.emissionPerSecond > 0n) {
    r.fundedDays = Number(r.fundedAmount / r.emissionPerSecond) / 86_400;
    say(
      `funding covers ${r.fundedDays.toFixed(2)}d at the current rate ` +
        `(${fmtUnits(r.fundedAmount, r.rewardDecimals)} held in ${r.fundedSource ?? 'the controller'})`
    );
  }

  if (r.route && r.rewardDecimals !== null && r.route.spotUsdcE6 !== null && (r.route.best || r.route.noSwapRequired)) {
    const perSecond = Number(ethers.formatUnits(r.emissionPerSecond, r.rewardDecimals));
    const priceUsd = Number(ethers.formatUnits(r.route.spotUsdcE6, 6));
    r.annualisedUsd = perSecond * priceUsd * SECONDS_PER_YEAR;
    say(
      `${r.route.noSwapRequired ? 'reward IS the vault asset, priced 1:1' : `spot ${priceUsd.toFixed(6)} USDC/token in the ${r.route.best!.feeTier} bps pool`} ` +
        `=> ~$${r.annualisedUsd.toFixed(0)}/yr market-wide (UPPER BOUND on any one depositor)`
    );
  }

  const misses: string[] = [];
  if (!r.route || (!r.route.best && !r.route.noSwapRequired)) {
    const deployed = r.route?.deployedPools ?? [];
    misses.push(
      deployed.length === 0
        ? 'no direct Uniswap V3 reward/USDC pool is deployed at any checked fee tier'
        : `${deployed.length} direct reward/USDC pool(s) deployed but all hold zero in-range liquidity ` +
          `(${deployed.map((d) => `${d.pool}@${d.feeTier}bps`).join(', ')})`
    );
    if (r.route?.via) {
      const { token, legA, legB } = r.route.via;
      misses.push(
        legA && legB
          ? `a two-hop route via ${token} DOES have liquidity (${legA.pool}@${legA.feeTier}bps -> ${legB.pool}@${legB.feeTier}bps); ` +
            'materiality here is judged on direct routes only'
          : `no two-hop route via ${token} either`
      );
    }
  }
  if (r.fundedDays !== null && r.fundedDays < minFundedDays) {
    misses.push(`funded for only ${r.fundedDays.toFixed(2)}d < ${minFundedDays}d`);
  }
  if (r.annualisedUsd === null) misses.push('unpriceable: no spot route to value the emission');
  else if (r.annualisedUsd < minAnnualUsd) {
    misses.push(`$${r.annualisedUsd.toFixed(0)}/yr < the $${minAnnualUsd} materiality floor`);
  }
  if (!r.feed?.usableForToken) {
    misses.push(`no usable Chainlink reward/USD feed (${r.feed?.note ?? 'no feed probed'}) - §9.2 would admit zero`);
  }

  if (misses.length === 0) {
    r.verdict = 'MATERIAL';
    say('emitting, in horizon, funded, priceable and above the materiality floor');
  } else {
    r.verdict = 'IMMATERIAL';
    for (const m of misses) say(m);
  }
}

// --- output -----------------------------------------------------------------

function print(r: VenueReport): void {
  console.log(`─── ${r.venue} ${'─'.repeat(Math.max(0, 56 - r.venue.length))}`);
  console.log(`  controller        ${r.controller ?? 'n/a'}`);
  if (r.controllerNote) console.log(`                    ${r.controllerNote}`);
  console.log(`  reward token      ${r.rewardSymbol ?? '?'} ${r.rewardToken ?? 'n/a'}`);
  console.log(`  emission          ${fmtUnits(r.emissionPerSecond, r.rewardDecimals)} /s (market-wide)`);
  console.log(
    `  horizon           ${
      r.distributionEndSeconds === null
        ? 'no end timestamp exposed by the venue'
        : `ends ${new Date(r.distributionEndSeconds * 1000).toISOString()} (${fmtDuration(r.remainingHorizonSeconds)} left)`
    }`
  );
  console.log(
    `  funding           ${fmtUnits(r.fundedAmount, r.rewardDecimals)}` +
      (r.fundedDays === null ? '' : ` (~${r.fundedDays.toFixed(2)}d of emission)`)
  );
  console.log(`                    ${r.fundedSource ?? 'n/a'}`);
  console.log(
    `  uniswap route     ${
      r.route?.noSwapRequired
        ? 'not required - the reward token IS the vault asset (USDC)'
        : r.route?.best
        ? `${r.route.best.pool} fee=${r.route.best.feeTier} liquidity=${r.route.best.liquidity}`
        : r.route && r.route.deployedPools.length
          ? `deployed but EMPTY: ${r.route.deployedPools.map((d) => `${d.pool}@${d.feeTier}bps liq=${d.liquidity}`).join(', ')}`
          : 'no direct reward/USDC pool deployed at fee tiers ' + FEE_TIERS.join('/')
    }`
  );
  if (r.route?.via) {
    const { token, legA, legB } = r.route.via;
    console.log(
      `  two-hop via       ${token}: ` +
        `${legA ? `${legA.pool}@${legA.feeTier}bps` : 'no leg A'} -> ` +
        `${legB ? `${legB.pool}@${legB.feeTier}bps` : 'no leg B'}`
    );
  }
  console.log(
    `  chainlink feed    ${r.feed?.address ?? 'none configured'}` +
      (r.feed?.description ? ` "${r.feed.description}"` : '')
  );
  console.log(`                    ${r.feed?.note ?? ''}`);
  console.log(`  VERDICT           ${r.verdict}`);
  for (const b of r.because) console.log(`                    - ${b}`);
  console.log('');
}

function blocked(reason: string): never {
  console.log('');
  console.log('RESULT: BLOCKED');
  console.log(reason);
  console.log('');
  console.log('This probe reads Base mainnet and invents nothing. To run it, give it a');
  console.log('Base RPC (chain 8453) and re-run - it starts no node and writes no state:');
  console.log('');
  console.log('  cd srcla && BASE_RPC_URL=https://mainnet.base.org pnpm probe:emissions');
  console.log('');
  console.log('or, against a local Anvil fork of Base you bring up yourself:');
  console.log('');
  console.log('  anvil --fork-url https://mainnet.base.org --code-size-limit 100000');
  console.log('  cd srcla && BASE_RPC_URL=http://127.0.0.1:8545 pnpm probe:emissions');
  console.log('');
  console.log('Optionally add COMET_REWARDS_ADDRESS=<CometRewards> to resolve Compound III\'s');
  console.log('reward token and funding (its address is not in contract/DEPLOYMENTS.md).');
  process.exit(2);
}

async function main(): Promise<void> {
  const rpc = arg('rpc') ?? process.env['BASE_RPC_URL'] ?? process.env['RPC_URL'];
  if (!rpc) blocked('No RPC: --rpc, BASE_RPC_URL and RPC_URL are all unset.');

  const minAnnualUsd = Number(arg('min-annual-usd') ?? '1000');
  const minFundedDays = Number(arg('min-funded-days') ?? '7');

  // batchMaxCount: 1 - ethers v6 batches JSON-RPC calls by default and several
  // public Base endpoints reject a batched payload outright. Batched, EVERY read
  // in the batch fails at once, which reads as "the venue emits nothing" rather
  // than as a transport error. One call per request is slower and correct.
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { batchMaxCount: 1 });
  const net = await tryRead(() => provider.getNetwork());
  if (net === null) blocked(`RPC ${rpc} did not respond to eth_chainId.`);
  if (net.chainId !== BASE_CHAIN_ID) {
    blocked(
      `RPC ${rpc} reports chainId ${net.chainId}, not Base's ${BASE_CHAIN_ID}. ` +
        'Refusing to report emission numbers read off the wrong chain.'
    );
  }

  const block = await tryRead(() => provider.getBlock('latest'));
  if (!block) blocked(`RPC ${rpc} answered eth_chainId but not eth_getBlockByNumber.`);
  const nowSeconds = block.timestamp;

  const { path: routesPath, byToken: routes } = loadRouteConfig();

  const reports: VenueReport[] = [
    ...(await probeAave(provider, nowSeconds, routes)),
    await probeCompound(provider, nowSeconds, routes),
    ...(await probeMoonwell(provider, nowSeconds, routes)),
  ];
  for (const r of reports) decide(r, minAnnualUsd, minFundedDays);

  if (hasFlag('json')) {
    console.log(
      JSON.stringify(
        { rpc, chainId: Number(net.chainId), block: block.number, timestamp: nowSeconds, reports },
        (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
        2
      )
    );
    return;
  }

  console.log('');
  console.log('SRCLA emission probe - Base mainnet reward emissions at the three venues');
  console.log(`  rpc              ${rpc}`);
  console.log(`  block            ${block.number} @ ${new Date(nowSeconds * 1000).toISOString()}`);
  console.log(`  addresses from   contract/DEPLOYMENTS.md (Base mainnet table)`);
  console.log(`  route config     ${routesPath}`);
  console.log(`  thresholds       MATERIAL needs >= $${minAnnualUsd}/yr and >= ${minFundedDays}d of funding`);
  console.log('');
  for (const r of reports) print(r);

  const counts = reports.reduce<Record<Verdict, number>>(
    (acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }),
    { MATERIAL: 0, IMMATERIAL: 0, NONE: 0, UNKNOWN: 0 }
  );
  console.log(
    `RESULT: ${counts.MATERIAL} MATERIAL, ${counts.IMMATERIAL} IMMATERIAL, ` +
      `${counts.NONE} NONE, ${counts.UNKNOWN} UNKNOWN across ${reports.length} reward streams`
  );
  console.log(
    'Emission rates are market-wide upper bounds, priced at Uniswap V3 spot - not a vault income ' +
      'forecast, and not an admissible §9.2 valuation source.'
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
