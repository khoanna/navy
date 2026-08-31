/**
 * VaultApyService — computes current APY from on-chain adapter reads.
 * No auth required; cached for 5 minutes.
 */
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ethers } from 'ethers';
import { NAVY_EVM } from '../evm/evm.module';
import type { NavyEvm } from '../evm/evm.module';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECONDS_PER_YEAR = 31_536_000n;
const WAD_SCALE = 1_000_000_000_000_000_000n; // 1e18
const RAY_SCALE = 1_000_000_000_000_000_000_000_000_000n; // 1e27 (Aave liquidity rate)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdapterApy {
  address: string;
  name: string;
  apyBps: number;
  tvlBase: string;
}

export interface VaultApysResponse {
  adapters: AdapterApy[];
  aggregateApyBps: number;
  blockNumber: number;
}

interface AdapterConfig {
  address: string;
  name: string;
  protocol: 'compound' | 'aave' | 'moonwell';
  comet?: string;
  aUsdc?: string;
  mUsdc?: string;
  comptroller?: string;
  interestRateModel?: string;
}

/**
 * Known adapter addresses per deployment.
 * In production these come from the vault's registered-adapter events or config.
 */
// Anvil deployment (2026-08-30): DeploySimpleAnvil.s.sol
export const KNOWN_ADAPTERS: AdapterConfig[] = [
  {
    address: '0xb4DE08Ae7d977FC220d963D0823123C88f0069c8',
    name: 'Compound III',
    protocol: 'compound',
    comet: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
  },
  {
    address: '0x401D5D9a4Fa8B46197cA52e681E0f1f52402bdDA',
    name: 'Aave V3',
    protocol: 'aave',
    aUsdc: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB',
  },
  {
    address: '0x30FDC180f5dBD86955beEebd1D1D5596bF745BfD',
    name: 'Moonwell',
    protocol: 'moonwell',
    mUsdc: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
    comptroller: '0xfBb21d0380beE3312B33c4353c8936a0F13EF26C',
    interestRateModel: '0x76e1e2F2E3239A15bAD01f027B5A4bcDE5797f3C',
  },
];

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  response: VaultApysResponse;
  timestamp: number;
}

// Module-level cache — cleared between test runs.
let _cache: CacheEntry | null = null;

