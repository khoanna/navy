# Quarantined harnesses

## `evaluation-v2/`

The `.mjs` harness that produced `SRCLA-REPORT.md` and `SRCLA-REPORT.json`.

It imports **nothing** from `src/`. It carries its own allocator
(`evaluate.mjs:45`), its own cost model (`:68`), its own forecasters and its
own reserve rule, so the "SRCLA vs B\*" deltas it reports are not
measurements of the policy in `src/policy/decide.ts`. The 2026-09-08
readiness audit (NEW-2, NEW-12, NEW-13, NEW-15) also found that it:

- fixes all nine forecast candidates at `q=0.05` with no horizon and no
  coverage axis (`main.mjs:11-14`) — the defect amendment P1 exists to fix;
- runs B2 **unreserved** (`replay.mjs:31-32`) and has no `B2u`; B3 omits the
  reserve rather than the dependency policy; H6 and H7 cannot exist because
  its allocator has neither a liquidity cap nor a phi term;
- computes a Welch table (`main.mjs:87-98`) that the gate list never
  references, on **gross** returns with a lump cost subtracted after the
  loop;
- runs three tiers, not §11.1's four, with gates written as
  `TIERS.every(...)` so the missing 10,000 tier cannot fail anything;
- runs a stress predicate that never removes any assets, and gates on the
  optimistic variant while discarding the conservative one it computed.

It is kept because it is the provenance of published figures. `main.mjs`
refuses to run unless `SRCLA_ALLOW_QUARANTINED_HARNESS=1` is set.

**Use `src/evaluation/kernel/harness.ts#runRegisteredEvaluation` instead** —
it runs B0–B5, B2u and H1–H7 as switch settings on the one kernel in
`src/policy/decide.ts`.
