# expo-wallet UX: loading & error handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the expo-wallet app consistent, non-silent loading and error UX via a shared async-state layer and reusable presentational primitives.

**Architecture:** A pure `asyncReducer` state machine (unit-tested) drives a thin `useAsync` React hook. A pure `mapError` turns any failure into `{title, detail}`. Presentational primitives (`ErrorState`, `SkeletonList`, `StaleChip`, intent-aware `Toast`) render the states. Screens adopt the hook + primitives so loading/error states become non-optional.

**Tech Stack:** Expo SDK 54, React Native, TypeScript, Jest. Verify RN/Expo APIs against installed `node_modules` `.d.ts` (see `expo-wallet/AGENTS.md`).

**Reference spec:** `docs/superpowers/specs/2026-07-26-client-ux-loading-errors-design.md`

---

## File Structure

- Create `expo-wallet/src/lib/ui/asyncReducer.ts` — pure state machine (loading/refreshing/error/staleError).
- Create `expo-wallet/src/lib/ui/asyncReducer.test.ts` — reducer unit tests.
- Create `expo-wallet/src/lib/ui/useAsync.ts` — thin React hook around the reducer.
- Create `expo-wallet/src/lib/ui/mapError.ts` — generic failure → `MappedError`.
- Create `expo-wallet/src/lib/ui/mapError.test.ts` — mapper unit tests.
- Modify `expo-wallet/src/lib/wallet/sendErrors.ts` — delegate generic tail to `mapError`.
- Create `expo-wallet/src/ui/ErrorState.tsx` — icon + title + detail + Retry.
- Create `expo-wallet/src/ui/SkeletonList.tsx` — N skeleton rows.
- Create `expo-wallet/src/ui/StaleChip.tsx` — "Couldn't refresh · Retry" pill.
- Modify `expo-wallet/src/ui/Toast.tsx` — add `intent` (info|success|error).
- Modify screens: `app/(tabs)/home.tsx`, `app/(tabs)/history.tsx`, `app/(tabs)/farming.tsx`, `app/(tabs)/assistant.tsx`, `app/pay/[orderId].tsx`, `app/send.tsx`, `app/login.tsx`.

`MappedError` is defined once in `sendErrors.ts` (`{ title: string; detail: string }`) and re-exported from `mapError.ts`; every module imports it from there — do not redefine it.

---

## Task 1: `MappedError` type + generic `mapError`

**Files:**
- Create: `expo-wallet/src/lib/ui/mapError.ts`
- Test: `expo-wallet/src/lib/ui/mapError.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// expo-wallet/src/lib/ui/mapError.test.ts
import { mapError } from './mapError';

describe('mapError', () => {
  it('maps network/timeout failures', () => {
    expect(mapError(new Error('Network request failed')).title).toBe('Network problem');
    expect(mapError(new Error('fetch timeout')).title).toBe('Network problem');
  });

  it('maps 404 / not found', () => {
    expect(mapError(new Error('Navy API /x failed (HTTP 404)')).title).toBe('Not found');
  });

  it('maps 5xx / server errors', () => {
    expect(mapError(new Error('Navy API /x failed (HTTP 503)')).title).toBe('Server problem');
    expect(mapError(new Error('failed (HTTP 500)')).title).toBe('Server problem');
  });

  it('maps auth/session loss', () => {
    expect(mapError(new Error('Navy API /x failed (HTTP 401)')).title).toBe('Session expired');
  });

  it('falls back with a truncated message', () => {
    const m = mapError(new Error('something odd happened'));
    expect(m.title).toBe("Something went wrong");
    expect(m.detail).toContain('something odd');
  });

  it('handles non-Error input', () => {
    expect(mapError(undefined).title).toBe('Something went wrong');
    expect(mapError('boom').detail).toContain('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd expo-wallet && pnpm test mapError`
