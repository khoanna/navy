/**
 * Typed ABI fragments for every contract the collector reads, plus the pure
 * arithmetic that turns raw venue state into the WAD-scaled figures
 * `StrategySnapshot` carries.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this module, `snapshot-collector.ts` hand-rolled its calldata as
 * `ethers.id(fnName + '()').slice(0, 10)` — it *stripped the argument list*
 * from the signature it was given. That is correct only for zero-argument
 * functions. For every argument-taking read it produced the selector of a
 * function that does not exist (`routes()` instead of `routes(bytes32)`,
 * `strategyAssets()` instead of `strategyAssets(address)`,
 * `getDependencyGroup()` instead of `getDependencyGroup(bytes32)`) and sent
 * no calldata at all. Those calls reverted, the reverts were swallowed by
 * `catch`, and dependency-group exposure read `0n` in every snapshot ever
 * collected. Return values were then sliced positionally out of the raw hex,
 * which is how srcla came to read `Route` index 11 (`upperBound`) as if it
 * were `routeDigest` (index 13 in the current layout).
 *
 * Everything here is therefore encoded and decoded through `ethers.Interface`
 * and read out BY NAME. A field added to or reordered inside a struct can no
 * longer silently change what srcla thinks it is reading; a signature that no
 * longer exists fails loudly at decode time instead of returning a plausible
 * number.
 *
 * PROVENANCE — every fragment below was transcribed from contract/ source or
 * from its compiled artifact, not from memory:
 *   IStrategyAdapter        contract/src/interfaces/IStrategyAdapter.sol
 *   CompoundAdapter         contract/src/adapters/CompoundAdapter.sol
 *   AaveV3Adapter           contract/src/adapters/AaveV3Adapter.sol
 *   MoonwellAdapter         contract/src/adapters/MoonwellAdapter.sol
 *   IComet / IMToken /
 *   IAaveV3Pool             contract/src/interfaces/{IComet,IMToken,IAaveV3}.sol
 *   NavyVaultSRCLA          contract/src/NavyVaultSRCLA.sol
 *   RewardExecutor          contract/src/reward/RewardExecutor.sol
 *   RewardAccountant        contract/src/reward/RewardAccountant.sol
 *
 * REMOVED 2026-09-08: `src/chain/abis/{vault,reward-accountant,reward-executor}.json`.
 * All three were imported by nothing in this package — every interface here is
 * built from the string fragments below — and `reward-executor.json` had
 * already drifted from the deployed contract: its `routes(bytes32)` getter
 * declared 12 outputs where `IRewardExecutor.Route` has 14 non-array fields
 * (`maxRewardFeedAge` and `maxUsdcFeedAge` were added). A stale ABI sitting
 * next to a live one is a positional-decoding bug waiting to be reintroduced.
 * Read route data through `REWARD_EXECUTOR_IFACE.getRoute` below, which
 * returns the whole named struct and cannot drift positionally.
 */
import { ethers } from 'ethers';

/** 1e18, the fixed-point scale used for `supplyRateWad` / `utilizationWad`. */
export const WAD = 10n ** 18n;

/**
 * Strategy adapters. The first five fragments are `IStrategyAdapter` plus
 * `supplyRatePerYear()`, which all three adapters implement identically
 * (WAD-scaled, annualized); the rest are the venue handles each concrete
 * adapter exposes so the collector can reach through to the protocol itself.
 */
export const ADAPTER_IFACE = new ethers.Interface([
  // IStrategyAdapter (contract/src/interfaces/IStrategyAdapter.sol)
  'function totalAssets() view returns (uint256)',
  'function maxWithdrawable() view returns (uint256)',
  'function maxDeployable() view returns (uint256)',
  'function configurationDigest() view returns (bytes32)',
  // CompoundAdapter.sol:98 / AaveV3Adapter.sol:96 / MoonwellAdapter.sol:136 —
  // "Annualized supply rate (APY) as 1e18-scaled integer".
  'function supplyRatePerYear() view returns (uint256)',
  // CompoundAdapter.sol:25 `IComet public immutable comet`
  'function comet() view returns (address)',
  // AaveV3Adapter.sol:108,113
  'function aToken() view returns (address)',
  'function aavePool() view returns (address)',
  // MoonwellAdapter.sol:151,156
  'function mToken() view returns (address)',
  'function isMintPaused() view returns (bool)',
]);

