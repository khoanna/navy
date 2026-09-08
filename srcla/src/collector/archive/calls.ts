/**
 * One Multicall3 batch per historical origin, and the pure decoders for it.
 *
 * WHY THIS EXISTS RATHER THAN A `blockNumber` PARAMETER ON `SnapshotCollector`:
 * the live collector reads venue state THROUGH the deployed Navy adapters
 * (`ADAPTER_IFACE`, `comet()`, `aToken()`, `mToken()`, `supplyRatePerYear()`).
 * Those adapters exist only on the Anvil fork; they have no Base mainnet
 * history, so at any archive block their calls revert. A backfill must read
 * Comet, the Aave Pool and the mToken DIRECTLY. This is the single most
 * important structural fact in the dataset work.
 *
 * Everything below was verified on Base at blocks 19_300_000 (2024-09-03) and
 * 35_338_178 (2025-09-10). Two shapes differ between those blocks and a
 * decoder that assumes either one silently corrupts half the window:
 *
 *   - Moonwell's `interestRateModel()` was 0x54dC..2445 at the first and
 *     0x0F70..6cab at the second, so the model address must be re-resolved
 *     per chunk and RECORDED on the row.
 *   - Aave's rate strategy is versioned. `getInterestRateDataBps(asset)` is
 *     the V3.2 shape (observed 9000,0,650,6000 and 9000,175,625,4000); the
 *     V3.0 getters are the fallback. Where BOTH fail the IRM is `null` -- a
 *     disclosed gap, never `DEFAULT_AAVE_CONFIG` silently substituted.
 *
 * PURE: `buildOriginCalls` and `decodeOrigin` perform no I/O and read no
 * clock. `resolveAddresses` is the only function here that touches the chain.
 *
 * UNITS: money is bigint USDC base units (6 dp); rates are WAD (1e18)
 * ANNUALIZED after conversion; Aave reports RAY (1e27) per year; Compound and
 * Moonwell report WAD PER SECOND and are annualized here.
 */
import { Interface, type Result } from 'ethers';
import type { RpcPool } from './endpoints.js';

/** Matches src/protocols/math.ts and evaluation/replay.ts (365.25 days). */
const SECONDS_PER_YEAR = 31_557_600n;
const WAD = 10n ** 18n;
const RAY = 10n ** 27n;

/**
 * Base mainnet, verified on-chain. Do NOT copy from memory, and do NOT copy
 * from `contract/DEPLOYMENTS.md`'s retired Ethereum Sepolia section -- those
 * addresses are dead.
 */
export const BASE = {
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  comet: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
  aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  mToken: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  /** OP-Stack GasPriceOracle predeploy. */
  gasOracle: '0x420000000000000000000000000000000000000F',
  ethUsdFeed: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  usdcUsdFeed: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
} as const;

/**
 * The registered market ids.
 *
 * They MUST contain 'aave' / 'compound' / 'moonwell': `src/domain/protocol.ts`
 * classifies by substring and THROWS otherwise, and `simulateCurves` selects a
 * whole rate model off that classification. They also match
 * `config/evaluation-manifest.json`'s `markets[].marketId`.
 */
export const MARKET_IDS = {
  aave: 'aave-v3-usdc',
  compound: 'compound-v3-usdc',
  moonwell: 'moonwell-usdc',
} as const;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

const MULTICALL3_IFACE = new Interface([
  'function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) view returns (tuple(bool success,bytes returnData)[] returnData)',
  'function getBlockNumber() view returns (uint256)',
  'function getCurrentBlockTimestamp() view returns (uint256)',
  'function getBlockHash(uint256 blockNumber) view returns (bytes32)',
]);

const COMET_IFACE = new Interface([
  'function getUtilization() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function isSupplyPaused() view returns (bool)',
  'function supplyKink() view returns (uint256)',
  'function supplyPerSecondInterestRateBase() view returns (uint256)',
  'function supplyPerSecondInterestRateSlopeLow() view returns (uint256)',
  'function supplyPerSecondInterestRateSlopeHigh() view returns (uint256)',
  'function totalsBasic() view returns (tuple(uint104 totalSupplyBase,uint104 totalBorrowBase,uint64 baseSupplyIndex,uint64 baseBorrowIndex,uint64 trackingSupplyIndex,uint64 trackingBorrowIndex,uint40 lastAccrualTime,uint8 pauseFlags))',
  'function baseTrackingSupplySpeed() view returns (uint256)',
]);

const AAVE_POOL_IFACE = new Interface([
  'function getReserveData(address asset) view returns (tuple(tuple(uint256 data) configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))',
  'function getVirtualUnderlyingBalance(address asset) view returns (uint128)',
]);

const AAVE_STRATEGY_V32_IFACE = new Interface([
  'function getInterestRateDataBps(address reserve) view returns (tuple(uint16 optimalUsageRatio,uint32 baseVariableBorrowRate,uint32 variableRateSlope1,uint32 variableRateSlope2))',
]);