Expected: FAIL — `Cannot find module './mapError'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// expo-wallet/src/lib/ui/mapError.ts
export interface MappedError { title: string; detail: string }

/** Turn any load/read failure (network, RPC, backend 4xx/5xx) into friendly, actionable text. */
export function mapError(raw: unknown): MappedError {
  const msg = ((raw as any)?.message ?? String(raw ?? '')).toString();
  const m = msg.toLowerCase();

  if (m.includes('http 401') || m.includes('unauthorized') || m.includes('sign out') || m.includes('signed out')) {
    return { title: 'Session expired', detail: 'Please sign in again to continue.' };
  }
  if (m.includes('http 404') || m.includes('not found')) {
    return { title: 'Not found', detail: "We couldn't find what you were looking for." };
  }
  if (/http 5\d\d/.test(m) || m.includes('server error')) {
    return { title: 'Server problem', detail: 'Something went wrong on our side. Please try again in a moment.' };
  }
  if (m.includes('network') || m.includes('timeout') || m.includes('fetch') || m.includes('econn') || m.includes('offline')) {
    return { title: 'Network problem', detail: 'Could not reach the network. Check your connection and retry.' };
  }
  return { title: 'Something went wrong', detail: msg ? msg.slice(0, 140) : 'Please try again.' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd expo-wallet && pnpm test mapError`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/lib/ui/mapError.ts expo-wallet/src/lib/ui/mapError.test.ts
git commit -m "feat(expo): generic mapError for load/read failures"
```

---

## Task 2: delegate `mapSendError`'s generic tail to `mapError`

**Files:**
- Modify: `expo-wallet/src/lib/wallet/sendErrors.ts`

- [ ] **Step 1: Update the fallback to reuse `mapError`**

Replace the final `return { title: "Couldn't send", ... }` line so the generic tail is shared. Keep every transfer-specific branch above it unchanged. New final lines of `mapSendError`:

```ts
  // Transfer-specific branches above stay as-is. Generic tail delegates:
  const generic = mapError(raw);
  // Preserve the send-flavoured label for the truly-unknown case.
  if (generic.title === 'Something went wrong') return { title: "Couldn't send", detail: generic.detail };
  return generic;
}
```

Add the import at the top of `sendErrors.ts`:

```ts
import { mapError } from '../ui/mapError';
```

Keep `export interface MappedError` in `sendErrors.ts` as the canonical definition, and make `mapError.ts` import it instead of redefining. Update `mapError.ts` line 1 to:

```ts
import type { MappedError } from '../wallet/sendErrors';
export type { MappedError };
```

- [ ] **Step 2: Run existing send-error tests**

Run: `cd expo-wallet && pnpm test sendErrors mapError`
Expected: PASS — existing `sendErrors` behavior preserved, `mapError` still green.

- [ ] **Step 3: Typecheck**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add expo-wallet/src/lib/wallet/sendErrors.ts expo-wallet/src/lib/ui/mapError.ts
git commit -m "refactor(expo): share generic error tail between mapSendError and mapError"
```

---

## Task 3: pure `asyncReducer` state machine

**Files:**
- Create: `expo-wallet/src/lib/ui/asyncReducer.ts`
- Test: `expo-wallet/src/lib/ui/asyncReducer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// expo-wallet/src/lib/ui/asyncReducer.test.ts
import { asyncReducer, initialAsyncState, AsyncStateShape } from './asyncReducer';

const err = { title: 'X', detail: 'y' };

describe('asyncReducer', () => {
  it('starts with no data as loading', () => {
    const s0 = initialAsyncState<number>();
    expect(s0.loading).toBe(false);
    const s1 = asyncReducer(s0, { type: 'start' });
    expect(s1).toMatchObject({ loading: true, refreshing: false, error: undefined });
  });

  it('start with existing data is a refresh, not a blanking load', () => {
    const withData: AsyncStateShape<number> = { ...initialAsyncState<number>(), data: 7 };
    const s = asyncReducer(withData, { type: 'start' });
    expect(s).toMatchObject({ loading: false, refreshing: true, data: 7 });
  });

  it('success clears everything and stores data', () => {
    const s = asyncReducer(asyncReducer(initialAsyncState<number>(), { type: 'start' }), { type: 'success', data: 42 });
    expect(s).toMatchObject({ data: 42, loading: false, refreshing: false, error: undefined, staleError: undefined });
  });

  it('failure with NO data becomes a blocking error', () => {
    const s = asyncReducer(asyncReducer(initialAsyncState<number>(), { type: 'start' }), { type: 'failure', error: err });
    expect(s).toMatchObject({ data: undefined, error: err, staleError: undefined, loading: false });
  });

  it('failure WITH data becomes staleError and keeps data', () => {
    const withData: AsyncStateShape<number> = { ...initialAsyncState<number>(), data: 7 };
    const started = asyncReducer(withData, { type: 'start' });
    const s = asyncReducer(started, { type: 'failure', error: err });
    expect(s).toMatchObject({ data: 7, staleError: err, error: undefined });
  });

  it('setData replaces data (optimistic update)', () => {
    const withData: AsyncStateShape<number> = { ...initialAsyncState<number>(), data: 1 };
    expect(asyncReducer(withData, { type: 'setData', data: 2 }).data).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd expo-wallet && pnpm test asyncReducer`
