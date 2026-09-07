import type { PlanDraft } from '../policy/types.js';

export interface SubmissionDeps {
  acquireLock: (planId: string) => Promise<boolean>;
  persistIntent: (planId: string, index: number) => Promise<void>;
  verifyChain: () => Promise<{ ok: true } | { ok: false; error: string }>;
  simulate: (planId: string, index: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  submit: (planId: string, index: number) => Promise<{ ok: true; txHash: string } | { ok: false; error: string }>;
  reconcile: (planId: string, index: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  releaseLock: (planId: string) => Promise<void>;
}

/**
 * §10.3 — for every action: obtain a lock, persist before signing, verify
 * chain identity and nonce, simulate against pending state, submit exactly one
 * action, reconcile receipt and balance deltas, then advance or stop.
 *
 * A reverted or divergent action stops later plan actions. A database state
 * never overrides confirmed chain state, which is why reconcile runs after
 * every submission and its failure halts the plan.
 *
 * The lock is released on every exit path — normal completion, an early stop,
 * or a thrown exception from any dependency — via `finally`. This function
 * performs no I/O of its own; every effect arrives through `deps`.
 */
export async function runSubmissionLoop(
  draft: PlanDraft,
  deps: SubmissionDeps
): Promise<{ completed: number; stoppedAt: number | null; errors: string[] }> {
  const errors: string[] = [];

  if (!(await deps.acquireLock(draft.planId))) {
    return { completed: 0, stoppedAt: null, errors: ['execution lock held by another worker'] };
  }

  let completed = 0;
  let stoppedAt: number | null = null;

  try {
    for (const action of draft.actions) {
      // Persist intent BEFORE signing/submitting — this is what makes a
      // mid-submission crash recoverable: a durable record that the attempt
      // happened exists before any signature is produced.
      await deps.persistIntent(draft.planId, action.index);

      const chain = await deps.verifyChain();
      if (!chain.ok) {
        errors.push(`action ${action.index}: chain verification failed: ${chain.error}`);
        stoppedAt = action.index;
        break;
      }

      const sim = await deps.simulate(draft.planId, action.index);
      if (!sim.ok) {
        errors.push(`action ${action.index}: simulation failed: ${sim.error}`);
        stoppedAt = action.index;
        break;
      }

      // Exactly one action submitted per iteration — no batching.
      const sent = await deps.submit(draft.planId, action.index);
      if (!sent.ok) {
        errors.push(`action ${action.index}: submission failed: ${sent.error}`);
        stoppedAt = action.index;
        break;
      }

      const rec = await deps.reconcile(draft.planId, action.index);
      if (!rec.ok) {
        // A divergent balance delta is as fatal as a failed submission —
        // continuing on a false view of chain state is worse than stopping.
        errors.push(`action ${action.index}: reconciliation failed: ${rec.error}`);
        stoppedAt = action.index;
        break;
      }

      completed++;
    }
  } finally {
    await deps.releaseLock(draft.planId);
  }

  return { completed, stoppedAt, errors };
}