/** Compound III Comet (contract/src/interfaces/IComet.sol). */
export const COMET_IFACE = new ethers.Interface([
  // Comet's utilization is already WAD-scaled (CompoundAdapter feeds it
  // straight into getSupplyRate, which returns a 1e18 per-second rate).
  'function getUtilization() view returns (uint256)',
  'function isSupplyPaused() view returns (bool)',
  // The SUPPLY-side rate model (paper §6.4). These four getters are what
  // `Comet.getSupplyRate(utilization)` is built from, and they are DISTINCT
  // from the borrow-side ones — Comet's supply curve is already net of
  // reserves, which is why nothing here reads a reserve factor.
  // Same fragments the archive backfill reads (collector/archive/calls.ts);
  // all four are PER-SECOND at WAD scale and are annualized at the read site.
  'function supplyKink() view returns (uint256)',
  'function supplyPerSecondInterestRateBase() view returns (uint256)',
  'function supplyPerSecondInterestRateSlopeLow() view returns (uint256)',
  'function supplyPerSecondInterestRateSlopeHigh() view returns (uint256)',
]);

/** Moonwell mToken (contract/src/interfaces/IMToken.sol). */
export const MTOKEN_IFACE = new ethers.Interface([
  'function getCash() view returns (uint256)',
  'function totalBorrows() view returns (uint256)',
  'function totalReserves() view returns (uint256)',
  // The rate model behind the mToken, and the reserve cut that turns its
  // BORROW curve into the supply rate (paper §6.5). `interestRateModel()` is
  // NOT constant over time — Base mUSDC's model has been redeployed by
  // governance repeatedly — so it is resolved per read, never pinned.
  'function interestRateModel() view returns (address)',
  'function reserveFactorMantissa() view returns (uint256)',
]);

/**
 * Moonwell's `JumpRateModel`. A Compound-v2 shape: these coefficients are a
 * BORROW curve, PER TIMESTAMP (i.e. per second on Base), and the supply rate
 * is `borrow(u) * u * (1 - reserveFactor)`. Same fragments the archive
 * backfill reads (collector/archive/calls.ts).
 */
export const MOONWELL_IRM_IFACE = new ethers.Interface([
  'function kink() view returns (uint256)',
  'function baseRatePerTimestamp() view returns (uint256)',
  'function multiplierPerTimestamp() view returns (uint256)',
  'function jumpMultiplierPerTimestamp() view returns (uint256)',
]);

/**
 * Aave V3's rate strategy, V3.2 shape: one packed getter in bps.
 * `optimalUsageRatio` is bps of the usage ratio; the three rate fields are
 * bps of an annual rate. Tried FIRST; V3.0's individual getters below are the
 * fallback. Same versioning the archive backfill handles.
 */
export const AAVE_STRATEGY_V32_IFACE = new ethers.Interface([
  'function getInterestRateDataBps(address reserve) view returns (tuple(uint16 optimalUsageRatio,uint32 baseVariableBorrowRate,uint32 variableRateSlope1,uint32 variableRateSlope2))',
]);

/** Aave V3's rate strategy, V3.0 shape: individual RAY-scaled getters. */
export const AAVE_STRATEGY_V30_IFACE = new ethers.Interface([
  'function OPTIMAL_USAGE_RATIO() view returns (uint256)',
  'function getBaseVariableBorrowRate() view returns (uint256)',
  'function getVariableRateSlope1() view returns (uint256)',
  'function getVariableRateSlope2() view returns (uint256)',
]);