Expected: FAIL — `Cannot find module './asyncReducer'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// expo-wallet/src/lib/ui/asyncReducer.ts
import type { MappedError } from './mapError';

export interface AsyncStateShape<T> {
  data: T | undefined;
  loading: boolean;      // first load, no data yet
  refreshing: boolean;   // re-fetch while data is present
  error: MappedError | undefined;      // blocking: no data to show
  staleError: MappedError | undefined; // non-blocking: refresh failed, data present
}

export type AsyncAction<T> =
  | { type: 'start' }
  | { type: 'success'; data: T }
  | { type: 'failure'; error: MappedError }
  | { type: 'setData'; data: T | undefined };

export function initialAsyncState<T>(): AsyncStateShape<T> {
  return { data: undefined, loading: false, refreshing: false, error: undefined, staleError: undefined };
}

export function asyncReducer<T>(state: AsyncStateShape<T>, action: AsyncAction<T>): AsyncStateShape<T> {
  switch (action.type) {
    case 'start': {
      const hasData = state.data !== undefined;
      return { ...state, loading: !hasData, refreshing: hasData, error: undefined, staleError: undefined };
    }
    case 'success':
      return { data: action.data, loading: false, refreshing: false, error: undefined, staleError: undefined };
    case 'failure': {
      const hasData = state.data !== undefined;
      return hasData
        ? { ...state, loading: false, refreshing: false, staleError: action.error, error: undefined }
        : { ...state, loading: false, refreshing: false, error: action.error, staleError: undefined };
    }
    case 'setData':
      return { ...state, data: action.data };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd expo-wallet && pnpm test asyncReducer`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/lib/ui/asyncReducer.ts expo-wallet/src/lib/ui/asyncReducer.test.ts
git commit -m "feat(expo): pure asyncReducer state machine for fetch state"
```

---

## Task 4: `useAsync` hook (thin React wrapper)

**Files:**
- Create: `expo-wallet/src/lib/ui/useAsync.ts`

This is a thin hook (verified by tsc, not unit-tested — the logic lives in the tested reducer). Cancellation is via a monotonically increasing request id, so a superseded or unmounted fetch cannot commit state.

- [ ] **Step 1: Write the hook**

```ts
// expo-wallet/src/lib/ui/useAsync.ts
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { asyncReducer, initialAsyncState, AsyncStateShape } from './asyncReducer';
import { mapError } from './mapError';

export interface UseAsyncResult<T> extends AsyncStateShape<T> {
  retry: () => void;
  setData: (updater: (prev: T | undefined) => T | undefined) => void;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  opts: { poll?: number; deps?: unknown[] } = {},
): UseAsyncResult<T> {
  const { poll, deps = [] } = opts;
  const [state, dispatch] = useReducer(asyncReducer as typeof asyncReducer<T>, undefined, initialAsyncState<T>);
  const reqId = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const id = ++reqId.current;
    dispatch({ type: 'start' });
    try {
      const data = await fnRef.current();
      if (id === reqId.current) dispatch({ type: 'success', data });
    } catch (e) {
      if (id === reqId.current) dispatch({ type: 'failure', error: mapError(e) });
    }
  }, []);

  // Initial load + reload when deps change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, deps);

  // Optional polling.
  useEffect(() => {
    if (!poll) return;
    const t = setInterval(() => { void run(); }, poll);
    return () => clearInterval(t);
  }, [poll, run]);

  // Invalidate any in-flight request on unmount so it can't set state.
  useEffect(() => () => { reqId.current++; }, []);

  const setData = useCallback((updater: (prev: T | undefined) => T | undefined) => {
    dispatch({ type: 'setData', data: updater(stateRef.current.data) });
  }, []);
  const stateRef = useRef(state);
  stateRef.current = state;

  return { ...state, retry: run, setData };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add expo-wallet/src/lib/ui/useAsync.ts
