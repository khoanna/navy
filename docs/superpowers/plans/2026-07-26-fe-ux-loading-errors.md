# fe UX: loading & error handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the fe (admin/merchant web) app consistent, non-silent loading and error UX via a shared async-state layer, a toast system, and reusable presentational primitives.

**Architecture:** A pure `asyncReducer` state machine (unit-tested) drives a thin `useAsync` client hook. A pure `mapError` surfaces `NavyApiError.detail` or maps by status. New `Toast`, `ErrorState`, `Skeleton`/`SkeletonList` primitives plus route `error.tsx` boundaries render the states. Pages adopt the hook + primitives; the 4s polls now surface failures instead of swallowing them.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Jest. `fe` jest only runs `src/lib/**/*.test.ts`. Verify Next APIs against `node_modules/next/dist/docs/` (see `fe/AGENTS.md`).

**Reference spec:** `docs/superpowers/specs/2026-07-26-client-ux-loading-errors-design.md`

---

## File Structure

- Create `fe/src/lib/asyncReducer.ts` + `fe/src/lib/asyncReducer.test.ts` — pure state machine.
- Create `fe/src/lib/useAsync.ts` — thin `'use client'` hook.
- Create `fe/src/lib/mapError.ts` + `fe/src/lib/mapError.test.ts` — failure → `MappedError`, surfacing `NavyApiError.detail`.
- Create `fe/src/ui/Toast.tsx` — `ToastProvider` + `useToast` (client).
- Modify `fe/src/app/layout.tsx` — mount `ToastProvider`.
- Create `fe/src/ui/ErrorState.tsx` — icon + copy + Retry.
- Create `fe/src/ui/Skeleton.tsx` + `fe/src/ui/SkeletonList.tsx`.
- Create `fe/src/app/admin/error.tsx` + `fe/src/app/merchant/error.tsx` — segment error boundaries.
- Modify pages: `app/admin/page.tsx`, `app/merchant/page.tsx`, `app/merchant/orders/page.tsx`, `app/merchant/orders/[id]/page.tsx`, `app/merchant/products/page.tsx`, `app/merchant/settings/*`, `app/merchant/WalletConnect.tsx`, `app/admin/merchants/[id]/Actions.tsx`, login pages, and forms (route errors through `mapError`; success → toast).

`MappedError` (`{ title: string; detail: string }`) is defined in `mapError.ts` and imported everywhere; do not redefine it.

---

## Task 1: `mapError` (surfaces `NavyApiError.detail`)

**Files:**
- Create: `fe/src/lib/mapError.ts`
- Test: `fe/src/lib/mapError.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// fe/src/lib/mapError.test.ts
import { mapError } from './mapError';
import { NavyApiError } from './navyApi';

describe('mapError', () => {
  it('prefers the backend detail when present', () => {
    const e = new NavyApiError('Navy API /x failed (HTTP 400)', 400, 'businessName should not be empty');
    expect(mapError(e).detail).toBe('businessName should not be empty');
  });

  it('maps 401 to a session message', () => {
    expect(mapError(new NavyApiError('x', 401)).title).toBe('Session expired');
  });

  it('maps 5xx to a server message', () => {
    expect(mapError(new NavyApiError('x', 503)).title).toBe('Server problem');
  });

  it('maps generic network errors', () => {
    expect(mapError(new TypeError('Failed to fetch')).title).toBe('Network problem');
  });

  it('falls back for unknown input', () => {
    expect(mapError(undefined).title).toBe('Something went wrong');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fe && pnpm test mapError`
