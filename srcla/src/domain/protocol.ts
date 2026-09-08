import type { MarketObservation } from '../policy/types.js';

const PROTOCOL_BY_NAME: Record<string, MarketObservation['protocol']> = {
  aave: 'aave',
  compound: 'compound',
  moonwell: 'moonwell',
};

/**
 * Classify a strategy/market identifier as one of the three registered
 * protocols (paper §6.3-6.5). Throws rather than guessing: `simulateCurves`
 * picks a whole rate model off this value, so a silent misclassification
 * would silently simulate the wrong protocol.
 *
 * Shared by the live decision driver and the offline evaluation harness so
 * both classify a market identically — §11.1's equal-information
 * requirement applies to the inputs, not just the policy.
 */
export function protocolOf(name: string): MarketObservation['protocol'] {
  const key = Object.keys(PROTOCOL_BY_NAME).find((k) => name.toLowerCase().includes(k));
  if (!key) throw new Error(`cannot classify strategy "${name}" as a known protocol`);
  return PROTOCOL_BY_NAME[key]!;
}
