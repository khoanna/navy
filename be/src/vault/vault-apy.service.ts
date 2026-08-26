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
const RAY_SCALE = 1_000_000_000_000_000_000_000_000_000n; // 1e27
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
}

/**
 * Known adapter addresses per deployment.
 * In production these come from the vault's registered-adapter events or config.
 */
export const KNOWN_ADAPTERS: AdapterConfig[] = [
  {
    address: '0x5b53a25fF5Ec56a852CB4c0D193754308C6e99A0',
    name: 'Compound III',
    protocol: 'compound',
    comet: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
  },
  {
    address: '0xfDCaC27247ecb3452f88c8ea10CACeabc19348eb',
    name: 'Aave V3',
    protocol: 'aave',
    aUsdc: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB',
  },
  {
    address: '0x5bb77832BA9CBe335fCCdF8Ef5520ae041326598',
    name: 'Moonwell',
    protocol: 'moonwell',
    mUsdc: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
    comptroller: '0xfBb21d0380beE3312B33c4353c8936a0F13EF26C',
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
      apyBps = await this.computeMoonwellApy(config.mUsdc!, config.comptroller!);
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

    // APY = supplyRatePerSecond * 31536000 * 10000 / 1e27 (multiply first to avoid integer truncation)
    const apy = supplyRatePerSecond * SECONDS_PER_YEAR * 10000n / RAY_SCALE;
    return Number(apy);
  }

  /**
   * Aave V3: liquidity rate from reserve data.
   * currentLiquidityRate is already annualized in ray (1e27 scale).
   */
  private async computeAaveApy(): Promise<number> {
    const aavePool = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
    const usdcAddress = this.evm.usdcAddress;

    // getReserveData(address asset) → ReserveData struct
    // liquidityRate is the 1st field (index 0)
    const iface = new ethers.Interface([
      'function getReserveData(address asset) view returns ('
      + 'uint128 liquidityRate,'
      + 'uint128 variableBorrowRate,'
      + 'uint128 stableBorrowRate,'
      + 'uint128 liquidityIndex,'
      + 'uint128 variableBorrowIndex,'
      + 'address aTokenAddress,'
      + 'address stableDebtTokenAddress,'
      + 'address interestRateStrategyAddress,'
      + 'uint128 accruedToTreasury,'
      + 'uint128 unbacked,'
      + 'uint128 isolationModeTotalDebt,'
      + 'uint128 accruedToTreasuryScaled,'
      + 'uint128 unbackedScaled,'
      + 'uint128 isolationModeTotalDebtScaled)'
    ]);
    const fn = 'getReserveData';
    const data = iface.encodeFunctionData(fn, [usdcAddress]);
    const result = await this.evm.provider.call({ to: aavePool, data });
    const decoded = iface.decodeFunctionResult(fn, result) as any;

    // liquidityRate is the 1st field in the struct (index 0)
    const liquidityRate = BigInt(decoded[0]);

    // APY = liquidityRate * 10000 / 1e27 (multiply first to avoid integer truncation)
    const apy = liquidityRate * 10000n / RAY_SCALE;
    return Number(apy);
  }

  /**
   * Moonwell: supply rate from the interest rate model via Comptroller.
   * supplyRate is per second in 1e18 scale.
   */
  private async computeMoonwellApy(mUsdcAddress: string, comptrollerAddress: string): Promise<number> {
    // getMarketData(address mToken) → MarketData struct
    // MarketData: underlying(0), supplyRate(1), borrowRate(2), totalBorrows(3), totalReserves(4),
    //   supplyCap(5), borrowCap(6), underlyingPrice(7), collateralFactor(8),
    //   isListed(9), isTransferPaused(10), mintGuardianPaused(11), borrowGuardianPaused(12)
    const iface = new ethers.Interface([
      'function getMarketData(address mToken) view returns ('
      + 'address underlying,'
      + 'uint256 supplyRate,'
      + 'uint256 borrowRate,'
      + 'uint256 totalBorrows,'
      + 'uint256 totalReserves,'
      + 'uint256 supplyCap,'
      + 'uint256 borrowCap,'
      + 'uint256 underlyingPrice,'
      + 'uint256 collateralFactor,'
      + 'bool isListed,'
      + 'bool isTransferPaused,'
      + 'bool mintGuardianPaused,'
      + 'bool borrowGuardianPaused)'
    ]);
    const fn = 'getMarketData';
    const data = iface.encodeFunctionData(fn, [mUsdcAddress]);
    const result = await this.evm.provider.call({ to: comptrollerAddress, data });
    const decoded = iface.decodeFunctionResult(fn, result) as any;

    // supplyRate is the 2nd field (index 1)
    const supplyRatePerSecond = BigInt(decoded[1]);

    // APY = supplyRatePerSecond * 31536000 * 10000 / 1e18 (WAD scale)
    const WAD_SCALE = 1_000_000_000_000_000_000n; // 1e18
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