const AAVE_STRATEGY_V30_IFACE = new Interface([
  'function OPTIMAL_USAGE_RATIO() view returns (uint256)',
  'function getBaseVariableBorrowRate() view returns (uint256)',
  'function getVariableRateSlope1() view returns (uint256)',
  'function getVariableRateSlope2() view returns (uint256)',
  'function MAX_EXCESS_USAGE_RATIO() view returns (uint256)',
]);

const MTOKEN_IFACE = new Interface([
  'function getCash() view returns (uint256)',
  'function totalBorrows() view returns (uint256)',
  'function totalReserves() view returns (uint256)',
  'function supplyRatePerTimestamp() view returns (uint256)',
  'function exchangeRateStored() view returns (uint256)',
  'function reserveFactorMantissa() view returns (uint256)',
  'function interestRateModel() view returns (address)',
  'function comptroller() view returns (address)',
]);

const MOONWELL_IRM_IFACE = new Interface([
  'function kink() view returns (uint256)',
  'function baseRatePerTimestamp() view returns (uint256)',
  'function multiplierPerTimestamp() view returns (uint256)',
  'function jumpMultiplierPerTimestamp() view returns (uint256)',
  'function timestampsPerYear() view returns (uint256)',
]);

const COMPTROLLER_IFACE = new Interface([
  'function mintGuardianPaused(address mToken) view returns (bool)',
]);

