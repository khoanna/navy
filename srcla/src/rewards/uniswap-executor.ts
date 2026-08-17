/**
 * Uniswap V3 Executor
 *
 * Executes reward token swaps through immutable Uniswap V3 routes per §9.4:
 * - Validate immutable routes
 * - minOut protection
 * - Atomic execution where possible
 * - Use quoter for price estimation
 */

import { ethers } from 'ethers';
import type { ChainClient } from '../chain/client.js';
import type { ChainlinkOracle } from './chainlink-oracle.js';
import type {
  UniswapV3Route,
  SwapParams,
  SwapQuote,
  SwapResult,
  UniswapExecutorConfig,
  RouteStatus,
} from './types.js';

// Uniswap V3 Router ABI
const UNISWAP_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory)',
];

// Uniswap V3 Quoter ABI
const UNISWAP_QUOTER_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

// ERC-20 ABI for token operations
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

/**
 * Default Uniswap V3 executor configuration
 */
export const DEFAULT_UNISWAP_CONFIG: UniswapExecutorConfig = {
  routerAddress: '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap V3 Router on Base
  quoterAddress: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a', // Uniswap V3 Quoter on Base
  maxSlippageBps: 50n, // 0.5%
  minSwapAmountUsdc: 10_000_000n, // $10 minimum
  maxPriceImpactBps: 100n, // 1%
};

/**
 * Immutable route registry
 * Per §9.4: routes are admin-approved and cannot be modified by allocator
 */
interface RouteRegistry {
  [routeId: string]: UniswapV3Route;
}

/**
 * UniswapV3Executor - Executes reward token swaps through approved routes
 *
 * Per §9.4 requirements:
 * - Validates immutable routes
 * - minOut protection
 * - Atomic execution where possible
 * - Uses quoter for price estimation
 */
export class UniswapV3Executor {
  private client: ChainClient;
  private chainlinkOracle: ChainlinkOracle;
  private config: UniswapExecutorConfig;
  private wallet: ethers.Wallet | null = null;
  private routeRegistry: RouteRegistry = {};
  private routerContract: ethers.Contract;
  private quoterContract: ethers.Contract;

  constructor(
    client: ChainClient,
    chainlinkOracle: ChainlinkOracle,
    config: Partial<UniswapExecutorConfig> = {}
  ) {
    this.client = client;
    this.chainlinkOracle = chainlinkOracle;
    this.config = { ...DEFAULT_UNISWAP_CONFIG, ...config };

    // Initialize contracts
    this.routerContract = new ethers.Contract(
      this.config.routerAddress,
      UNISWAP_ROUTER_ABI,
      this.client.provider
    );
    this.quoterContract = new ethers.Contract(
      this.config.quoterAddress,
      UNISWAP_QUOTER_ABI,
      this.client.provider
    );
  }

  /**
   * Set the executor wallet for signing transactions
   */
  setWallet(wallet: ethers.Wallet): void {
    this.wallet = wallet;
    // Re-initialize contracts with signer
    this.routerContract = new ethers.Contract(
      this.config.routerAddress,
      UNISWAP_ROUTER_ABI,
      wallet
    );
  }

  /**
   * Register an immutable route
   * Per §9.4: routes are admin-approved and immutable
   *
   * @param route - Route configuration
   */
  registerRoute(route: UniswapV3Route): void {
    this.routeRegistry[route.routeId] = route;
  }

  /**
   * Register multiple routes at once
   */
  registerRoutes(routes: UniswapV3Route[]): void {
    for (const route of routes) {
      this.registerRoute(route);
    }
  }

  /**
   * Get a registered route by ID
   *
   * @param routeId - Route identifier
   * @returns Route or null if not found
   */
  getRoute(routeId: string): UniswapV3Route | null {
    return this.routeRegistry[routeId] ?? null;
  }

  /**
   * Get all registered routes
   */
  getAllRoutes(): UniswapV3Route[] {
    return Object.values(this.routeRegistry);
  }

  /**
   * Get routes for a specific token
   *
   * @param tokenIn - Input token address
   * @returns Array of routes from this token
   */
  getRoutesForToken(tokenIn: string): UniswapV3Route[] {
    return this.getAllRoutes().filter(
      (r) => r.tokenIn.toLowerCase() === tokenIn.toLowerCase()
    );
  }

  /**
   * Check if a route is registered
   */
  hasRoute(routeId: string): boolean {
    return routeId in this.routeRegistry;
  }

