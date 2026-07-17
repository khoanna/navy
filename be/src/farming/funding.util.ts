export interface FundingBounds {
  /** Base units to always leave in the user's embedded wallet. */
  reserve: bigint;
  /** Minimum spare that justifies a top-up. */
  fundMin: bigint;
  /** Maximum single top-up. */
  fundMax: bigint;
}

/** Pure: how much to move from the user's wallet into their subwallet, or null to skip. */
export function computeFundAmount(userBalance: bigint, bounds: FundingBounds): bigint | null {
  const spare = userBalance - bounds.reserve;
  if (spare < bounds.fundMin) return null;
  return spare < bounds.fundMax ? spare : bounds.fundMax;
}
