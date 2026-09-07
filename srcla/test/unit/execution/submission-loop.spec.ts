import { jest } from '@jest/globals';
import { runSubmissionLoop } from '../../../src/execution/submission-loop.js';
import type { PlanDraft } from '../../../src/policy/types.js';

function draft(n: number): PlanDraft {
  return {
    planId: '0x2a', decisionHash: '0x99', merkleRoot: '0x01',
    actions: Array.from({ length: n }, (_, i) => ({
      index: i, kind: 0 as const, adapter: '0xaa',
      amountBase: 1_000_000n, minOutBase: 999_000n, dataHash: '0x00', proof: [],
    })),
    header: {
      planId: 42n, policyVersion: 5n, createdAt: 0n, expiresAt: 10n, actionCount: BigInt(n),
      snapshotBlockNumber: 1n, snapshotHash: '0xef', decisionHash: '0x99', configurationDigest: '0xcd',
      reserve: 0n, minFinalAssets: 0n, maxRecognizedLoss: 0n, turnoverLimit: 0n,
    },
  };
}

/**
 * Every dependency is a jest.fn wrapping its default behavior, so a test can
 * inspect not just call ORDER (via the shared `calls` log) but the exact
 * planId/index ARGUMENTS each dependency actually received, and how many
 * times it was called — Task 15 review Findings 2 and 3: a mock that only
 * records "persist happened" without recording what it was called with
 * would pass even for a hardcoded, swapped, or dropped planId/index, and
 * without a call-count assertion a duplicated persist or a double release
 * is undetectable.
 */
function deps(over: Partial<Parameters<typeof runSubmissionLoop>[1]> = {}) {
  const calls: string[] = [];
  const base = {
    acquireLock: jest.fn(async (_planId: string) => { calls.push('lock'); return true; }),
    persistIntent: jest.fn(async (_planId: string, i: number) => { calls.push(`persist:${i}`); }),
    verifyChain: jest.fn(async () => { calls.push('verify'); return { ok: true as const }; }),
    simulate: jest.fn(async (_planId: string, i: number) => { calls.push(`sim:${i}`); return { ok: true as const }; }),
    submit: jest.fn(async (_planId: string, i: number) => { calls.push(`submit:${i}`); return { ok: true as const, txHash: `0x${i}` }; }),
    reconcile: jest.fn(async (_planId: string, i: number) => { calls.push(`recon:${i}`); return { ok: true as const }; }),
    releaseLock: jest.fn(async (_planId: string) => { calls.push('unlock'); }),
    ...over,
  };
  return { deps: base, calls };
}