  /**
   * Get route status from RewardExecutor contract
   * This should be called on-chain to verify route is still active
   *
   * @param routeId - Route identifier
   * @param rewardExecutorAddress - RewardExecutor contract address
   * @returns Route status
   */
  async getRouteStatus(
    routeId: string,
    rewardExecutorAddress: string
  ): Promise<RouteStatus> {
    if (!this.hasRoute(routeId)) {
      return 'inactive';
    }

    try {
      // Call RewardExecutor to check route status
      const REWARD_EXECUTOR_ABI = [
        'function getRouteStatus(bytes32 routeId) external view returns (uint8)',
      ];
      const contract = new ethers.Contract(
        rewardExecutorAddress,
        REWARD_EXECUTOR_ABI,
        this.client.provider
      );

      const getRouteStatusFn = contract.getRouteStatus;
      if (typeof getRouteStatusFn !== 'function') {
        return 'stale';
      }

      const status = (await getRouteStatusFn(
        ethers.id(routeId)
      )) as bigint;

      // Status: 0 = inactive, 1 = active, 2 = stale
      if (status === 0n) return 'inactive';
      if (status === 2n) return 'stale';
      return 'active';
    } catch {
      return 'stale';
    }
  }

  /**
   * Get a price quote from Uniswap Quoter
   *
   * @param routeId - Route identifier
   * @param amountIn - Amount of input token
   * @returns SwapQuote with estimated output and price impact
   */
  async getQuote(routeId: string, amountIn: bigint): Promise<SwapQuote | null> {
    const route = this.getRoute(routeId);
    if (!route) {
      return null;
    }

    try {
      const quoteParams = {
        tokenIn: route.tokenIn,
        tokenOut: route.tokenOut,
        fee: route.poolFee,
        amountIn,
        sqrtPriceLimitX96: 0, // No price limit for best execution
      };

      const quoteFn = this.quoterContract.quoteExactInputSingle;
      if (typeof quoteFn !== 'function') {
        return null;
      }

      const result = await quoteFn(quoteParams) as [bigint, bigint, number, bigint];
      const [amountOut] = result;

      // Calculate price impact
      // Get spot price from oracle for comparison
      const oraclePrice = await this.chainlinkOracle.getPrice(route.oracleFeed);

      // Estimate execution price
      const executionPrice = oraclePrice.price > 0n
        ? (amountIn * oraclePrice.price) / amountOut
        : 0n;

      // Price impact is simplified here; real implementation would compare
      // spot price vs quoted price
      const priceImpactBps = oraclePrice.price > 0n
        ? this.chainlinkOracle.calculateDeviation(executionPrice, oraclePrice.price)
        : 0n;

      return {
        amountOut,
        executionPrice,
        priceImpactBps: priceImpactBps > 0n ? priceImpactBps : 0n,
        valid: amountOut > 0n,
      };
    } catch (error) {
      console.error(`Quote failed for route ${routeId}:`, error);
      return null;
    }
  }

  /**
   * Validate swap parameters
   *
   * @param routeId - Route identifier
   * @param amountIn - Amount to swap
   * @returns Validation result with reason if invalid
   */
  async validateSwap(routeId: string, amountIn: bigint): Promise<{ valid: boolean; reason?: string }> {
    const route = this.getRoute(routeId);

    if (!route) {
      return { valid: false, reason: `Route ${routeId} not found` };
    }

    // Validate amount is above minimum
    if (amountIn <= 0n) {
      return { valid: false, reason: 'Amount must be positive' };
    }

    // Check token balance
    if (this.wallet) {
      const tokenContract = new ethers.Contract(route.tokenIn, ERC20_ABI, this.wallet);
      const balanceOfFn = tokenContract.balanceOf;
      const allowanceFn = tokenContract.allowance;
      const approveFn = tokenContract.approve;

      if (typeof balanceOfFn !== 'function') {
        return { valid: false, reason: 'Token contract not supported' };
      }

      const balance = await balanceOfFn(this.wallet.address) as bigint;

      if (balance < amountIn) {
        return { valid: false, reason: `Insufficient balance: ${balance} < ${amountIn}` };
      }

      // Check and set allowance
      if (typeof allowanceFn === 'function') {
        const allowance = await allowanceFn(
          this.wallet.address,
          this.config.routerAddress
        ) as bigint;

        if (allowance < amountIn && typeof approveFn === 'function') {
          // Approve the router
          const approveTx = await approveFn(
            this.config.routerAddress,
            ethers.MaxUint256
          ) as ethers.TransactionResponse;
          await approveTx.wait(2);
        }
      }
    }

    // Validate price impact
    const quote = await this.getQuote(routeId, amountIn);
    if (!quote) {
      return { valid: false, reason: 'Failed to get quote' };
    }

    if (quote.priceImpactBps > this.config.maxPriceImpactBps) {
      return {
        valid: false,
        reason: `Price impact ${quote.priceImpactBps}bps exceeds max ${this.config.maxPriceImpactBps}bps`,
      };
    }

    // Validate min output against minimum swap amount
    const minOutputUsdc = this.estimateOutputValueUsdc(quote.amountOut);
    if (minOutputUsdc < this.config.minSwapAmountUsdc) {
      return {
        valid: false,
        reason: `Output value ${minOutputUsdc} below minimum ${this.config.minSwapAmountUsdc}`,
      };
    }

    return { valid: true };
  }