const ERC20_IFACE = new Interface([
  'function balanceOf(address account) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]);

const GAS_ORACLE_IFACE = new Interface([
  'function l1BaseFee() view returns (uint256)',
  'function blobBaseFee() view returns (uint256)',
  'function baseFeeScalar() view returns (uint32)',
  'function blobBaseFeeScalar() view returns (uint32)',
]);

const CHAINLINK_IFACE = new Interface([
  'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Multicall3Call {
  target: string;
  allowFailure: boolean;
  callData: string;
  /** Stable label, so `decodeOrigin` addresses legs by name rather than by a
   *  positional index a later edit would silently shift. */
  key: string;
}

export interface Multicall3Result {
  success: boolean;
  returnData: string;
}

export interface ArchiveAddresses {
  comet: string;
  aavePool: string;
  aaveAToken: string;
  aaveVariableDebt: string;
  aaveStrategy: string;
  mToken: string;
  mComptroller: string;
  mInterestRateModel: string;
  usdc: string;
  multicall3: string;
  gasOracle: string;
  ethUsdFeed: string;
  usdcUsdFeed: string;
}

/** Kinked-linear IRM parameters, normalised across protocols. */
export interface IrmReading {
  /** Address of the model that produced these. */
  address: string;
  /** Annualized base rate at zero utilization, WAD. */
  baseRateWad: bigint;
  /** Kink / optimal utilization, RAY. */
  kinkRay: bigint;
  /** Annualized slope below the kink, WAD. */
  slopeLowWad: bigint;
  /** Annualized slope above the kink, WAD. */
  slopeHighWad: bigint;
  /** Aave's quadratic model only: optimal and max utilization, RAY. */
  optimalUtilizationRay?: bigint;
  maxUtilizationRay?: bigint;
}

export interface VenueReading {
  marketId: string;
  supplyRateE18: bigint;
  utilizationE18: bigint;
  cashBase: bigint;
  borrowsBase: bigint;
  reservesBase: bigint;
  paused: boolean;
  configDigest: string;
  reserveFactorBps: number | null;
  irm: IrmReading | null;
  /** Raw protocol integers preserved verbatim (paper §10.1). */
  raw: Record<string, string>;
}

export interface CostReading {
  l2BaseFeeWei: bigint;
  l1BaseFeeWei: bigint;
  l1BlobBaseFeeWei: bigint;
  baseFeeScalar: number | null;
  blobBaseFeeScalar: number | null;
  ethUsdE8: bigint;
  usdcUsdE8: bigint;
  ethUsdRoundId: string | null;
  usdcUsdRoundId: string | null;
  ethUsdUpdatedAt: Date | null;
  usdcUsdUpdatedAt: Date | null;
}

export interface OriginReading {
  blockNumber: number;
  blockHash: string;
  timestampSeconds: number;
  markets: VenueReading[];
  cost: CostReading | null;
  /** Call keys that failed. A venue with any failure is OMITTED from
   *  `markets` rather than emitted with zeros. */
  failures: string[];
}

// ---------------------------------------------------------------------------
// Address resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the addresses that are constant within a chunk but NOT across the
 * whole window.
 *
 * Called per resume-chunk rather than once per run: Moonwell's rate model
 * address changed inside the backfill window, and pinning it once would
 * attribute one model's parameters to the other model's blocks.
 */
export async function resolveAddresses(
  pool: RpcPool,
  blockNumber: number,
): Promise<ArchiveAddresses> {
  const call = async (to: string, iface: Interface, fn: string, args: unknown[] = []): Promise<Result> => {
    const data = await pool.call(async (p) =>
      p.call({ to, data: iface.encodeFunctionData(fn, args), blockTag: blockNumber }),
    );
    return iface.decodeFunctionResult(fn, data);
  };

  const reserve = (await call(BASE.aavePool, AAVE_POOL_IFACE, 'getReserveData', [BASE.usdc]))[0] as Result;
  const [irmModel] = await call(BASE.mToken, MTOKEN_IFACE, 'interestRateModel');
  const [comptroller] = await call(BASE.mToken, MTOKEN_IFACE, 'comptroller');

  return {
    comet: BASE.comet,
    aavePool: BASE.aavePool,
    aaveAToken: reserve.getValue('aTokenAddress') as string,
    aaveVariableDebt: reserve.getValue('variableDebtTokenAddress') as string,
    aaveStrategy: reserve.getValue('interestRateStrategyAddress') as string,
    mToken: BASE.mToken,
    mComptroller: comptroller as string,
    mInterestRateModel: irmModel as string,
    usdc: BASE.usdc,
    multicall3: BASE.multicall3,
    gasOracle: BASE.gasOracle,
    ethUsdFeed: BASE.ethUsdFeed,
    usdcUsdFeed: BASE.usdcUsdFeed,
  };
}

// ---------------------------------------------------------------------------
// The batch
// ---------------------------------------------------------------------------

/**
 * Every read one origin needs, as one `aggregate3` argument list.
 *
 * `allowFailure: true` on every leg so a single dead call degrades its venue
 * rather than the whole origin. Multicall3's own helpers supply the header,
 * which is why no separate `eth_getBlockByNumber` is issued.
 *
 * NOT in the batch: Comet's `getSupplyRate(utilization)`, because it needs
 * the utilization this same batch is fetching. The supply rate is computed
 * from the decoded IRM parameters instead -- the same arithmetic the adapter
 * performs -- which keeps the origin to one round trip.
 */
export function buildOriginCalls(addr: ArchiveAddresses, blockNumber: number): Multicall3Call[] {
  const mc = (fn: string, args: unknown[] = []): string => MULTICALL3_IFACE.encodeFunctionData(fn, args);
  const call = (key: string, target: string, iface: Interface, fn: string, args: unknown[] = []): Multicall3Call => ({
    key,
    target,
    allowFailure: true,
    callData: iface.encodeFunctionData(fn, args),
  });

  return [
    // Header. getBlockHash(n) reverts for the block being executed, so the
    // PARENT hash is taken and the origin's own hash is derived by the caller
    // from the block it resolved.
    { key: 'header.timestamp', target: addr.multicall3, allowFailure: false, callData: mc('getCurrentBlockTimestamp') },
    { key: 'header.number', target: addr.multicall3, allowFailure: false, callData: mc('getBlockNumber') },
    { key: 'header.parentHash', target: addr.multicall3, allowFailure: true, callData: mc('getBlockHash', [blockNumber - 1]) },
    // NOTE: multicall3's getBasefee() is deliberately NOT requested. Under
    // eth_call on OP-Stack the BASEFEE opcode reads 0 -- it returned 0 at both
    // probe blocks while their headers carried 3_869_277 and 714_160 wei -- so
    // the L2 base fee is taken from the resolved header instead. Asking for it
    // here would put a plausible zero next to a real value.

    // Compound III
    call('compound.utilization', addr.comet, COMET_IFACE, 'getUtilization'),
    call('compound.totalSupply', addr.comet, COMET_IFACE, 'totalSupply'),
    call('compound.paused', addr.comet, COMET_IFACE, 'isSupplyPaused'),
    call('compound.totalsBasic', addr.comet, COMET_IFACE, 'totalsBasic'),
    call('compound.cash', addr.usdc, ERC20_IFACE, 'balanceOf', [addr.comet]),
    call('compound.kink', addr.comet, COMET_IFACE, 'supplyKink'),
    call('compound.rateBase', addr.comet, COMET_IFACE, 'supplyPerSecondInterestRateBase'),
    call('compound.slopeLow', addr.comet, COMET_IFACE, 'supplyPerSecondInterestRateSlopeLow'),
    call('compound.slopeHigh', addr.comet, COMET_IFACE, 'supplyPerSecondInterestRateSlopeHigh'),

    // Aave V3
    call('aave.reserveData', addr.aavePool, AAVE_POOL_IFACE, 'getReserveData', [addr.usdc]),
    call('aave.cash', addr.usdc, ERC20_IFACE, 'balanceOf', [addr.aaveAToken]),
    call('aave.virtualBalance', addr.aavePool, AAVE_POOL_IFACE, 'getVirtualUnderlyingBalance', [addr.usdc]),
    call('aave.debt', addr.aaveVariableDebt, ERC20_IFACE, 'totalSupply'),
    call('aave.irmV32', addr.aaveStrategy, AAVE_STRATEGY_V32_IFACE, 'getInterestRateDataBps', [addr.usdc]),
    call('aave.irmV30.optimal', addr.aaveStrategy, AAVE_STRATEGY_V30_IFACE, 'OPTIMAL_USAGE_RATIO'),
    call('aave.irmV30.base', addr.aaveStrategy, AAVE_STRATEGY_V30_IFACE, 'getBaseVariableBorrowRate'),
    call('aave.irmV30.slope1', addr.aaveStrategy, AAVE_STRATEGY_V30_IFACE, 'getVariableRateSlope1'),
    call('aave.irmV30.slope2', addr.aaveStrategy, AAVE_STRATEGY_V30_IFACE, 'getVariableRateSlope2'),
    call('aave.irmV30.maxExcess', addr.aaveStrategy, AAVE_STRATEGY_V30_IFACE, 'MAX_EXCESS_USAGE_RATIO'),

    // Moonwell
    call('moonwell.cash', addr.mToken, MTOKEN_IFACE, 'getCash'),
    call('moonwell.borrows', addr.mToken, MTOKEN_IFACE, 'totalBorrows'),
    call('moonwell.reserves', addr.mToken, MTOKEN_IFACE, 'totalReserves'),
    call('moonwell.supplyRate', addr.mToken, MTOKEN_IFACE, 'supplyRatePerTimestamp'),
    call('moonwell.exchangeRate', addr.mToken, MTOKEN_IFACE, 'exchangeRateStored'),
    call('moonwell.reserveFactor', addr.mToken, MTOKEN_IFACE, 'reserveFactorMantissa'),
    call('moonwell.paused', addr.mComptroller, COMPTROLLER_IFACE, 'mintGuardianPaused', [addr.mToken]),
    call('moonwell.kink', addr.mInterestRateModel, MOONWELL_IRM_IFACE, 'kink'),
    call('moonwell.baseRate', addr.mInterestRateModel, MOONWELL_IRM_IFACE, 'baseRatePerTimestamp'),
    call('moonwell.multiplier', addr.mInterestRateModel, MOONWELL_IRM_IFACE, 'multiplierPerTimestamp'),
    call('moonwell.jumpMultiplier', addr.mInterestRateModel, MOONWELL_IRM_IFACE, 'jumpMultiplierPerTimestamp'),

    // Execution cost inputs (paper §9.1)
    call('cost.l1BaseFee', addr.gasOracle, GAS_ORACLE_IFACE, 'l1BaseFee'),
    call('cost.blobBaseFee', addr.gasOracle, GAS_ORACLE_IFACE, 'blobBaseFee'),
    call('cost.baseFeeScalar', addr.gasOracle, GAS_ORACLE_IFACE, 'baseFeeScalar'),
    call('cost.blobBaseFeeScalar', addr.gasOracle, GAS_ORACLE_IFACE, 'blobBaseFeeScalar'),
    call('cost.ethUsd', addr.ethUsdFeed, CHAINLINK_IFACE, 'latestRoundData'),
    call('cost.usdcUsd', addr.usdcUsdFeed, CHAINLINK_IFACE, 'latestRoundData'),
  ];
}

/** ABI-encode the `aggregate3` call for a prepared batch. */
export function encodeAggregate3(calls: readonly Multicall3Call[]): string {
  return MULTICALL3_IFACE.encodeFunctionData('aggregate3', [
    calls.map((c) => ({ target: c.target, allowFailure: c.allowFailure, callData: c.callData })),
  ]);
}

/** Decode an `aggregate3` return into positional results. */
export function decodeAggregate3(returnData: string): Multicall3Result[] {
  const [rows] = MULTICALL3_IFACE.decodeFunctionResult('aggregate3', returnData);
  return (rows as Result).map((r: Result) => ({
    success: r.getValue('success') as boolean,
    returnData: r.getValue('returnData') as string,
  }));
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** Utilization as a WAD fraction of (cash + borrows - reserves). */
export function utilizationWad(cash: bigint, borrows: bigint, reserves: bigint): bigint {
  const supplied = cash + borrows - reserves;
  if (supplied <= 0n) return 0n;
  return (borrows * WAD) / supplied;
}

/**
 * Decode one origin's batch.
 *
 * A venue with ANY failed leg is omitted from `markets` and named in
 * `failures`. It is never emitted with substituted zeros: a zero supply rate
 * is indistinguishable from a real one downstream, and `deriveCompletedLabels`
 * would average it into a realized return.
 */
export function decodeOrigin(
  addr: ArchiveAddresses,
  calls: readonly Multicall3Call[],
  results: readonly Multicall3Result[],
  fallback: {
    blockNumber: number;
    timestampSeconds: number;
    blockHash: string;
    /** From the HEADER. See ResolvedBlock.baseFeePerGasWei: multicall3's
     *  getBasefee() reads zero under eth_call on OP-Stack. */
    baseFeePerGasWei: bigint;
  },
): OriginReading {
  if (calls.length !== results.length) {
    throw new Error(`aggregate3 returned ${results.length} results for ${calls.length} calls`);
  }

  const byKey = new Map<string, Multicall3Result>();
  calls.forEach((c, i) => byKey.set(c.key, results[i]!));
  const failures: string[] = [];

  const decode = (key: string, iface: Interface, fn: string): Result | null => {
    const r = byKey.get(key);
    if (r === undefined || !r.success || r.returnData === '0x') {
      failures.push(key);
      return null;
    }
    try {
      return iface.decodeFunctionResult(fn, r.returnData);
    } catch {
      failures.push(key);
      return null;
    }
  };
  const uint = (key: string, iface: Interface, fn: string): bigint | null => {
    const d = decode(key, iface, fn);
    return d === null ? null : (d[0] as bigint);
  };
  const bool = (key: string, iface: Interface, fn: string): boolean | null => {
    const d = decode(key, iface, fn);
    return d === null ? null : (d[0] as boolean);
  };

  const markets: VenueReading[] = [];

  // -- Compound III ---------------------------------------------------------
  {
    const before = failures.length;
    const utilization = uint('compound.utilization', COMET_IFACE, 'getUtilization');
    const totalSupply = uint('compound.totalSupply', COMET_IFACE, 'totalSupply');
    const paused = bool('compound.paused', COMET_IFACE, 'isSupplyPaused');
    const cash = uint('compound.cash', ERC20_IFACE, 'balanceOf');
    const kink = uint('compound.kink', COMET_IFACE, 'supplyKink');
    const rateBase = uint('compound.rateBase', COMET_IFACE, 'supplyPerSecondInterestRateBase');
    const slopeLow = uint('compound.slopeLow', COMET_IFACE, 'supplyPerSecondInterestRateSlopeLow');
    const slopeHigh = uint('compound.slopeHigh', COMET_IFACE, 'supplyPerSecondInterestRateSlopeHigh');
    const totals = decode('compound.totalsBasic', COMET_IFACE, 'totalsBasic');

    if (failures.length === before && utilization !== null && totalSupply !== null && paused !== null && cash !== null) {
      // Comet reports utilization already WAD-scaled and feeds exactly this
      // value to its own rate model, so it is reported as read rather than
      // recomputed from (cash, borrows).
      const borrows = (totalSupply * utilization) / WAD;
      const irm: IrmReading | null =
        kink !== null && rateBase !== null && slopeLow !== null && slopeHigh !== null
          ? {
              address: addr.comet,
              // Comet's slopes are PER SECOND at WAD scale. Annualizing is
              // not cosmetic: the per-second slopeLow of 1141552511 is
              // 3.60e16 WAD/yr (~3.6%), against DEFAULT_COMPOUND_CONFIG's
              // placeholder 6.25%, and the real kink is 90%, not 80%.
              baseRateWad: rateBase * SECONDS_PER_YEAR,
              kinkRay: kink * 10n ** 9n, // WAD -> RAY
              slopeLowWad: slopeLow * SECONDS_PER_YEAR,
              slopeHighWad: slopeHigh * SECONDS_PER_YEAR,
            }
          : null;

      markets.push({
        marketId: MARKET_IDS.compound,
        // Computed from the PER-SECOND parameters and annualized afterwards,
        // in that order. Annualizing the slopes first and then applying
        // utilization reproduces getSupplyRate only to ~5e-10 relative,
        // because Comet truncates to an integer wei-per-second BEFORE the
        // year scales the error up 31.5 million times. Matching its
        // arithmetic makes the dataset's rate the rate the protocol
        // actually paid.
        supplyRateE18:
          kink === null || rateBase === null || slopeLow === null || slopeHigh === null
            ? 0n
            : cometSupplyRatePerSecond(
                { baseWad: rateBase, kinkWad: kink, slopeLowWad: slopeLow, slopeHighWad: slopeHigh },
                utilization,
              ) * SECONDS_PER_YEAR,
        utilizationE18: utilization,
        cashBase: cash,
        borrowsBase: borrows,
        // Comet's protocol reserves are `getReserves()`, which is not on
        // contract/src/interfaces/IComet.sol. Left at 0 rather than guessed;
        // it is only a subtrahend in the simulator's utilization
        // denominator, where 0 is the conservative choice.
        reservesBase: 0n,
        paused,
        configDigest: configDigestFor('compound', irm, paused),
        reserveFactorBps: null,
        irm,
        raw: {
          cometTotalSupply: totalSupply.toString(),
          ...(totals !== null
            ? {
                cometSupplyBase: (totals[0] as Result).getValue('totalSupplyBase').toString(),
                cometBorrowBase: (totals[0] as Result).getValue('totalBorrowBase').toString(),
                cometBaseSupplyIndex: (totals[0] as Result).getValue('baseSupplyIndex').toString(),
              }
            : {}),
        },
      });
    }
  }

  // -- Aave V3 --------------------------------------------------------------
  {
    const reserveData = decode('aave.reserveData', AAVE_POOL_IFACE, 'getReserveData');
    const cash = uint('aave.cash', ERC20_IFACE, 'balanceOf');
    const debt = uint('aave.debt', ERC20_IFACE, 'totalSupply');
    const virtualBal = uint('aave.virtualBalance', AAVE_POOL_IFACE, 'getVirtualUnderlyingBalance');

    if (reserveData !== null && cash !== null && debt !== null) {
      const reserve = reserveData[0] as Result;
      // currentLiquidityRate is RAY per year; the pipeline is WAD.
      const liquidityRateRay = reserve.getValue('currentLiquidityRate') as bigint;
      const configuration = (reserve.getValue('configuration') as Result).getValue('data') as bigint;
      const flags = decodeAaveConfiguration(configuration);

      const irm = decodeAaveIrm(addr, byKey, failures);

      markets.push({
        marketId: MARKET_IDS.aave,
        supplyRateE18: liquidityRateRay / 10n ** 9n,
        // reserves = 0: Aave's accruedToTreasury is denominated in SCALED
        // aToken units, not underlying, so it is not interchangeable with
        // the Compound-style `reserves` this field means.
        utilizationE18: utilizationWad(cash, debt, 0n),
        cashBase: cash,
        borrowsBase: debt,
        reservesBase: 0n,
        // Frozen and inactive reserves reject supply() exactly as a paused
        // one does; AaveV3Adapter.maxDeployable treats all three alike.
        paused: !flags.active || flags.frozen || flags.paused,
        configDigest: configDigestFor('aave', irm, !flags.active || flags.frozen || flags.paused),
        reserveFactorBps: flags.reserveFactorBps,
        irm,
        raw: {
          aaveLiquidityRateRay: liquidityRateRay.toString(),
          aaveDebtBase: debt.toString(),
          ...(virtualBal !== null ? { aaveVirtualBalBase: virtualBal.toString() } : {}),
          aaveConfiguration: configuration.toString(),
        },
      });
    }
  }

  // -- Moonwell -------------------------------------------------------------
  {
    const before = failures.length;
    const cash = uint('moonwell.cash', MTOKEN_IFACE, 'getCash');
    const borrows = uint('moonwell.borrows', MTOKEN_IFACE, 'totalBorrows');
    const reserves = uint('moonwell.reserves', MTOKEN_IFACE, 'totalReserves');
    const supplyRatePerTs = uint('moonwell.supplyRate', MTOKEN_IFACE, 'supplyRatePerTimestamp');
    const exchangeRate = uint('moonwell.exchangeRate', MTOKEN_IFACE, 'exchangeRateStored');
    const reserveFactor = uint('moonwell.reserveFactor', MTOKEN_IFACE, 'reserveFactorMantissa');
    const paused = bool('moonwell.paused', COMPTROLLER_IFACE, 'mintGuardianPaused');
    const kink = uint('moonwell.kink', MOONWELL_IRM_IFACE, 'kink');
    const baseRate = uint('moonwell.baseRate', MOONWELL_IRM_IFACE, 'baseRatePerTimestamp');
    const multiplier = uint('moonwell.multiplier', MOONWELL_IRM_IFACE, 'multiplierPerTimestamp');
    const jump = uint('moonwell.jumpMultiplier', MOONWELL_IRM_IFACE, 'jumpMultiplierPerTimestamp');

    if (
      failures.length === before &&
      cash !== null && borrows !== null && reserves !== null &&
      supplyRatePerTs !== null && paused !== null
    ) {
      const irm: IrmReading | null =
        kink !== null && baseRate !== null && multiplier !== null && jump !== null
          ? {
              address: addr.mInterestRateModel,
              baseRateWad: baseRate * SECONDS_PER_YEAR,
              kinkRay: kink * 10n ** 9n,
              slopeLowWad: multiplier * SECONDS_PER_YEAR,
              slopeHighWad: jump * SECONDS_PER_YEAR,
            }
          : null;

      markets.push({
        marketId: MARKET_IDS.moonwell,
        // supplyRatePerTimestamp is WAD per second; the pipeline is
        // WAD annualized.
        supplyRateE18: supplyRatePerTs * SECONDS_PER_YEAR,
        utilizationE18: utilizationWad(cash, borrows, reserves),
        cashBase: cash,
        borrowsBase: borrows,
        reservesBase: reserves,
        paused,
        configDigest: configDigestFor('moonwell', irm, paused),
        reserveFactorBps: reserveFactor === null ? null : Number((reserveFactor * 10_000n) / WAD),
        irm,
        raw: {
          mwSupplyRatePerTimestamp: supplyRatePerTs.toString(),
          ...(exchangeRate !== null ? { mwExchangeRate: exchangeRate.toString() } : {}),
        },
      });
    }
  }

  // -- Header and cost ------------------------------------------------------
  const tsRaw = byKey.get('header.timestamp');
  const timestampSeconds =
    tsRaw !== undefined && tsRaw.success
      ? Number((MULTICALL3_IFACE.decodeFunctionResult('getCurrentBlockTimestamp', tsRaw.returnData)[0] as bigint))
      : fallback.timestampSeconds;

  const cost = decodeCost(byKey, failures, fallback.baseFeePerGasWei);

  return {
    blockNumber: fallback.blockNumber,
    blockHash: fallback.blockHash,
    timestampSeconds,
    markets,
    cost,
    failures,
  };
}

/**
 * Aave's strategy is versioned; try V3.2's packed bps getter first and fall
 * back to V3.0's individual getters. Where BOTH fail the result is `null` --
 * a disclosed gap. `DEFAULT_AAVE_CONFIG` is never substituted here.
 */
function decodeAaveIrm(
  addr: ArchiveAddresses,
  byKey: Map<string, Multicall3Result>,
  failures: string[],
): IrmReading | null {
  const v32 = byKey.get('aave.irmV32');
  if (v32 !== undefined && v32.success && v32.returnData !== '0x') {
    try {
      const [data] = AAVE_STRATEGY_V32_IFACE.decodeFunctionResult('getInterestRateDataBps', v32.returnData);
      const d = data as Result;
      const bpsToWad = (bps: bigint): bigint => (bps * WAD) / 10_000n;
      const optimalBps = BigInt(d.getValue('optimalUsageRatio') as bigint);
      return {
        address: addr.aaveStrategy,
        baseRateWad: bpsToWad(BigInt(d.getValue('baseVariableBorrowRate') as bigint)),
        kinkRay: (optimalBps * RAY) / 10_000n,
        slopeLowWad: bpsToWad(BigInt(d.getValue('variableRateSlope1') as bigint)),
        slopeHighWad: bpsToWad(BigInt(d.getValue('variableRateSlope2') as bigint)),
        optimalUtilizationRay: (optimalBps * RAY) / 10_000n,
        // Aave's excess band runs from optimal to 100%.
        maxUtilizationRay: RAY,
      };
    } catch {
      /* fall through to V3.0 */
    }
  }

  const v30 = (key: string, fn: string): bigint | null => {
    const r = byKey.get(key);
    if (r === undefined || !r.success || r.returnData === '0x') return null;
    try {
      return AAVE_STRATEGY_V30_IFACE.decodeFunctionResult(fn, r.returnData)[0] as bigint;
    } catch {
      return null;
    }
  };
  const optimal = v30('aave.irmV30.optimal', 'OPTIMAL_USAGE_RATIO');
  const base = v30('aave.irmV30.base', 'getBaseVariableBorrowRate');
  const slope1 = v30('aave.irmV30.slope1', 'getVariableRateSlope1');
  const slope2 = v30('aave.irmV30.slope2', 'getVariableRateSlope2');
  if (optimal === null || base === null || slope1 === null || slope2 === null) {
    failures.push('aave.irm');
    return null;
  }
  const rayToWad = (r: bigint): bigint => r / 10n ** 9n;
  return {
    address: addr.aaveStrategy,
    baseRateWad: rayToWad(base),
    kinkRay: optimal,
    slopeLowWad: rayToWad(slope1),
    slopeHighWad: rayToWad(slope2),
    optimalUtilizationRay: optimal,
    maxUtilizationRay: RAY,
  };
}

function decodeCost(
  byKey: Map<string, Multicall3Result>,
  failures: string[],
  headerBaseFeeWei: bigint,
): CostReading | null {
  const num = (key: string, iface: Interface, fn: string): bigint | null => {
    const r = byKey.get(key);
    if (r === undefined || !r.success || r.returnData === '0x') return null;
    try {
      return BigInt(iface.decodeFunctionResult(fn, r.returnData)[0] as bigint);
    } catch {
      return null;
    }
  };

  // From the header, NOT from multicall3's getBasefee(): under eth_call on
  // OP-Stack that opcode reads 0, which would price every L2 execution at
  // zero and let the §9.1 cost gate pass every candidate move.
  const l2BaseFeeWei = headerBaseFeeWei;
  const l1BaseFeeWei = num('cost.l1BaseFee', GAS_ORACLE_IFACE, 'l1BaseFee');
  const l1BlobBaseFeeWei = num('cost.blobBaseFee', GAS_ORACLE_IFACE, 'blobBaseFee');

  const feed = (key: string): { answer: bigint; roundId: string; updatedAt: Date } | null => {
    const r = byKey.get(key);
    if (r === undefined || !r.success || r.returnData === '0x') return null;
    try {
      const d = CHAINLINK_IFACE.decodeFunctionResult('latestRoundData', r.returnData);
      const answer = d[1] as bigint;
      if (answer <= 0n) return null; // a non-positive Chainlink answer is invalid, not cheap
      return {
        answer,
        roundId: (d[0] as bigint).toString(),
        updatedAt: new Date(Number(d[3] as bigint) * 1000),
      };
    } catch {
      return null;
    }
  };

  const eth = feed('cost.ethUsd');
  const usdc = feed('cost.usdcUsd');

  if (l2BaseFeeWei === null || l1BaseFeeWei === null || l1BlobBaseFeeWei === null || eth === null || usdc === null) {
    failures.push('cost');
    return null;
  }

  const scalar = (key: string, fn: string): number | null => {
    const v = num(key, GAS_ORACLE_IFACE, fn);
    return v === null ? null : Number(v);
  };

  return {
    l2BaseFeeWei,
    l1BaseFeeWei,
    l1BlobBaseFeeWei,
    baseFeeScalar: scalar('cost.baseFeeScalar', 'baseFeeScalar'),
    blobBaseFeeScalar: scalar('cost.blobBaseFeeScalar', 'blobBaseFeeScalar'),
    ethUsdE8: eth.answer,
    usdcUsdE8: usdc.answer,
    ethUsdRoundId: eth.roundId,
    usdcUsdRoundId: usdc.roundId,
    ethUsdUpdatedAt: eth.updatedAt,
    usdcUsdUpdatedAt: usdc.updatedAt,
  };
}

/** Comet's rate parameters in their native PER-SECOND WAD units. */
export interface CometPerSecondIrm {
  baseWad: bigint;
  kinkWad: bigint;
  slopeLowWad: bigint;
  slopeHighWad: bigint;
}

/**
 * Comet's supply rate, per second, WAD.
 *
 * Reproduces `Comet.getSupplyRate(utilization)` EXACTLY, including its
 * integer truncation. That call cannot be in the origin batch because its
 * argument is fetched by the same batch, so this is the substitute -- and a
 * substitute that is only approximately right is a dataset-wide bias, not a
 * rounding detail: verified against chain at both probe blocks
 * (975_399_733 and 1_443_495_598 wei/second).
 */
export function cometSupplyRatePerSecond(irm: CometPerSecondIrm, utilizationWadValue: bigint): bigint {
  if (utilizationWadValue <= irm.kinkWad) {
    return irm.baseWad + (irm.slopeLowWad * utilizationWadValue) / WAD;
  }
  return (
    irm.baseWad +
    (irm.slopeLowWad * irm.kinkWad) / WAD +
    (irm.slopeHighWad * (utilizationWadValue - irm.kinkWad)) / WAD
  );
}

/**
 * The same kinked model expressed on an ANNUALIZED `IrmReading`.
 *
 * Kept for callers that only hold the normalised reading (the simulators, and
 * any consumer of a persisted row). It agrees with
 * `cometSupplyRatePerSecond(...) * SECONDS_PER_YEAR` to about 5e-10 relative
 * -- close enough to reason with, not close enough to store, which is why the
 * decoder uses the per-second form.
 */
export function compoundSupplyRateWad(irm: IrmReading, utilizationWadValue: bigint): bigint {
  const kinkWad = irm.kinkRay / 10n ** 9n;
  if (utilizationWadValue <= kinkWad) {
    return irm.baseRateWad + (irm.slopeLowWad * utilizationWadValue) / WAD;
  }
  return (
    irm.baseRateWad +
    (irm.slopeLowWad * kinkWad) / WAD +
    (irm.slopeHighWad * (utilizationWadValue - kinkWad)) / WAD
  );
}

export interface AaveReserveFlags {
  active: boolean;
  frozen: boolean;
  paused: boolean;
  reserveFactorBps: number;
}

/**
 * Aave V3's reserve configuration bitmap.
 *
 * Bit 56 active, 57 frozen, 60 paused; bits 64-79 the reserve factor in bps.
 */
export function decodeAaveConfiguration(data: bigint): AaveReserveFlags {
  const bit = (n: bigint): boolean => ((data >> n) & 1n) === 1n;
  return {
    active: bit(56n),
    frozen: bit(57n),
    paused: bit(60n),
    reserveFactorBps: Number((data >> 64n) & 0xffffn),
  };
}

/**
 * A configuration digest for a historical origin.
 *
 * §6.2 treats a regime AS a configuration digest, and `admit`'s
 * REGIME_MIN_HISTORY resets when it changes. The chain exposes no such digest
 * for these venues, so it is derived from the parameters whose change SHOULD
 * start a new regime: the rate model's identity and coefficients, and the
 * paused flag. Deriving it from the whole snapshot would make every origin its
 * own regime and no venue would ever accumulate history.
 */
function configDigestFor(protocol: string, irm: IrmReading | null, paused: boolean): string {
  if (irm === null) return `${protocol}:no-irm:${paused ? 'paused' : 'active'}`;
  return [
    protocol,
    irm.address.toLowerCase(),
    irm.baseRateWad.toString(),
    irm.kinkRay.toString(),
    irm.slopeLowWad.toString(),
    irm.slopeHighWad.toString(),
    paused ? 'paused' : 'active',
  ].join(':');
}
