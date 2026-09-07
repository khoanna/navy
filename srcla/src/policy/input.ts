import type {
  CompletedLabel,
  DecisionInput,
  GasObservation,
  MarketObservation,
  PolicyArtifact,
  WithdrawalObservation,
} from './types.js';

export interface RawOrigin {
  origin: DecisionInput['origin'];
  vault: DecisionInput['vault'];
  markets: MarketObservation[];
  dependencyGroups: DecisionInput['dependencyGroups'];
  withdrawals: WithdrawalObservation[];
  gas: GasObservation;
  /** Unfiltered label store. Never pass this to decide() directly. */
  allLabels: CompletedLabel[];
  lastAction: DecisionInput['lastAction'];
}

/**
 * §7.3 — only an outcome whose horizon has fully ended and whose availability
 * lag has passed may train a forecast at origin t, and data from a superseded
 * configuration regime may not train the current one.
 *
 * This is the sole gate. Both the live driver and the replay driver construct
 * their DecisionInput here, so neither can see the future by construction.
 */
export function filterUsableLabels(
  all: CompletedLabel[],
  originSeconds: number,
  artifact: PolicyArtifact,
  currentRegimeByMarket: Record<string, string>
): CompletedLabel[] {
  return all.filter((l) => {
    if (l.horizonEndSeconds > originSeconds) return false;
    if (l.availableAtSeconds + artifact.availabilityLagSeconds > originSeconds) return false;
    const currentRegime = currentRegimeByMarket[l.marketId];
    if (currentRegime !== undefined && l.regimeId !== currentRegime) return false;
    return true;
  });
}

export function buildDecisionInput(raw: RawOrigin, artifact: PolicyArtifact): DecisionInput {
  const regimeByMarket: Record<string, string> = {};
  for (const m of raw.markets) regimeByMarket[m.marketId] = m.regimeId;

  const history = filterUsableLabels(
    raw.allLabels,
    raw.origin.timestampSeconds,
    artifact,
    regimeByMarket
  );

  // Withdrawal demand is also an observation and obeys the same barrier.
  const withdrawals = raw.withdrawals.filter(
    (w) => w.timestampSeconds <= raw.origin.timestampSeconds
  );

  return {
    origin: raw.origin,
    vault: raw.vault,
    markets: [...raw.markets].sort((a, b) => (a.marketId < b.marketId ? -1 : 1)),
    dependencyGroups: [...raw.dependencyGroups].sort((a, b) => (a.id < b.id ? -1 : 1)),
    withdrawals,
    gas: raw.gas,
    history,
    lastAction: raw.lastAction,
  };
}