Expected: FAIL — `Cannot find module './mapError'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// fe/src/lib/mapError.ts
import { NavyApiError } from './navyApi';

export interface MappedError { title: string; detail: string }

/** Turn any client failure into friendly, actionable copy — preferring the backend's detail. */
export function mapError(raw: unknown): MappedError {
  if (raw instanceof NavyApiError) {
    if (raw.status === 401 || raw.status === 403) {
      return { title: 'Session expired', detail: raw.detail ?? 'Please sign in again to continue.' };
    }
    if (raw.status >= 500) {
      return { title: 'Server problem', detail: raw.detail ?? 'Something went wrong on our side. Please try again.' };
    }
    if (raw.status === 404) {
      return { title: 'Not found', detail: raw.detail ?? "We couldn't find what you were looking for." };
    }
    // 4xx with a validation detail — surface it directly.
    return { title: 'Please check the details', detail: raw.detail ?? `Request failed (${raw.status}).` };
  }

  const msg = ((raw as any)?.message ?? String(raw ?? '')).toString();
  const m = msg.toLowerCase();
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('timeout') || m.includes('load failed')) {
    return { title: 'Network problem', detail: 'Could not reach the server. Check your connection and retry.' };
  }
  return { title: 'Something went wrong', detail: msg ? msg.slice(0, 160) : 'Please try again.' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd fe && pnpm test mapError`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/mapError.ts fe/src/lib/mapError.test.ts
git commit -m "feat(fe): mapError surfacing NavyApiError.detail"
```

---

## Task 2: pure `asyncReducer`

**Files:**
- Create: `fe/src/lib/asyncReducer.ts`
- Test: `fe/src/lib/asyncReducer.test.ts`

This is identical in behavior to the expo reducer. Use the same test + implementation as `docs/superpowers/plans/2026-07-26-expo-ux-loading-errors.md` Task 3, with one change: the `import type { MappedError }` path is `'./mapError'` (fe co-locates the type in `mapError.ts`).

- [ ] **Step 1: Write the failing test** — copy the `asyncReducer.test.ts` from the expo plan Task 3 verbatim, changing the import to `import { asyncReducer, initialAsyncState, AsyncStateShape } from './asyncReducer';` (same relative path).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fe && pnpm test asyncReducer`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation** — copy the `asyncReducer.ts` body from the expo plan Task 3 verbatim, changing line 1 to:

```ts
import type { MappedError } from './mapError';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd fe && pnpm test asyncReducer`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/asyncReducer.ts fe/src/lib/asyncReducer.test.ts
git commit -m "feat(fe): pure asyncReducer state machine"
```

---

## Task 3: `useAsync` hook

**Files:**
- Create: `fe/src/lib/useAsync.ts`

- [ ] **Step 1: Write the hook** — copy the `useAsync.ts` body from the expo plan Task 4 verbatim, with two changes: (a) add `'use client';` as the first line (Next.js requires it for hooks using state/effects), (b) imports resolve from `'./asyncReducer'` and `'./mapError'` (same directory).

```ts
'use client';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { asyncReducer, initialAsyncState, AsyncStateShape } from './asyncReducer';
import { mapError } from './mapError';
// ... rest identical to expo plan Task 4 (UseAsyncResult, useAsync) ...
```

- [ ] **Step 2: Typecheck**

Run: `cd fe && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe/src/lib/useAsync.ts
git commit -m "feat(fe): useAsync client hook"
```

---

## Task 4: `Toast` system

**Files:**
- Create: `fe/src/ui/Toast.tsx`
- Modify: `fe/src/app/layout.tsx`

- [ ] **Step 1: Read** `fe/src/ui/Bits.tsx` (for `IconBadge`/`Pill` tone colors), `fe/src/ui/Text.tsx`, and `fe/src/app/layout.tsx` to match styling + confirm where providers mount.

- [ ] **Step 2: Write the Toast provider** (mirrors expo's API)

```tsx
// fe/src/ui/Toast.tsx
'use client';
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

export type ToastIntent = 'info' | 'success' | 'error';
type ToastFn = (msg: string, intent?: ToastIntent) => void;