/** The minimal ERC-20 surface needed to measure protocol-held cash. */
export const ERC20_IFACE = new ethers.Interface([
  'function balanceOf(address account) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]);

/**
 * Aave V3 Pool. The tuple is `IAaveV3Pool.ReserveData` verbatim
 * (contract/src/interfaces/IAaveV3.sol:20-36), including the nested
 * `ReserveConfigurationMap { uint256 data }`.
 */
export const AAVE_POOL_IFACE = new ethers.Interface([
  'function getReserveData(address asset) view returns (' +
    'tuple(' +
    'tuple(uint256 data) configuration,' +
    'uint128 liquidityIndex,' +
    'uint128 currentLiquidityRate,' +
    'uint128 variableBorrowIndex,' +
    'uint128 currentVariableBorrowRate,' +
    'uint128 currentStableBorrowRate,' +
    'uint40 lastUpdateTimestamp,' +
    'uint16 id,' +
    'address aTokenAddress,' +
    'address stableDebtTokenAddress,' +
    'address variableDebtTokenAddress,' +
    'address interestRateStrategyAddress,' +
    'uint128 accruedToTreasury,' +
    'uint128 unbacked,' +
    'uint128 isolationModeTotalDebt' +
    ') data)',
]);

/** NavyVaultSRCLA (contract/src/NavyVaultSRCLA.sol). */
export const VAULT_IFACE = new ethers.Interface([
  'function totalAssets() view returns (uint256)',
  'function synchronousLiquidity() view returns (uint256)',
  'function minIdleBps() view returns (uint256)',
  'function paused() view returns (bool)',
  'function adminReserve() view returns (uint256)',
  'function dynamicReserve() view returns (uint256)',
  // NavyVaultSRCLA.sol:163 `mapping(address => uint256) public strategyAssets`
  'function strategyAssets(address adapter) view returns (uint256)',
  // NavyVaultSRCLA.sol:492
  'function getDependencyGroup(bytes32 groupId) view returns (uint16 capBps, uint256 absoluteCap, address[] members)',
  // Absolute-cap getters are NOT on NavyVaultSRCLA; they are probed
  // optionally by the collector and are expected to revert there.
  'function absoluteTotalCap() view returns (uint256)',
  'function absolutePerUserCap() view returns (uint256)',
  'function minDeposit() view returns (uint256)',
]);

/** RewardAccountant (contract/src/reward/RewardAccountant.sol). */
export const REWARD_ACCOUNTANT_IFACE = new ethers.Interface([
  'function lastRefreshTime() view returns (uint256)',
  'function cachedRewardAssets() view returns (uint256)',
  'function issuanceReady() view returns (bool)',
  'function configurationDigest() view returns (bytes32)',
  'function tokenCache(address token) view returns (uint256 value, uint256 lastUpdated, bool isMaterial)',
]);

/**
 * RewardExecutor (contract/src/reward/RewardExecutor.sol:398-407).
 *
 * `getRoute` — not the auto-generated `routes` getter — is what the collector
 * uses: it returns the whole `Route` struct including its dynamic arrays, with
 * every field named, so `routeDigest` is read as `route.routeDigest` rather
 * than as word 11 or word 13 of an unlabelled tuple.
 */
export const REWARD_EXECUTOR_IFACE = new ethers.Interface([
  'function getRouteIds() view returns (bytes32[])',
  'function isRouteApproved(bytes32 routeId) view returns (bool)',
  'function getRoute(bytes32 routeId) view returns (' +
    'tuple(' +
    'address inputToken,' +
    'address outputToken,' +
    'address[] path,' +
    'uint24[] fees,' +
    'address[] pools,' +
    'address rewardFeed,' +
    'address usdcFeed,' +
    'uint256 maxRewardFeedAge,' +
    'uint256 maxUsdcFeedAge,' +
    'uint256 maxInput,' +
    'uint256 minOutputBps,' +
    'uint256 maxPriceImpactBps,' +
    'uint256 maxDailyNotional,' +
    'uint256 lowerBound,' +
    'uint256 upperBound,' +
    'bytes32 activationBlockHash,' +
    'bytes32 routeDigest' +
    ') route)',
]);

/**
 * NavyVaultSRCLA inherits OpenZeppelin ERC4626, which emits
 * `Withdraw(address indexed sender, address indexed receiver,
 *           address indexed owner, uint256 assets, uint256 shares)`.
 *
 * srcla previously filtered on `Withdrawal(address,uint256,uint256)` — an
 * event that exists nowhere in contract/src — so the filter matched zero logs
 * forever and the paper's §8.1 withdrawal-demand quantile `Q_beta(W_H)` was
 * identically zero. Verified against contract/lib/openzeppelin-contracts/
 * contracts/interfaces/IERC4626.sol:16.
 */
export const VAULT_EVENTS_IFACE = new ethers.Interface([
  'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
]);

/** topic0 for the ERC-4626 `Withdraw` event the vault actually emits. */
export const WITHDRAW_TOPIC: string = VAULT_EVENTS_IFACE.getEvent('Withdraw')!.topicHash;

/**
 * Utilization = borrows / (cash + borrows - reserves), WAD-scaled.
 *
 * This is the Compound-V2/Moonwell definition (the same denominator
 * `IMInterestRateModel.getSupplyRate(cash, borrows, reserves, ...)` uses) and,
 * with `reserves = 0`, it is also Aave V3's `totalDebt / (availableLiquidity +
 * totalDebt)`. One definition is used for every venue so that the persisted
 * `utilizationE18` is comparable across markets and consistent with the
 * `cash` / `borrows` / `reserves` triple persisted alongside it.
 *
 * Returns 0 for an idle market, and 0 rather than underflowing if reserves
 * ever exceed cash + borrows.
 *
 * DELIBERATELY NOT CLAMPED TO 1 WAD. When a market is drained to zero cash and
 * still holds reserves the denominator is smaller than the numerator and the
 * result exceeds 1e18 — that is what the venues' own interest-rate models
 * compute, and it is a live state, not a hypothetical: on Base at block
 * 51,028,435 Moonwell mUSDC reported getCash()=0, totalBorrows()=9,904,753.55
 * USDC and totalReserves()=55,931.68 USDC, i.e. 1.005679022644646337 WAD. Clamping would hide
 * the most stressed venue state there is behind an ordinary full-utilization
 * reading.
 */
export function utilizationWad(cash: bigint, borrows: bigint, reserves: bigint): bigint {
  if (borrows <= 0n) return 0n;
  const supplied = cash + borrows;
  if (reserves >= supplied) return 0n;
  return (borrows * WAD) / (supplied - reserves);
}

/**
 * Compound III reports utilization directly, and defines it as
 * `totalBorrow * 1e18 / totalSupply` over present values -- the same
 * `totalSupply()` the Comet exposes. Inverting that identity recovers the
 * borrow total without needing `totalsBasic()`'s index arithmetic.
 */
export function cometBorrowsFromUtilization(totalSupply: bigint, utilization: bigint): bigint {
  if (totalSupply <= 0n || utilization <= 0n) return 0n;
  return (totalSupply * utilization) / WAD;
}

/** Decoded Aave reserve-configuration flags. */
export interface AaveReserveFlags {
  active: boolean;
  frozen: boolean;
  paused: boolean;
  /**
   * The reserve factor, bps — bits 64-79 of the same word. It is a
   * multiplicative term in Aave's borrow -> supply conversion, so it is part
   * of the rate model rather than a flag; it rides here because it lives in
   * the same packed configuration word the flags do.
   */
  reserveFactorBps: number;
}

/**
 * Bit positions in `ReserveConfigurationMap.data`, transcribed from
 * AaveV3Adapter.sol:130-133 (`maxDeployable`), which is the deployed
 * adapter's own reading of the same word:
 *   bit 56 = active, bit 57 = frozen, bit 60 = paused,
 *   bits 64-79 = the reserve factor in bps.
 */
export function decodeAaveReserveFlags(configData: bigint): AaveReserveFlags {
  return {
    active: ((configData >> 56n) & 1n) !== 0n,
    frozen: ((configData >> 57n) & 1n) !== 0n,
    paused: ((configData >> 60n) & 1n) !== 0n,
    // Bits 64-79, the same field `collector/archive/calls.ts` decodes.
    reserveFactorBps: Number((configData >> 64n) & 0xffffn),
  };
}

/**
 * "Can this venue accept a deposit right now?" — the collector's `paused`
 * flag for Aave. Frozen and inactive reserves reject `supply()` exactly as a
 * paused one does, and AaveV3Adapter.maxDeployable treats all three
 * identically, so all three are reported as paused.
 */
export function aaveReserveIsBlocked(flags: AaveReserveFlags): boolean {
  return !flags.active || flags.frozen || flags.paused;
}
