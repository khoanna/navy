# Client UX: consistent loading & error handling

**Date:** 2026-07-26
**Status:** Design approved
**Scope:** `expo-wallet/` (payer mobile wallet) + `fe/` (admin/merchant web)

## Problem

Both client apps have decent UI primitives but inconsistent, and sometimes
missing, loading and error UX. Concretely:

- **expo-wallet** has `Toast`, `Skeleton`, `Button` (with a `loading` prop), and
  `mapSendError`. But every screen hand-rolls its own `loading` / `error` /
  `refreshing` `useState`, and read failures often go **silent** (home balances,
  history) or **vanish** in a 3.2s toast (farming fund/withdraw).
- **fe** has `NavyApiError` (which carries a human-readable backend `detail`) and
  `Button` (with `loading`). But it has **no** toast system, **no** skeletons
  (just "Loading…" text and null-value flashes), **no** error boundary, and its
  4-second polls (orders, dashboard stats) **fail silently**.

The root cause in both apps is the same: **there is no shared async-state
layer.** Each screen reinvents fetch-state handling, so quality is per-author and
drifts over time.

## Goals

1. **Kill silent failures** — every load/poll failure is visible, with a Retry
   affordance, instead of an empty or stale screen.
2. **Consistent loading** — skeletons/spinners wherever data loads; add skeletons
   to `fe`.
3. **Better error copy** — human-readable, actionable messages everywhere
   (generalize `mapSendError`; always surface `NavyApiError.detail` in `fe`).
4. **Persistent vs. transient** — errors that need a decision persist; transient
   success/info uses a toast (add a toast system to `fe`).

## Non-goals (YAGNI)

- No data-fetching library (TanStack Query / SWR). Heavy dependency in a Next 16
  and Expo SDK-54 app; the app's needs are modest and the repo explicitly warns
  about SDK drift.
- No global state manager.
- No automatic retry/backoff — **manual Retry only**.
- No offline queue.
- No redesign of the existing visual language — we adopt the current
  theme / `Bits` / `Button` styles.

## Approach (chosen)

A shared **async-state hook** plus a small set of **presentational primitives**
and **pure error mappers**, adopted across both apps. This makes the loading and
error states non-optional (they come from the hook), which fixes silent failures
*structurally* rather than screen-by-screen.

Alternatives rejected: per-screen manual fixes (drifts again — the current
problem); a data-fetching library (over-heavy, SDK-drift risk).

## Design

### 1. Async-state hook — the spine

One hook per app, in the plain-TS lib layer so it is framework-light and
unit-testable:

- `expo-wallet/src/lib/ui/useAsync.ts`
- `fe/src/lib/useAsync.ts`

```ts
type AsyncState<T> = {
  data: T | undefined;
  loading: boolean;      // first load, no data yet
  refreshing: boolean;   // manual refresh / re-fetch while data is present
  error: MappedError | undefined; // set only when there is no valid data to show
  staleError: MappedError | undefined; // poll/refresh failed but data is present
  retry: () => void;     // re-run fn, clears error
  setData: (updater: (prev: T | undefined) => T | undefined) => void; // optimistic updates
};

useAsync<T>(
  fn: () => Promise<T>,
  opts?: { poll?: number; deps?: unknown[] },
): AsyncState<T>;
```

**Behavior contract** (this is what kills silent failures):

- **First load fails** → `loading:false, data:undefined, error:<mapped>` → screen
  renders `ErrorState` + Retry.
- **Poll/refresh fails but data exists** → keep `data`, set `staleError` → screen
  keeps showing last-good data plus a subtle "Couldn't refresh" chip. It **never
  blanks**.
- `poll` replaces the current hand-rolled `setInterval` polling in `fe` (orders,
  dashboard stats), but now a poll failure is visible via `staleError`.
- A **cancellation / staleness guard** ensures an unmounted screen or a
  superseded fetch cannot set state (track the latest request; ignore older
  resolutions).
- `retry()` clears `error` and re-runs `fn`; while re-running with data present it
  uses `refreshing`.

The mapper (below) is applied inside the hook, so `error` / `staleError` are
always already `MappedError` when they reach the UI.

### 2. Error-mapping contracts

Every failure becomes `MappedError = { title: string; detail: string }` before
the UI sees it.

**expo-wallet:**
- Keep `src/lib/wallet/sendErrors.ts::mapSendError` as the transfer-specific
  specialization.
- Add a broader `mapError(raw)` (in `src/lib/ui/` or `src/lib/wallet/`) that also
  covers load failures: network/timeout, sign-out-after-401, 404 not-found, 5xx,
  and a generic fallback. `mapSendError` delegates to `mapError` for its generic
  tail so the two stay consistent.