git commit -m "feat(expo): useAsync hook wrapping asyncReducer with cancellation"
```

---

## Task 5: `ErrorState` component

**Files:**
- Create: `expo-wallet/src/ui/ErrorState.tsx`

- [ ] **Step 1: Read siblings for style**

Read `expo-wallet/src/ui/Card.tsx`, `Button.tsx`, `Text.tsx`, `theme.ts`, and the existing pay-error block in `app/pay/[orderId].tsx:112-123` (IconBadge/danger usage) so the new component matches the existing visual language and imports (`colors`, `space`, `radius`, `Button`, `Text`).

- [ ] **Step 2: Write the component**

```tsx
// expo-wallet/src/ui/ErrorState.tsx
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { MappedError } from '../lib/ui/mapError';
import { Button } from './Button';
import { Text } from './Text';
import { colors, space } from './theme';

interface Props {
  error: MappedError;
  onRetry?: () => void;
  compact?: boolean;
}

/** Full or inline error panel with an optional Retry. Use for load failures. */
export function ErrorState({ error, onRetry, compact }: Props) {
  return (
    <View style={[styles.wrap, compact ? styles.compact : styles.full]}>
      <Text variant={compact ? 'body' : 'h2'} color={colors.textHi} style={styles.title}>
        {error.title}
      </Text>
      <Text variant="caption" color={colors.textLo} style={styles.detail}>
        {error.detail}
      </Text>
      {onRetry && (
        <View style={styles.action}>
          <Button variant="secondary" label="Retry" onPress={onRetry} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  full: { flex: 1, justifyContent: 'center', padding: space.xl },
  compact: { paddingVertical: space.lg, paddingHorizontal: space.md },
  title: { textAlign: 'center', marginBottom: space.xs },
  detail: { textAlign: 'center', maxWidth: 320 },
  action: { marginTop: space.lg },
});
```

Note: confirm the `Button` prop name (`label` vs `title`/children) and `Text` `variant` values against the actual files read in Step 1; adjust to match. Confirm `space.xs/md/lg/xl` keys exist in `theme.ts`.

- [ ] **Step 3: Typecheck**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add expo-wallet/src/ui/ErrorState.tsx
git commit -m "feat(expo): ErrorState component with Retry"
```

---

## Task 6: `SkeletonList` + `StaleChip`

**Files:**
- Create: `expo-wallet/src/ui/SkeletonList.tsx`
- Create: `expo-wallet/src/ui/StaleChip.tsx`

- [ ] **Step 1: Read `Skeleton.tsx`** for its prop API (`width`/`height`/`radius`).

- [ ] **Step 2: Write `SkeletonList`**

```tsx
// expo-wallet/src/ui/SkeletonList.tsx
import React from 'react';
import { View } from 'react-native';
import { Skeleton } from './Skeleton';
import { space } from './theme';

/** N stacked skeleton rows for loading lists (history, farming, home). */
export function SkeletonList({ rows = 4, height = 56 }: { rows?: number; height?: number }) {
  return (
    <View style={{ gap: space.md }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </View>
  );
}
```

Confirm `Skeleton`'s prop names against the file; if it requires `width`, pass `width="100%"`.

- [ ] **Step 3: Write `StaleChip`**

```tsx
// expo-wallet/src/ui/StaleChip.tsx
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, radius, space } from './theme';

/** Small non-blocking pill shown when a background refresh failed but data is still visible. */
export function StaleChip({ onRetry }: { onRetry: () => void }) {
  return (
    <Pressable style={styles.chip} onPress={onRetry} accessibilityRole="button">
      <Text variant="caption" color={colors.textLo}>Couldn't refresh · Retry</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill ?? radius.md,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
});
```

Confirm `radius.pill` exists; if not, use `radius.md` and drop the `??`.

- [ ] **Step 4: Typecheck**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/ui/SkeletonList.tsx expo-wallet/src/ui/StaleChip.tsx
git commit -m "feat(expo): SkeletonList and StaleChip primitives"
```

---

## Task 7: `Toast` intent support

**Files:**
- Modify: `expo-wallet/src/ui/Toast.tsx`

- [ ] **Step 1: Extend the context value + provider**

Change the context type from `(msg: string) => void` to accept an optional intent, keeping backward compatibility (existing `toast('...')` calls still work):

```tsx
export type ToastIntent = 'info' | 'success' | 'error';
const Ctx = createContext<(msg: string, intent?: ToastIntent) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}
```

In the provider, track intent and pick a border color + duration. Replace the `toast` callback and the `msg` state:

```tsx
const [state, setState] = useState<{ msg: string; intent: ToastIntent } | null>(null);
// ...
const toast = useCallback((m: string, intent: ToastIntent = 'info') => {
  if (timerRef.current !== null) clearTimeout(timerRef.current);
  setState({ msg: m, intent });
  Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  const dwell = intent === 'error' ? 4600 : 3200;
  timerRef.current = setTimeout(() => {
    Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true })
      .start(() => setState(null));
  }, dwell);
}, [opacity]);
```

Render with an intent-based left border color (reuse `colors.danger` for error, `colors.success`/accent for success, default border otherwise). Update the `{msg !== null && ...}` guard to `{state !== null && ...}` and read `state.msg` / `state.intent`.

- [ ] **Step 2: Typecheck + existing toast callers still compile**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: no errors (existing single-arg `toast('...')` calls remain valid).

- [ ] **Step 3: Commit**

```bash
git add expo-wallet/src/ui/Toast.tsx
git commit -m "feat(expo): intent-aware Toast (info/success/error)"
```

---

## Screen adoption (Tasks 8–14)

Each screen task follows the **same canonical pattern**. Read the current screen first, then apply:

**Canonical adoption pattern** — replace a hand-rolled fetch block:

```tsx
// BEFORE (typical):
const [data, setData] = useState<T>();
const [loading, setLoading] = useState(true);
useEffect(() => { setLoading(true); client.fetch().then(setData).catch(...).finally(() => setLoading(false)); }, []);

