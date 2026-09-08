/**
 * Import guard for the quarantined evaluation reimplementations.
 *
 * Everything under `src/evaluation/quarantined/` is a SECOND implementation
 * of the policy: its own allocator, its own cost model, its own forecaster,
 * its own reserve rule. `src/policy/decide.ts` — the module that actually
 * implements amendments P1-P8 and the H1-H7 switches — has no caller here.
 * Numbers produced by this code are therefore not measurements of the SRCLA
 * policy, and SRCLA-REPORT.md's figures came from exactly this kind of code.
 *
 * It is kept, not deleted, because it is the provenance of published results
 * and because reproducing a published number requires the code that produced
 * it. It is guarded so nothing can reach it by accident: importing any entry
 * point throws unless the operator has explicitly opted in.
 *
 * The replacement is `src/evaluation/kernel/` (`runRegisteredEvaluation`).
 */
export const QUARANTINE_ENV_VAR = 'SRCLA_ALLOW_QUARANTINED_HARNESS';

export function assertQuarantineOptIn(moduleName: string): void {
  if (process.env[QUARANTINE_ENV_VAR] === '1') return;
  throw new Error(
    `${moduleName} is a QUARANTINED evaluation reimplementation and must not be used to produce ` +
      `results. It does not call src/policy/decide.ts, so it does not measure the SRCLA policy — ` +
      `see src/evaluation/quarantined/README.md. Use runRegisteredEvaluation from ` +
      `src/evaluation/kernel/harness.ts instead. To run it anyway (only to reproduce a previously ` +
      `published number), set ${QUARANTINE_ENV_VAR}=1.`
  );
}
