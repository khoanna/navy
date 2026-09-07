import type { AdmissionResult, DecisionInput, MarketObservation, PolicyArtifact } from '../types.js';

const WAD = 10n ** 18n;
/** Utilisation above this is treated as past the kink for admission purposes. */
const MAX_ADMISSIBLE_UTILIZATION_WAD = (WAD * 99n) / 100n;

interface Rule {
  code: string;
  check(m: MarketObservation, input: DecisionInput, artifact: PolicyArtifact): { passed: boolean; detail: string };
}

const RULES: Rule[] = [
  {
    code: 'PAUSED',
    check: (m) => ({ passed: !m.paused, detail: m.paused ? 'market paused' : 'active' }),
  },
  {
    code: 'CONFIG_DIGEST_UNPINNED',
    check: (m, _input, artifact) => {
      const pinned = artifact.pinnedConfigDigests[m.marketId];
      if (pinned === undefined) {
        return { passed: false, detail: 'no pinned digest registered' };
      }
      const ok = pinned === m.configDigest;
      return { passed: ok, detail: ok ? 'digest matches pin' : `digest ${m.configDigest} != pin ${pinned}` };
    },
  },
  {
    code: 'REGIME_MIN_HISTORY',
    check: (m, input, artifact) => {
      const n = input.history.filter((l) => l.marketId === m.marketId && l.regimeId === m.regimeId).length;
      return { passed: n >= artifact.minObservations, detail: `${n} completed labels in regime ${m.regimeId}` };
    },
  },
  {
    code: 'NO_SYNC_LIQUIDITY',
    check: (m) => {
      const ok = m.positionBase === 0n ? m.cash > 0n : m.maxWithdrawableBase > 0n;
      return { passed: ok, detail: `maxWithdrawable=${m.maxWithdrawableBase} position=${m.positionBase}` };
    },
  },
  {
    code: 'CAP_ZERO',
    check: (m) => {
      const ok = m.capBps > 0 && m.absoluteCapBase > 0n && m.maxDeployableBase > 0n;
      return { passed: ok, detail: `capBps=${m.capBps} abs=${m.absoluteCapBase} headroom=${m.maxDeployableBase}` };
    },
  },
  {
    code: 'KINK_EXCEEDED',
    check: (m) => {
      const ok = m.utilizationWad <= MAX_ADMISSIBLE_UTILIZATION_WAD;
      return { passed: ok, detail: `utilization=${m.utilizationWad}` };
    },
  },
];

/**
 * Paper §6.2 — a market is deployable only when every registered check passes
 * at the decision origin. Failing any one rule makes the market ineligible;
 * every rule's outcome (pass or fail) is recorded so a rejection is always
 * explainable from the persisted reasons.
 *
 * Pure: takes only the already-filtered DecisionInput and the pinned artifact,
 * no I/O, no clock, no randomness. Markets are processed in sorted marketId
 * order so `eligible` and `reasons` are deterministic byte-for-byte.
 */
export function admit(input: DecisionInput, artifact: PolicyArtifact): AdmissionResult {
  const reasons: AdmissionResult['reasons'] = [];
  const eligible: string[] = [];

  const markets = [...input.markets].sort((a, b) => (a.marketId < b.marketId ? -1 : a.marketId > b.marketId ? 1 : 0));

  for (const m of markets) {
    let ok = true;
    for (const rule of RULES) {
      const r = rule.check(m, input, artifact);
      reasons.push({ marketId: m.marketId, code: rule.code, passed: r.passed, detail: r.detail });
      if (!r.passed) ok = false;
    }
    if (ok) {
      reasons.push({ marketId: m.marketId, code: 'OK', passed: true, detail: 'admitted' });
      eligible.push(m.marketId);
    }
  }

  return { eligible, reasons };
}