// AFTER:
const { data, loading, error, staleError, retry } = useAsync(() => client.fetch(), { poll: 4000 /* if it polled */ });

if (loading) return <SkeletonList rows={5} />;      // or existing hero skeleton
if (error) return <ErrorState error={error} onRetry={retry} />;   // blocking: no data
return (
  <>
    {staleError && <StaleChip onRetry={retry} />}     // non-blocking: keep showing data
    {/* existing content rendered from data */}
  </>
);
```

Rules:
- **Never** leave a `.catch` that swallows into an empty render. Load failures MUST reach `error`.
- Preserve the existing content JSX; only swap the state plumbing and add the skeleton/error/stale branches.
- Verify each screen with `pnpm exec tsc --noEmit` (screens are not unit-tested per CLAUDE.md).
- Import primitives from `../../src/ui/...` / `../../src/lib/ui/...` (confirm the relative depth per file location under `app/`).

### Task 8: `app/(tabs)/history.tsx`
**Files:** Modify `expo-wallet/app/(tabs)/history.tsx`
- [ ] Read the file. It currently loads payments into a list with an ad-hoc skeleton and a **silent** empty state on failure.
- [ ] Convert the payments fetch to `useAsync`. On `loading` render `SkeletonList`. On `error` (no data) render `<ErrorState error={error} onRetry={retry} />`. Keep pull-to-refresh wired to `retry`. If it polls, pass `poll`.
- [ ] Ensure a genuinely-empty (but successful) result still shows the existing "no payments yet" empty state — distinct from `error`.
- [ ] Run `cd expo-wallet && pnpm exec tsc --noEmit` → no errors.
- [ ] Commit: `git commit -am "feat(expo): history uses useAsync — no more silent load failures"`

### Task 9: `app/(tabs)/home.tsx`
**Files:** Modify `expo-wallet/app/(tabs)/home.tsx`
- [ ] Read the file. Balances + prices load with a hero skeleton; a failed price fetch currently shows nothing.
- [ ] Wrap the balance/price load in `useAsync`. Keep the existing hero `Skeleton` for `loading`. On `error` render a compact `<ErrorState compact error={error} onRetry={retry} />` in the hero area. On `staleError` render `<StaleChip onRetry={retry} />` so a partial refresh failure is visible while last-good balances stay.
- [ ] Run `cd expo-wallet && pnpm exec tsc --noEmit` → no errors.
- [ ] Commit: `git commit -am "feat(expo): home surfaces balance/price load + refresh failures"`

### Task 10: `app/(tabs)/farming.tsx`
**Files:** Modify `expo-wallet/app/(tabs)/farming.tsx`
- [ ] Read the file. Position loads with a hero skeleton; fund/withdraw errors currently only flash a 3.2s toast.
- [ ] Convert the position load to `useAsync` (keep hero skeleton for `loading`, `ErrorState` for `error`).
- [ ] For fund/withdraw actions: keep the `Button loading` state, but on failure set a **persistent** inline `<ErrorState compact error={mapSendError(e)} onRetry={...} />` near the action (not just a toast). Show a `toast(msg, 'success')` on success.
- [ ] Run `cd expo-wallet && pnpm exec tsc --noEmit` → no errors.
- [ ] Commit: `git commit -am "feat(expo): farming shows persistent fund/withdraw errors + success toast"`

### Task 11: `app/pay/[orderId].tsx`
**Files:** Modify `expo-wallet/app/pay/[orderId].tsx`
- [ ] Read the file. Invoice load has a centered spinner; invoice-not-found has a bespoke error block; **submission** has no visible progress/error.
- [ ] Convert invoice load to `useAsync`; replace the bespoke not-found block with `<ErrorState error={error} onRetry={retry} />` (keep the "invoice not found" copy via `mapError` fallback or an explicit message).
- [ ] For the pay/submit action: disable the button + show `Button loading` during submit; on failure show a persistent compact `ErrorState` (via `mapSendError`) with Retry; on success keep existing success flow.
- [ ] Run `cd expo-wallet && pnpm exec tsc --noEmit` → no errors.
- [ ] Commit: `git commit -am "feat(expo): pay screen shows submit progress + persistent errors"`

### Task 12: `app/send.tsx`
**Files:** Modify `expo-wallet/app/send.tsx`
- [ ] Read the file. It already has a good error card (`phase==='error'`) using `mapSendError`, plus inline recipient errors.
- [ ] Minimal change: route any remaining raw error strings through `mapSendError`/`mapError`; ensure recipient-resolution failure is visually distinct from send failure (it already uses inline captions — keep). Add `onRetry` to the error card if not present.
- [ ] Run `cd expo-wallet && pnpm exec tsc --noEmit` → no errors.
- [ ] Commit: `git commit -am "feat(expo): send routes all errors through the shared mapper"`

### Task 13: `app/(tabs)/assistant.tsx`
**Files:** Modify `expo-wallet/app/(tabs)/assistant.tsx`
- [ ] Read the file. SSE errors dispatch into the chat; transfer/farming confirmation failures only change card state.
- [ ] On a stream error, in addition to the existing chat dispatch, show a `toast(mapError(e).detail, 'error')` so the user gets an immediate, dismissible signal. For confirm-card action failures, surface `mapSendError(e)` inside the card (immediate, actionable) rather than only delegating back to the model.
- [ ] Run `cd expo-wallet && pnpm exec tsc --noEmit` → no errors.
- [ ] Commit: `git commit -am "feat(expo): assistant surfaces immediate actionable errors"`

### Task 14: `app/login.tsx`
**Files:** Modify `expo-wallet/app/login.tsx`
- [ ] Read the file. Auth failures show only a transient toast.
- [ ] Add a persistent inline `<ErrorState compact error={mapError(e)} onRetry={submit} />` (or an inline caption + Retry) beneath the form so a failed login stays visible with a retry affordance. Keep the `Button loading` state.
- [ ] Run `cd expo-wallet && pnpm exec tsc --noEmit` → no errors.
- [ ] Commit: `git commit -am "feat(expo): login shows persistent error + retry"`

---

## Final verification

- [ ] `cd expo-wallet && pnpm test` → all unit tests pass (mapError, sendErrors, asyncReducer, existing suites).
- [ ] `cd expo-wallet && pnpm exec tsc --noEmit` → no type errors.
- [ ] Manual smoke (device/dev client): airplane-mode a load to confirm `ErrorState` + Retry appears (not a blank/empty screen); trigger a poll failure to confirm `StaleChip` shows while data persists.
