# Quarantined evaluation code

Nothing in this directory calls `src/policy/decide.ts`.

Each module here is an independent reimplementation of some part of the
policy — allocation, cost, forecasting, the reserve — so an "SRCLA vs B\*"
delta computed from it is not a measurement of the SRCLA policy. The
2026-09-08 readiness audit (NEW-2, NEW-12) found that:

- `srcla-policy.ts` imported exactly one production symbol (`GreedyAllocator`)
  and implemented none of the amendments P2/P4/P5;
- `baselines/b2-capacity.ts` sorted on the *displayed* rate and contained no
  post-deposit curve, despite its docstring;
- `baselines/b5-hindsight.ts` read a `futureReturn` field that does not exist
  on `MarketSnapshot` and silently degraded to the current rate, i.e. to B2;
- `baselines/b4-fixed-robust.ts` re-sorted by live rate on every call —
  neither fixed nor robust;
- `ablations/types.ts` states that H1–H5 "are ablation studies based on B2",
  so they ablate B2 rather than SRCLA; H1/H2 are swapped relative to the
  paper, H4 and H5 test different hypotheses, and `h5Policy` is `b2Policy`
  under another name (its own comment says so). H6 and H7 do not exist.

It is kept rather than deleted because it is the provenance of the figures in
`SRCLA-REPORT.md` / `SRCLA-REPORT.json`, and reproducing a published number
needs the code that produced it.

Every entry point calls `assertQuarantineOptIn` at module scope, so importing
one throws unless `SRCLA_ALLOW_QUARANTINED_HARNESS=1` is set.

**Use `src/evaluation/kernel/harness.ts#runRegisteredEvaluation` instead.** It
runs B0–B5, B2u and H1–H7 as switch settings on the single kernel in
`src/policy/decide.ts`.
