export type EarnTip = { show: false } | { show: true; amount: string };

/** Rule-based (non-AI) home tip: nudge idle USDC into the Earn vault. */
export function earnTip(usdc: number, thresholdUsdc: number): EarnTip {
  if (!Number.isFinite(usdc) || usdc < thresholdUsdc) return { show: false };
  return { show: true, amount: usdc.toLocaleString('en-US') };
}