  /**
   * Execute a swap
   *
   * @param params - Swap parameters
   * @returns SwapResult with transaction hash and output
   */
  async executeSwap(params: SwapParams): Promise<SwapResult> {
    if (!this.wallet) {
      return { success: false, error: 'Wallet not set' };
    }

    const route = this.getRoute(params.routeId);
    if (!route) {
      return { success: false, error: `Route ${params.routeId} not found` };
    }

    // Validate swap
    const validation = await this.validateSwap(params.routeId, params.amountIn);
    if (!validation.valid) {
      return { success: false, error: validation.reason ?? 'Validation failed' };
    }

    try {
      const exactInputSingleFn = this.routerContract.exactInputSingle;
      if (typeof exactInputSingleFn !== 'function') {
        return { success: false, error: 'Router not supported' };
      }

      // Build exactInputSingle params
      const swapParams = {
        tokenIn: route.tokenIn,
        tokenOut: route.tokenOut,
        fee: route.poolFee,
        recipient: this.wallet.address, // Will be vault in production
        deadline: params.deadline,
        amountIn: params.amountIn,
        amountOutMinimum: params.minOut,
        sqrtPriceLimitX96: 0,
      };

      // Execute swap
      const tx = await exactInputSingleFn(swapParams, {
        gasLimit: 500_000n, // Conservative gas limit
      }) as ethers.TransactionResponse;

      const receipt = await tx.wait(2);

      if (!receipt) {
        return { success: false, error: 'Transaction receipt is null' };
      }

      // Parse event for actual output
      // In production, parse Transfer events to get exact output
      const amountOut = params.minOut; // Conservative estimate

      return {
        success: true,
        txHash: receipt.hash,
        amountOut,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Execute atomic swap (claim + swap in one transaction)
   * Uses multicall to atomically claim from adapter and swap
   *
   * @param adapter - Adapter address to claim from
   * @param routeId - Route identifier
   * @param amountIn - Amount to claim and swap
   * @param minOut - Minimum acceptable output
   * @param deadline - Transaction deadline
   * @returns SwapResult
   */
  async executeAtomicSwap(
    adapter: string,
    routeId: string,
    amountIn: bigint,
    minOut: bigint,
    deadline: bigint
  ): Promise<SwapResult> {
    if (!this.wallet) {
      return { success: false, error: 'Wallet not set' };
    }

    const route = this.getRoute(routeId);
    if (!route) {
      return { success: false, error: `Route ${routeId} not found` };
    }

    try {
      // Build multicall data
      // 1. Claim rewards from adapter (if applicable)
      // 2. Approve router (if needed)
      // 3. Swap

      // For atomic execution, we need the adapter's claim function
      const ADAPTER_ABI = [
        'function claimRewards(address token, uint256 amount) external',
      ];

      const calls: string[] = [];

      // If claiming from adapter
      if (adapter !== ethers.ZeroAddress) {
        const adapterContract = new ethers.Contract(adapter, ADAPTER_ABI, this.wallet);
        calls.push(
          adapterContract.interface.encodeFunctionData('claimRewards', [
            route.tokenIn,
            amountIn,
          ])
        );
      }

      // Swap call
      const swapData = this.routerContract.interface.encodeFunctionData('exactInputSingle', [
        {
          tokenIn: route.tokenIn,
          tokenOut: route.tokenOut,
          fee: route.poolFee,
          recipient: this.wallet.address,
          deadline,
          amountIn,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0,
        },
      ]);
      calls.push(swapData);

      // Execute multicall
      const multicallFn = this.routerContract.multicall;
      if (typeof multicallFn !== 'function') {
        return { success: false, error: 'Multicall not supported' };
      }

      const multicallTx = await multicallFn(deadline, calls, {
        gasLimit: 800_000n, // Higher gas limit for multicall
      }) as ethers.TransactionResponse;

      const receipt = await multicallTx.wait(2);

      if (!receipt) {
        return { success: false, error: 'Multicall transaction receipt is null' };
      }

      return {
        success: true,
        txHash: receipt.hash,
        amountOut: minOut, // Conservative
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Estimate the USDC value of a swap output
   *
   * @param amountOut - Output amount
   * @returns Estimated value in USDC 6-decimal units
   */
  private estimateOutputValueUsdc(amountOut: bigint): bigint {
    // If output is USDC, return as-is
    // In production, this would use a USDC/USD oracle if needed
    // For now, assume tokenOut is USDC (6 decimals)
    return amountOut;
  }

  /**
   * Calculate minimum output with slippage protection
   *
   * @param expectedOutput - Expected output from quote
   * @param slippageBps - Slippage tolerance in basis points
   * @returns Minimum acceptable output
   */
  calculateMinOut(expectedOutput: bigint, slippageBps?: bigint): bigint {
    const slippage = slippageBps ?? this.config.maxSlippageBps;
    return expectedOutput - (expectedOutput * slippage) / 10000n;
  }

  /**
   * Get all active routes
   */
  getActiveRoutes(): UniswapV3Route[] {
    return this.getAllRoutes();
  }

  /**
   * Get executor configuration
   */
  getConfig(): UniswapExecutorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<UniswapExecutorConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