**fe:**
- New `fe/src/lib/mapError.ts` — accepts `NavyApiError | Error | unknown`.
  When a `NavyApiError.detail` is present, surface it (so backend validation
  messages show); otherwise map by status/shape to friendly copy. This makes
  detail-extraction the **single default path**, fixing the "some pages show
  detail, others show 'Failed (405)'" inconsistency.

Both mappers are **pure functions with unit tests**, following the existing
`sendErrors` style and the repo's "logic in plain-TS modules" rule.

### 3. Presentational primitives

**expo-wallet (`src/ui/`):**
- `ErrorState` — icon badge + `title` + `detail` + `Retry` button. Full-screen and
  inline (`compact`) variants. For load failures on home / history / farming /
  pay.
- `SkeletonList` — thin wrapper over the existing `Skeleton` for N rows.
  Consolidates the ad-hoc skeletons in home/history/farming.
- `StaleChip` — small inline "Couldn't refresh · Retry" pill, driven by
  `staleError`.
- `Toast` — **reuse** the existing provider, extended with an `intent`
  (`info` | `success` | `error`) for consistent styling and a slightly longer
  duration for errors. Stays transient / non-blocking.

**fe (`src/ui/`):**
- `Toast` + `ToastProvider` — **new**, mounted in `app/layout.tsx`. Mirrors
  expo's API (`useToast()` → `toast(msg, intent)`). For success confirmations
  and transient/secondary errors.
- `ErrorState` — icon + copy + Retry, matching the existing `Bits` / `IconBadge`
  visual language.
- `Skeleton` + `SkeletonList` — **new** for `fe`; replaces "Loading…" text and
  null-value flashes on dashboards, orders, and order detail.
- `error.tsx` route error boundaries for the `app/admin/` and `app/merchant/`
  segments — a last-resort catch that shows a branded retry page instead of a
  blank crash.

### 4. Persistent vs. transient rules

A single rule applied everywhere:

- **Persistent** (`ErrorState` / inline caption / `StaleChip`): anything that
  blocks the user from seeing content or completing the current step — failed
  initial load, form validation, a submit that failed and needs a retry decision.
  Stays until resolved.
- **Toast**: transient outcomes that don't block — success confirmations
  ("Merchant approved", "Product saved", "Copied"), and background/secondary
  errors ("Couldn't refresh balances"). Auto-dismisses.
- **WalletConnect** (`fe`, currently bare status text): gets real button-disable +
  spinner during connect/sign, an inline `ErrorState` on failure, and a toast on
  success.

### 5. Per-screen adoption

**expo-wallet:**
- `home` — balances/prices partial-failure indicator (USDC shows but ETH price
  failed must be visible); `SkeletonList` for the loading hero/rows.
- `history` — load error + skeleton; no more silent empty list.
- `farming` — persistent fund/withdraw errors via `ErrorState`, not just a 3.2s
  toast.
- `send` — keep the error card; route failures through `mapError`/`mapSendError`.
- `pay/[orderId]` — submission progress + error state (submission currently has
  no visible feedback).
- `assistant` — immediate actionable error alongside the existing chat-handoff.
- `login` — retry affordance for failed auth.

**fe:**
- admin dashboard + merchant dashboard — skeletons + poll-failure chip
  (`staleError`) + Retry.
- orders list & order detail — skeletons; kill silent load failures.
- products — delete/archive success + error feedback; reuse `Modal` for a
  confirm dialog.
- settings / WalletConnect — loading + error (see §4).
- all forms — route errors through `mapError`; success actions emit toasts.

### 6. Testing

- Unit tests (jest, plain-TS): `useAsync` (both apps) and `mapError` (both apps).
- UI screens verified via `pnpm exec tsc --noEmit` + `pnpm build` (per CLAUDE.md,
  screens / chain / Privy calls are not unit-tested).

### 7. Rollout (phased for reviewability)

- **Phase 1** — shared primitives + hooks + mappers, with unit tests. No screen
  changes yet.
- **Phase 2** — expo-wallet screen adoption.
- **Phase 3** — fe screen adoption.

This maps to either two implementation plans (one per app) that share the
Phase-1 spec, or one plan with three phases — decided in writing-plans.

## Risks / notes

- Expo is pinned to **SDK 54** and `fe` to a newer Next 16 — verify component
  APIs against installed `node_modules` types, not training-data memory
  (`expo-wallet/AGENTS.md`, `fe/AGENTS.md`).
- The fe `ToastProvider` must be a client component mounted in the root layout
  without breaking server components below it.
- `useAsync`'s `poll` replaces existing `setInterval` polls — ensure only one
  polling mechanism per screen after migration.
