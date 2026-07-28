// Pure, framework-free helpers for the pooled ERC-4626 vault flow.
// The agent proposes a *USDC* withdraw amount, but the vault redeems *shares*.
// We convert the requested USDC (assets) into shares against the user's position
// so a partial withdraw redeems the proportional slice of their shares.

export interface VaultPosition {
  sharesBase: string; // vault shares, base units (string BigInt)
  assetsBase: string; // current USDC value of those shares, 6-decimal base units
}

/**
 * Convert a proposed USDC withdraw into a shares amount to redeem.
 *
 * - A withdraw-all (`amount === 'all'`) redeems the full `sharesBase`.
 * - An amount ≥ the position's `assetsBase` also redeems everything (can't take more).
 * - Otherwise redeem the proportional slice: `sharesBase * amountBase / assetsBase`
 *   (floored via BigInt integer division).
 *
 * Returns the shares to redeem as a base-unit string. Returns '0' when there is
 * no position (nothing to redeem).
 */
export function sharesToRedeem(amount: 'all' | string, position: VaultPosition): string {
  const shares = BigInt(position.sharesBase || '0');
  const assets = BigInt(position.assetsBase || '0');
  if (shares <= 0n || assets <= 0n) return '0';

  if (amount === 'all') return shares.toString();

  const wantAssets = BigInt(amount);
  if (wantAssets <= 0n) return '0';
  if (wantAssets >= assets) return shares.toString();

  // Proportional slice, floored.
  return ((shares * wantAssets) / assets).toString();
}