const Ctx = createContext<ToastFn>(() => {});
export function useToast(): ToastFn { return useContext(Ctx); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; intent: ToastIntent } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ToastFn>((msg, intent = 'info') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, intent });
    const dwell = intent === 'error' ? 4600 : 3200;
    timer.current = setTimeout(() => setToast(null), dwell);
  }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <div role="status" data-intent={toast.intent} style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, maxWidth: 420, padding: '12px 18px', borderRadius: 12,
          background: 'var(--surface-hi, #16181d)', color: 'var(--text-hi, #fff)',
          border: `1px solid ${toast.intent === 'error' ? 'var(--danger, #e5484d)'
            : toast.intent === 'success' ? 'var(--success, #30a46c)' : 'var(--border-strong, #333)'}`,
          boxShadow: '0 12px 32px rgba(0,0,0,.4)',
        }}>
          {toast.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}
```

Adjust the CSS variable names / inline styles to match the project's existing theme tokens (read `Bits.tsx` / global CSS). If the app uses CSS modules or a `colors` object rather than CSS vars, use those instead.

- [ ] **Step 3: Mount the provider in the root layout**

In `fe/src/app/layout.tsx`, wrap the existing `{children}` (inside `<body>`) with `<ToastProvider>`. `ToastProvider` is a client component; mounting it in a server layout is fine (it renders `children` through). Import: `import { ToastProvider } from '@/ui/Toast';` (confirm the import alias used elsewhere in the app).

- [ ] **Step 4: Typecheck + build**

Run: `cd fe && pnpm exec tsc --noEmit && pnpm build`
Expected: no errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add fe/src/ui/Toast.tsx fe/src/app/layout.tsx
git commit -m "feat(fe): Toast system mounted in root layout"
```

---

## Task 5: `ErrorState` + `Skeleton`/`SkeletonList`

**Files:**
- Create: `fe/src/ui/ErrorState.tsx`
- Create: `fe/src/ui/Skeleton.tsx`
- Create: `fe/src/ui/SkeletonList.tsx`

- [ ] **Step 1: Read** `fe/src/ui/Button.tsx`, `Bits.tsx`, `Text.tsx` for the visual language + `Button` prop API.

- [ ] **Step 2: Write `ErrorState`**

```tsx
// fe/src/ui/ErrorState.tsx
'use client';
import React from 'react';
import type { MappedError } from '@/lib/mapError';
import { Button } from './Button';

export function ErrorState({ error, onRetry, compact }: {
  error: MappedError; onRetry?: () => void; compact?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      gap: 8, padding: compact ? '16px' : '48px 24px',
    }}>
      <strong style={{ fontSize: compact ? 15 : 18 }}>{error.title}</strong>
      <span style={{ opacity: 0.7, maxWidth: 360 }}>{error.detail}</span>
      {onRetry && <div style={{ marginTop: 8 }}><Button variant="secondary" onClick={onRetry}>Retry</Button></div>}
    </div>
  );
}
```

Confirm `Button`'s prop for the click handler and label (children vs `label`) against the file; adjust. Prefer the project's `Text`/`Bits` components over raw `<strong>`/`<span>` if they exist.

- [ ] **Step 3: Write `Skeleton` + `SkeletonList`**

```tsx
// fe/src/ui/Skeleton.tsx
import React from 'react';

export function Skeleton({ height = 16, width = '100%', radius = 8 }: {
  height?: number | string; width?: number | string; radius?: number;
}) {
  return (
    <span aria-hidden style={{
      display: 'block', height, width, borderRadius: radius,
      background: 'linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.10), rgba(255,255,255,.04))',
      backgroundSize: '200% 100%', animation: 'navy-skeleton 1.4s ease-in-out infinite',
    }} />
  );
}
```

```tsx
// fe/src/ui/SkeletonList.tsx
import React from 'react';
import { Skeleton } from './Skeleton';

export function SkeletonList({ rows = 4, height = 48 }: { rows?: number; height?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} height={height} />)}
    </div>
  );
}
```