describe('runSubmissionLoop', () => {
  it('refuses to start when the lock is held', async () => {
    const { deps: d } = deps({ acquireLock: async () => false });
    const r = await runSubmissionLoop(draft(2), d);
    expect(r.completed).toBe(0);
    expect(r.errors.join(' ')).toMatch(/lock/i);
  });

  it('persists intent before submitting, for every action', async () => {
    const { deps: d, calls } = deps();
    await runSubmissionLoop(draft(2), d);
    // Presence, not just relative order: a dropped persistIntent call would
    // leave indexOf at -1, which is "less than" any submit index too, so an
    // order-only assertion can't tell "before" apart from "never happened".
    expect(calls).toContain('persist:0');
    expect(calls).toContain('persist:1');
    expect(calls.indexOf('persist:0')).toBeLessThan(calls.indexOf('submit:0'));
    expect(calls.indexOf('persist:1')).toBeLessThan(calls.indexOf('submit:1'));
  });

  it('simulates before submitting each action', async () => {
    const { deps: d, calls } = deps();
    await runSubmissionLoop(draft(1), d);
    expect(calls).toContain('sim:0');
    expect(calls.indexOf('sim:0')).toBeLessThan(calls.indexOf('submit:0'));
  });

  it('submits exactly one action at a time and reconciles each', async () => {
    const { deps: d, calls } = deps();
    const r = await runSubmissionLoop(draft(3), d);
    expect(r.completed).toBe(3);
    // Presence: verifyChain must actually run once per action, not just be
    // wired but never invoked.
    expect(calls.filter((c) => c === 'verify')).toHaveLength(3);
    expect(calls.filter((c) => c.startsWith('submit:'))).toEqual(['submit:0', 'submit:1', 'submit:2']);
    expect(calls.filter((c) => c.startsWith('recon:'))).toEqual(['recon:0', 'recon:1', 'recon:2']);
  });

  it('stops the plan when an action reverts, leaving later actions unsubmitted', async () => {
    const { deps: d, calls } = deps({
      submit: async (_p, i) => {
        calls.push(`submit:${i}`);
        return i === 1 ? { ok: false as const, error: 'revert' } : { ok: true as const, txHash: `0x${i}` };
      },
    });
    const r = await runSubmissionLoop(draft(3), d);
    expect(r.completed).toBe(1);
    expect(r.stoppedAt).toBe(1);
    // The real proof that the plan stopped: action 2's submit dependency was
    // never invoked at all — not merely that the summary says "failed".
    expect(calls).not.toContain('submit:2');
    expect(calls.filter((c) => c.startsWith('submit:'))).toEqual(['submit:0', 'submit:1']);
  });

  it('stops when reconciliation diverges from chain truth', async () => {
    const { deps: d, calls } = deps({ reconcile: async () => ({ ok: false as const, error: 'balance delta mismatch' }) });
    const r = await runSubmissionLoop(draft(2), d);
    expect(r.stoppedAt).toBe(0);
    expect(r.errors.join(' ')).toMatch(/mismatch/);
    // A divergent reconcile on action 0 must not let action 1 proceed.
    expect(calls).not.toContain('submit:1');
  });

  it('does not submit when chain verification fails', async () => {
    const { deps: d, calls } = deps({ verifyChain: async () => ({ ok: false as const, error: 'chainId mismatch' }) });
    const r = await runSubmissionLoop(draft(2), d);
    expect(r.completed).toBe(0);
    expect(calls.some((c) => c.startsWith('submit:'))).toBe(false);
  });

  it('always releases the lock, even after a submission failure', async () => {
    const { deps: d, calls } = deps({ submit: async () => ({ ok: false as const, error: 'boom' }) });
    await runSubmissionLoop(draft(1), d);
    expect(calls[calls.length - 1]).toBe('unlock');
  });

  it('releases the lock even when a dependency throws instead of returning a failure', async () => {
    // This is the case a bare "try { ... } await releaseLock()" (i.e. no
    // finally) would silently get wrong: nothing throws in the happy path or
    // in the ok:false paths above, so those alone can't distinguish a real
    // finally from code that merely runs releaseLock after the loop. Only an
    // exception mid-loop exposes the difference, because without a finally
    // the throw would propagate past the release call entirely.
    const { deps: d, calls } = deps({
      simulate: async () => { throw new Error('rpc exploded'); },
    });
    await expect(runSubmissionLoop(draft(2), d)).rejects.toThrow('rpc exploded');
    expect(calls).toContain('lock');
    expect(calls[calls.length - 1]).toBe('unlock');
    // And the exception must have stopped the loop before it reached the
    // never-called submit/reconcile steps for action 0.
    expect(calls).not.toContain('submit:0');
  });

  // Task 15 review, Finding 2: the fixtures above only proved ordering —
  // every mock ignored its planId/index arguments, so a hardcoded, swapped,
  // or dropped planId or index would have passed all of them.
  it('passes the plan\'s planId and each action\'s index to persistIntent, simulate, submit, and reconcile', async () => {
    const { deps: d } = deps();
    await runSubmissionLoop(draft(2), d);

    expect(d.acquireLock).toHaveBeenCalledWith('0x2a');
    expect(d.releaseLock).toHaveBeenCalledWith('0x2a');
    // verifyChain takes no arguments at all -- confirms nothing is silently
    // threading a planId/index through it that the type doesn't allow.
    expect(d.verifyChain).toHaveBeenCalledWith();

    expect(d.persistIntent).toHaveBeenNthCalledWith(1, '0x2a', 0);
    expect(d.persistIntent).toHaveBeenNthCalledWith(2, '0x2a', 1);
    expect(d.simulate).toHaveBeenNthCalledWith(1, '0x2a', 0);
    expect(d.simulate).toHaveBeenNthCalledWith(2, '0x2a', 1);
    expect(d.submit).toHaveBeenNthCalledWith(1, '0x2a', 0);
    expect(d.submit).toHaveBeenNthCalledWith(2, '0x2a', 1);
    expect(d.reconcile).toHaveBeenNthCalledWith(1, '0x2a', 0);
    expect(d.reconcile).toHaveBeenNthCalledWith(2, '0x2a', 1);
  });

  // Task 15 review, Finding 3: no fixture asserted exact call counts for
  // persistIntent/releaseLock, so a duplicated persist or a double release
  // was undetectable.
  it('calls persistIntent exactly once per action and releaseLock exactly once, on a full successful run', async () => {
    const { deps: d } = deps();
    await runSubmissionLoop(draft(3), d);
    expect(d.persistIntent).toHaveBeenCalledTimes(3);
    expect(d.releaseLock).toHaveBeenCalledTimes(1);
    expect(d.acquireLock).toHaveBeenCalledTimes(1);
  });

  it('calls persistIntent only for attempted actions, and releaseLock exactly once, when the plan stops early', async () => {
    const { deps: d } = deps({
      submit: jest.fn(async (_p: string, i: number) =>
        i === 1 ? { ok: false as const, error: 'revert' } : { ok: true as const, txHash: `0x${i}` }
      ),
    });
    await runSubmissionLoop(draft(3), d);
    // Actions 0 and 1 were attempted (persisted before their submit ran);
    // action 2 was never reached, so persistIntent must not have run a
    // third time, and releaseLock must still have run exactly once (not
    // zero, not twice).
    expect(d.persistIntent).toHaveBeenCalledTimes(2);
    expect(d.releaseLock).toHaveBeenCalledTimes(1);
  });
});