export function clearApyCache() {
  _cache = null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class VaultApyService {
  constructor(@Inject(NAVY_EVM) private readonly evm: NavyEvm) {}

  /**
   * Compute current APY from on-chain reads, with 5-minute TTL cache.
   */
  async computeApys(): Promise<VaultApysResponse> {
    const now = Date.now();
    if (_cache && now - _cache.timestamp < CACHE_TTL_MS) {
      return _cache.response;
    }

    const blockNumber = await this.evm.provider.getBlockNumber();
    const adapters: AdapterApy[] = [];

    for (const config of KNOWN_ADAPTERS) {
      try {
        const result = await this.computeAdapterApy(config);
        adapters.push(result);
      } catch (err) {
        // Log and skip adapters that fail to read
        console.error(`[VaultApy] Failed to read APY for ${config.name} (${config.address}):`, err);
      }
    }

    const aggregateApyBps = computeAggregateApy(adapters);

    const response: VaultApysResponse = {
      adapters,
      aggregateApyBps,
      blockNumber,
    };

    _cache = { response, timestamp: now };
    return response;
  }

  /**
   * Compute APY for a single adapter based on its protocol type.
   */
  private async computeAdapterApy(config: AdapterConfig): Promise<AdapterApy> {
    const provider = this.evm.provider;

    // Read TVL from adapter's totalAssets()
    const tvlBase = await this.callViewUint256(config.address, 'totalAssets()');

    let apyBps: number;

    if (config.protocol === 'compound') {
      apyBps = await this.computeCompoundApy(config.comet!);
    } else if (config.protocol === 'aave') {
      apyBps = await this.computeAaveApy();
    } else if (config.protocol === 'moonwell') {
      apyBps = await this.computeMoonwellApy(config.mUsdc!, config.comptroller!, config.interestRateModel!);
    } else {
      throw new Error(`Unknown protocol: ${config.protocol}`);
    }

    return {
      address: config.address,
      name: config.name,
      apyBps,
      tvlBase: tvlBase.toString(),
    };
  }

  /**
   * Low-level view call — reads a single uint256 return value.
   */
  private async callViewUint256(to: string, signature: string): Promise<bigint> {
    // Ensure interface has returns type for proper encoding/decoding
    const fullSig = signature.includes('returns')
      ? signature
      : signature.replace(/\)\s*$/, ') returns (uint256)');
    const iface = new ethers.Interface([`function ${fullSig}`]);
    const fn = signature.split('(')[0];
    const data = iface.encodeFunctionData(fn, []);
    const result = await this.evm.provider.call({ to, data });
    const [decoded] = iface.decodeFunctionResult(fn, result);
    return BigInt(decoded);
  }

  /**
   * Compound III: utilization-based supply rate from Comet.
   * Comet getSupplyRate() returns ray per second (1e27 scale).
   */
  private async computeCompoundApy(cometAddress: string): Promise<number> {
    // getUtilization() → uint256 (ray)
    const utilization = await this.callViewUint256(cometAddress, 'getUtilization()');

    // getSupplyRate(uint256 utilization) → uint256 (ray per second)
    const iface = new ethers.Interface(['function getSupplyRate(uint256) returns (uint256)']);
    const fn = 'getSupplyRate';
    const data = iface.encodeFunctionData(fn, [utilization]);
    const result = await this.evm.provider.call({ to: cometAddress, data });
    const [rate] = iface.decodeFunctionResult(fn, result);
    const supplyRatePerSecond = BigInt(rate);

    // APY bps = rate_per_second * 31536000 * 10000 / 1e18 (multiply first, then divide)
    // Compound's getSupplyRate returns rate in WAD (1e18), which is the annualized rate per second
    const apy = (supplyRatePerSecond * SECONDS_PER_YEAR * 10000n) / WAD_SCALE;
    return Number(apy);
  }

  /**
   * Aave V3: liquidity rate from reserve data.
   * currentLiquidityRate is already annualized in ray (1e27 scale).
   */
  private async computeAaveApy(): Promise<number> {
    const aavePool = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
    const usdcAddress = this.evm.usdcAddress;

    // getReserveData(address asset) → ReserveData struct (Aave V3)
    // Ethers.js with typed returns decodes each field as separate array element.
    // Verified field order from cast with typed returns:
    // 0: configuration(uint256), 1: liquidityIndex(uint128), 2: currentLiquidityRate(uint128), ...
    const iface = new ethers.Interface([
      'function getReserveData(address asset) view returns ('
      + 'uint256 configuration,'
      + 'uint128 liquidityIndex,'
      + 'uint128 currentLiquidityRate,'
      + 'uint128 variableBorrowIndex,'
      + 'uint128 currentVariableBorrowRate,'
      + 'uint128 currentStableBorrowRate,'
      + 'uint40 lastUpdateTimestamp,'
      + 'uint16 usageAsCollateralEnabled,'
      + 'address stableBorrowToken,'
      + 'address aTokenAddress,'
      + 'address stableDebtTokenAddress,'
      + 'address interestRateStrategyAddress,'
      + 'uint128 accruedToTreasury,'
      + 'uint128 unbacked,'
      + 'uint128 isolationModeTotalDebt)'
    ]);
    const fn = 'getReserveData';
    const data = iface.encodeFunctionData(fn, [usdcAddress]);
    const result = await this.evm.provider.call({ to: aavePool, data });
    const decoded = iface.decodeFunctionResult(fn, result) as any;

    // currentLiquidityRate is at index 2 (RAY = 1e27, already annualized)
    const liquidityRate = BigInt(decoded[2]);

    // APY = liquidityRate * 10000 / 1e27 (multiply first to avoid integer truncation)
    const apy = liquidityRate * 10000n / RAY_SCALE;
    return Number(apy);
  }

  /**
   * Moonwell: supply rate from the Interest Rate Model via mToken.
   * Mirrors MoonwellAdapter.supplyRatePerYear():
   * 1. Read mToken state: getCash(), totalBorrows(), totalReserves(), reserveFactorMantissa()
   * 2. Call interestRateModel.getSupplyRate(cash, borrows, reserves, reserveFactor)
   * 3. Returns rate in 1e18 per second, multiply by SECONDS_PER_YEAR for annual rate
   */
  private async computeMoonwellApy(
    mUsdcAddress: string,
    _comptrollerAddress: string,
    interestRateModelAddress: string,
  ): Promise<number> {
    const provider = this.evm.provider;

    // Read mToken state
    const [cash, totalBorrows, totalReserves, reserveFactorMantissa] = await Promise.all([
      this.callViewUint256(mUsdcAddress, 'getCash()'),
      this.callViewUint256(mUsdcAddress, 'totalBorrows()'),
      this.callViewUint256(mUsdcAddress, 'totalReserves()'),
      this.callViewUint256(mUsdcAddress, 'reserveFactorMantissa()'),
    ]);

    // Call Interest Rate Model: getSupplyRate(cash, borrows, reserves, reserveFactor)
    // Returns rate in 1e18 per second
    const iface = new ethers.Interface([
      'function getSupplyRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactorMantissa) view returns (uint256)',
    ]);
    const fn = 'getSupplyRate';
    const data = iface.encodeFunctionData(fn, [cash, totalBorrows, totalReserves, reserveFactorMantissa]);
    const result = await provider.call({ to: interestRateModelAddress, data });
    const [rate] = iface.decodeFunctionResult(fn, result);
    const supplyRatePerSecond = BigInt(rate);

    // APY = supplyRatePerSecond * SECONDS_PER_YEAR * 10000 / 1e18 (WAD scale)
    const apy = supplyRatePerSecond * SECONDS_PER_YEAR * 10000n / WAD_SCALE;
    return Number(apy);
  }
}

/**
 * Compute TVL-weighted average APY in basis points.
 * Exported for unit-testing without needing the full service.
 */
export function computeAggregateApy(adapters: AdapterApy[]): number {
  if (adapters.length === 0) return 0;

  const totalTvl = adapters.reduce((sum, a) => sum + BigInt(a.tvlBase), 0n);
  if (totalTvl === 0n) return 0;

  const weightedSum = adapters.reduce(
    (sum, a) => sum + BigInt(a.apyBps) * BigInt(a.tvlBase),
    0n,
  );

  return Number(weightedSum / totalTvl);
}