Add the keyframes once to the global stylesheet (find it — likely `fe/src/app/globals.css`):

```css
@keyframes navy-skeleton { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
```

- [ ] **Step 4: Typecheck + build**

Run: `cd fe && pnpm exec tsc --noEmit && pnpm build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add fe/src/ui/ErrorState.tsx fe/src/ui/Skeleton.tsx fe/src/ui/SkeletonList.tsx fe/src/app/globals.css
git commit -m "feat(fe): ErrorState + Skeleton/SkeletonList primitives"
```

---

## Task 6: segment `error.tsx` boundaries

**Files:**
- Create: `fe/src/app/admin/error.tsx`
- Create: `fe/src/app/merchant/error.tsx`

- [ ] **Step 1: Read** the Next 16 error-boundary contract in `node_modules/next/dist/docs/` (an `error.tsx` must be a Client Component exporting a default `({ error, reset }) => ...`).

- [ ] **Step 2: Write both files** (same content, one per segment)

```tsx
// fe/src/app/admin/error.tsx   (and fe/src/app/merchant/error.tsx)
'use client';
import { ErrorState } from '@/ui/ErrorState';
import { mapError } from '@/lib/mapError';

export default function SegmentError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <ErrorState error={mapError(error)} onRetry={reset} />
    </div>
  );
}
```

- [ ] **Step 3: Build**

Run: `cd fe && pnpm build`
Expected: build succeeds; both routes register an error boundary.

- [ ] **Step 4: Commit**

```bash
git add fe/src/app/admin/error.tsx fe/src/app/merchant/error.tsx
git commit -m "feat(fe): admin + merchant segment error boundaries"
```

---

## Page adoption (Tasks 7–13)

**Canonical pattern** — for client pages that fetch:

```tsx
'use client';
const { data, loading, error, staleError, retry } = useAsync(async () => {
  const res = await fetch('/api/merchant/stats');
  if (!res.ok) throw new NavyApiError('stats failed', res.status, /* detail if parsed */);
  return res.json();
}, { poll: 4000 /* only where a 4s poll exists today */ });

if (loading) return <SkeletonList rows={5} />;
if (error) return <ErrorState error={error} onRetry={retry} />;
return (<>
  {staleError && <button onClick={retry} /* small "Couldn't refresh · Retry" chip */>Couldn't refresh · Retry</button>}
  {/* existing content from data */}
</>);
```

Rules:
- Replace hand-rolled `useState` + `setInterval` fetch blocks with `useAsync`. **Only one** polling mechanism per page after migration.
- A failed fetch MUST throw (so `useAsync` maps it) — never `.catch(() => {})` into an empty render.
- Where a detail is parseable from the response body, throw `new NavyApiError(msg, status, detail)` so `mapError` surfaces it.
- Success mutations (approve/reject/delete/save) call `toast('...', 'success')`; failures show inline `ErrorState` or `toast(mapError(e).detail, 'error')`.
- Verify each page with `pnpm exec tsc --noEmit` and `pnpm build` (fe screens are not unit-tested).

### Task 7: `app/admin/page.tsx` (dashboard)
- [ ] Read the file. Stats load with a "Couldn't load metrics" caption and null values; no skeleton.
- [ ] Convert stats fetch to `useAsync({ poll })`. `loading` → `SkeletonList`/skeleton cards. `error` → `ErrorState` + Retry. `staleError` → inline stale chip (keep last-good stats visible).
- [ ] `cd fe && pnpm exec tsc --noEmit && pnpm build` → clean.
- [ ] Commit: `git commit -am "feat(fe): admin dashboard skeletons + visible poll failures"`

### Task 8: `app/merchant/page.tsx` (dashboard)
- [ ] Read the file. Same shape as admin (4s poll, "showing what we have" caption).
- [ ] Same conversion: `useAsync({ poll: 4000 })`, skeleton/error/stale branches. Preserve the trend chart + orders sections rendered from `data`.
- [ ] `cd fe && pnpm exec tsc --noEmit && pnpm build` → clean.
- [ ] Commit: `git commit -am "feat(fe): merchant dashboard skeletons + visible poll failures"`

