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
    // No pin registered yet. NOT a safety condition: the market has not
    // changed, the vault simply has not registered what it should look
    // like. Blocks deployment; must never trigger a §9.1 safety unwind (see
    // SAFETY_EXIT_CODES) - the bootstrap artifact ships
    // `pinnedConfigDigests: {}`, so treating this as a safety event would
    // emergency-exit every venue on every cycle.
    code: 'CONFIG_DIGEST_UNPINNED',
    check: (m, _input, artifact) => {
      const pinned = artifact.pinnedConfigDigests[m.marketId];
      return {
        passed: pinned !== undefined,
        detail: pinned === undefined ? 'no pinned digest registered' : `pinned as ${pinned}`,
      };
    },
  },
  {
    // A pin EXISTS and the live digest no longer matches it: the market's
    // implementation or material configuration changed under us. §12 -
    // "Implementation or material configuration change | Quarantine the
    // market and start a new regime". This is a safety condition, and it is
    // why the unpinned case above had to be split off from it: the two
    // shared one code and one `detail` string, so nothing downstream could
    // tell "never registered" from "changed since registration".
    code: 'CONFIG_DIGEST_MISMATCH',
    check: (m, _input, artifact) => {
      const pinned = artifact.pinnedConfigDigests[m.marketId];
      if (pinned === undefined) return { passed: true, detail: 'no pin to contradict' };
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
    // Whole-branch review, Critical 3: snapshot-collector.ts's collectStrategy
    // cannot yet read supplyRate/utilization/cash for any protocol and
    // hardcodes all three to 0n ("Would need protocol-specific calls"). A
    // market reporting a literal zero rate AND zero cash AND zero borrows
    // simultaneously is that placeholder signature, not a plausible live
    // venue state (a real pool at zero cash/borrows would also report the
    // IRM's base rate, not exactly zero). Refuse to admit it rather than
    // let a flat-zero curve flow through the rest of the kernel and produce
    // a HOLD that looks like a considered decision instead of "the pipeline
    // cannot see this market". decide() additionally surfaces a distinct
    // top-level NO_MARKET_DATA reason when this fires for every market.
    code: 'NO_MARKET_DATA',
    check: (m) => {
      const ok = !(m.supplyRateWad === 0n && m.cash === 0n && m.borrows === 0n);
      return {
        passed: ok,
        detail: ok
          ? `supplyRateWad=${m.supplyRateWad} cash=${m.cash} borrows=${m.borrows}`
          : 'no usable rate/liquidity data: supplyRateWad, cash and borrows are all zero -- treated as an ' +
            'unreadable market (see snapshot-collector.ts), not a real zero-yield/zero-liquidity venue',
      };
    },
  },
  {
    code: 'NO_SYNC_LIQUIDITY',
    check: (m) => {
      // At zero position there is nothing to withdraw yet, so the gate is
      // whether the protocol has room to accept a deposit (cash > 0); once a
      // position exists, maxWithdrawableBase (the venue's synchronous exit
      // capacity) is the operative figure. The branch predates
      // maxWithdrawableBase being a capacity rather than min(position, cash)
      // and is now redundant rather than load-bearing, but it is kept: it
      // still states the intended rule, and it is the only thing standing
      // between a caller that supplies the old min(position, cash) reading
      // and a permanently un-enterable venue.
      const ok = m.positionBase === 0n ? m.cash > 0n : m.maxWithdrawableBase > 0n;
      return {
        passed: ok,
        detail: `cash=${m.cash} maxWithdrawable=${m.maxWithdrawableBase} position=${m.positionBase}`,
      };
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
  {
    code: 'DEPENDENCY_UNREGISTERED',
    // §6.2 — every dependency group the market claims membership of must be
    // a group the vault actually has configured. A market referencing a
    // group the vault doesn't know about is a configuration error, not a
    // pool the allocator can safely reason about jointly with its peers.
    check: (m, input) => {
      const registered = new Set(input.dependencyGroups.map((g) => g.id));
      const missing = m.dependencyGroupIds.filter((id) => !registered.has(id));
      const ok = missing.length === 0;
      return {
        passed: ok,
        detail: ok
          ? `dependency groups registered: [${m.dependencyGroupIds.join(', ')}]`
          : `unregistered dependency groups: [${missing.join(', ')}]`,
      };
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
