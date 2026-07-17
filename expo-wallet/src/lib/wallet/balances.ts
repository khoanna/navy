import { Contract, JsonRpcProvider } from 'ethers';

/** Minimal ERC-20 ABI — only what we read for USDC balances. */
export const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];

/** Format native ETH wei to a display string (up to 4 dp), using BigInt math for precision. */
export function weiToEth(wei: string | bigint): string {
  let b: bigint;
  try {
    b = typeof wei === 'bigint' ? wei : BigInt(wei);
  } catch {
    return '0';
  }
  const neg = b < BigInt(0);
  if (neg) b = -b;
  // Round half-up to 4 decimals: (wei + 0.5e14) / 1e14 gives ten-thousandths of ETH.
  const tenThousandths = (b + BigInt('50000000000000')) / BigInt('100000000000000');
  const whole = tenThousandths / BigInt(10000);
  const frac = (tenThousandths % BigInt(10000)).toString().padStart(4, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole.toString()}${frac ? '.' + frac : ''}`;
}

/**
 * Format USDC base units (6 decimals) to a 2-dp display string using BigInt math,
 * so large amounts don't lose precision and malformed input renders '0.00' instead
 * of 'NaN' (which would leak into e.g. a "Pay NaN USDC" button label).
 */
export function usdcBaseToDisplay(base: string | bigint): string {
  let b: bigint;
  try {
    b = typeof base === 'bigint' ? base : BigInt(base);
  } catch {
    return '0.00';
  }
  const neg = b < BigInt(0);
  if (neg) b = -b;
  const cents = (b + BigInt(5000)) / BigInt(10000); // round half-up to 2 decimals
  const whole = cents / BigInt(100);
  const frac = cents % BigInt(100);
  return `${neg ? '-' : ''}${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

/** The subset of a provider we need: native balance reads (an ethers JsonRpcProvider satisfies it). */
export interface BalanceProvider {
  getBalance(address: string): Promise<bigint>;
}

/** Anything exposing `balanceOf` — an ethers Contract, or an injected fake in tests. */
export interface Erc20Reader {
  balanceOf(owner: string): Promise<bigint>;
}

/**
 * Read the payer's balances on Sepolia:
 *  - native ETH (wei, for gas visibility)
 *  - USDC ERC-20 balance (6-decimal base units) via `balanceOf(address)`
 *
 * `usdc` is injectable so this stays unit-testable without a live RPC; production
 * callers use {@link makeUsdcReader} to build one from the ethers provider.
 */
export async function fetchBalances(
  provider: BalanceProvider,
  owner: string,
  usdc: Erc20Reader,
): Promise<{ ethWei: string; usdcBase: string }> {
  const ethWei = (await provider.getBalance(owner)).toString();
  let usdcBase = '0';
  try {
    usdcBase = (await usdc.balanceOf(owner)).toString();
  } catch {
    usdcBase = '0';
  }
  return { ethWei, usdcBase };
}

/** Build a live USDC ERC-20 reader bound to a JSON-RPC provider. */
export function makeUsdcReader(provider: JsonRpcProvider, usdcAddress: string): Erc20Reader {
  return new Contract(usdcAddress, ERC20_ABI, provider) as unknown as Erc20Reader;
}