### Task 9: `app/merchant/orders/page.tsx` + `app/merchant/orders/[id]/page.tsx`
- [ ] Read both. Orders list + detail poll every 4s and fail silently; detail shows "Loading…" text.
- [ ] Convert both to `useAsync({ poll: 4000 })`. List: skeleton rows while loading, `ErrorState` on load failure, stale chip on poll failure. Detail: replace "Loading…" text with skeletons; `ErrorState` on failure.
- [ ] `cd fe && pnpm exec tsc --noEmit && pnpm build` → clean.
- [ ] Commit: `git commit -am "feat(fe): orders list + detail no longer fail silently"`

### Task 10: `app/merchant/products/page.tsx`
- [ ] Read the file. List load + delete/archive give no feedback.
- [ ] Convert list load to `useAsync`. For delete/archive: reuse `Modal` for a confirm dialog; on success `toast('Product archived', 'success')` and optimistically `setData`; on failure `toast(mapError(e).detail, 'error')`.
- [ ] `cd fe && pnpm exec tsc --noEmit && pnpm build` → clean.
- [ ] Commit: `git commit -am "feat(fe): products confirm + success/error feedback"`

### Task 11: `app/merchant/WalletConnect.tsx` (+ `WalletConnectClient.tsx`)
- [ ] Read both. Currently bare status text, no button disable during connect/sign.
- [ ] Disable the connect/sign buttons + show `Button loading` during each async step. On failure render inline `<ErrorState compact error={mapError(e)} onRetry={...} />`. On success `toast('Payout wallet connected', 'success')`.
- [ ] `cd fe && pnpm exec tsc --noEmit && pnpm build` → clean.
- [ ] Commit: `git commit -am "feat(fe): WalletConnect loading + inline errors + success toast"`

### Task 12: `app/merchant/settings/*` + `app/admin/merchants/[id]/Actions.tsx` + forms
- [ ] Read `ChargesPanel.tsx`, `ApiKeyPanel.tsx`, `settings/page.tsx`, `Actions.tsx`, `NewInvoiceForm.tsx`, `ProductForm.tsx`.
- [ ] Route every error caption through `mapError` (so backend `detail` shows consistently instead of "Failed (405)"). On successful mutations (save charges, generate key, approve/reject merchant, create invoice/product) fire `toast('...', 'success')`. Keep existing `Button loading`.
- [ ] `cd fe && pnpm exec tsc --noEmit && pnpm build` → clean.
- [ ] Commit: `git commit -am "feat(fe): consistent mapError + success toasts across forms/actions"`

### Task 13: login pages (`app/admin/login/page.tsx`, `app/merchant/login/page.tsx`)
- [ ] Read both. Admin shows a generic "Invalid credentials or TOTP"; merchant shows backend detail.
- [ ] Route both through `mapError` so a `NavyApiError.detail` (e.g. specific validation) shows when the backend provides one; keep the generic fallback for 401. Keep `Button loading`. Error stays inline + persistent (already is) — just improve the copy source.
- [ ] `cd fe && pnpm exec tsc --noEmit && pnpm build` → clean.
- [ ] Commit: `git commit -am "feat(fe): login pages use mapError for clearer auth failures"`

---

## Final verification

- [ ] `cd fe && pnpm test` → `mapError` + `asyncReducer` suites pass (fe jest only runs `src/lib/**`).
- [ ] `cd fe && pnpm exec tsc --noEmit` → no type errors.
- [ ] `cd fe && pnpm build` → build succeeds (all pages + error boundaries compile).
- [ ] Manual smoke: stop the backend/proxy, load a dashboard → `ErrorState` + Retry (not blank/null values); with data loaded, cause a poll failure → stale chip shows while last-good data remains.
