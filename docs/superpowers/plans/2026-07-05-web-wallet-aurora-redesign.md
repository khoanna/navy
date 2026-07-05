# Web-Wallet Aurora Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the entire Navy web-wallet in the approved dark "Aurora Glass" visual system and drop dead SMS/phone login, without changing business logic.

**Architecture:** Presentation-layer only. Add a small set of reusable `src/ui` primitives (glass card variant, bottom `Sheet`, `SlideToConfirm`, `OtpInput`, `SuccessCheck`, `Skeleton`) plus two pure helpers, then restyle each `src/app` screen to compose them. Pure logic (`src/lib/**`, chain calls, auth) is untouched except removing SMS from the login screen. New pure helpers are unit-tested; UI is verified by `tsc --noEmit` **and** `pnpm build` (the runtime gate per CLAUDE.md).

**Tech Stack:** Next.js 16 (App Router), React 19, inline-style primitives driven by `src/ui/theme.ts` tokens, CSS keyframes in `globals.css`. No new dependencies. Jest for pure-logic tests.

**Reference:** Approved mockups live in `.superpowers/brainstorm/253740-1783224494/content/` (`screenset.html`, `login-v3.html`). Match their layout/copy/hierarchy.

**Working directory:** All paths below are relative to `web-wallet/`. Run `pnpm` commands from inside `web-wallet/`.

**Design tokens already present** (`src/ui/theme.ts`): `colors.{bg,surface,accent,aqua,onAccent,textHi,text,textDim,textMute,border,borderStrong,success,danger,warning}`, `gradients.{ocean,aquaGlow,night}`, `space`, `radius`, `type`. `Text` with `numeric` **already** applies `font-variant-numeric: tabular-nums` — do not re-add it.

---

## Task 1: Foundation — deepen aurora background + glass Card variant

**Files:**
- Modify: `src/app/globals.css` (body background block)
- Modify: `src/ui/Card.tsx`

- [ ] **Step 1: Deepen the aurora glow in globals.css**

Replace the `body` `background:` declaration (currently two faint radial gradients + `var(--bg)`) with the stronger, on-brand aurora from the spec:

```css
body {
  background:
    radial-gradient(130% 55% at 85% -5%, rgba(18,58,122,0.55), transparent 45%),
    radial-gradient(120% 50% at 0% 22%, rgba(10,90,107,0.45), transparent 50%),
    var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  min-height: 100%;
}
```

Also make `.navy-frame` transparent so the body aurora shows through — change its `background: var(--bg);` line to `background: transparent;`.

- [ ] **Step 2: Add a `glass` variant to Card**

In `src/ui/Card.tsx`, extend `CardProps` and apply the glass style. Full replacement:

```tsx
'use client';
import React from 'react';
import { colors, radius, space } from './theme';

export interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** Tighter padding for list-like cards. */
  compact?: boolean;
  elevated?: boolean;
  /** Translucent frosted panel (Aurora Glass surfaces). */
  glass?: boolean;
}

/** A surface panel with a hairline border — the default container for content. */
export function Card({ children, style, compact, elevated, glass }: CardProps) {
  return (
    <div
      style={{
        backgroundColor: glass ? 'rgba(255,255,255,0.055)' : colors.surface,
        backdropFilter: glass ? 'blur(14px)' : undefined,
        WebkitBackdropFilter: glass ? 'blur(14px)' : undefined,
        borderRadius: `${radius.xl}px`,
        border: `1px solid ${glass ? 'rgba(255,255,255,0.09)' : colors.border}`,
        padding: compact ? `${space.lg}px` : `${space.xxl}px`,
        ...(elevated ? { boxShadow: '0 12px 24px rgba(0,0,0,0.45)' } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.
Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css src/ui/Card.tsx
git commit -m "feat(web-wallet): deepen aurora background + glass Card variant"
```

---

## Task 2: Skeleton loading primitive

**Files:**
- Create: `src/ui/Skeleton.tsx`
- Modify: `src/app/globals.css` (add shimmer keyframe)
- Modify: `src/ui/index.ts`

- [ ] **Step 1: Add shimmer keyframe to globals.css**

Append to `src/app/globals.css`:

```css
@keyframes navy-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .navy-fade-in, .navy-skeleton { animation: none !important; }
}
```

- [ ] **Step 2: Create the Skeleton component**

```tsx
'use client';
import React from 'react';
import { radius } from './theme';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  round?: boolean;
  style?: React.CSSProperties;
}

/** A shimmering placeholder block for loading balances/lists. */
export function Skeleton({ width = '100%', height = 16, round, style }: SkeletonProps) {
  return (
    <div
      className="navy-skeleton"
      style={{
        width,
        height,
        borderRadius: round ? '999px' : `${radius.sm}px`,
        background:
          'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.10) 37%, rgba(255,255,255,0.04) 63%)',
        backgroundSize: '200% 100%',
        animation: 'navy-shimmer 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  );
}
```

- [ ] **Step 3: Export from index**

In `src/ui/index.ts`, add: `export * from './Skeleton';`

- [ ] **Step 4: Typecheck + build**

Run: `pnpm exec tsc --noEmit` → no errors.
Run: `pnpm build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Skeleton.tsx src/app/globals.css src/ui/index.ts
git commit -m "feat(web-wallet): Skeleton shimmer primitive"
```

---

## Task 3: Bottom Sheet primitive

**Files:**
- Create: `src/ui/Sheet.tsx`
- Modify: `src/app/globals.css` (slide-up keyframe)
- Modify: `src/ui/index.ts`

- [ ] **Step 1: Add sheet slide-up keyframe to globals.css**

Append:

```css
@keyframes navy-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes navy-scrim-in { from { opacity: 0; } to { opacity: 1; } }
```

- [ ] **Step 2: Create the Sheet component**

```tsx
'use client';
import React from 'react';
import { colors, radius, space } from './theme';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Bottom sheet: a scrim + slide-up panel anchored inside the phone frame.
 * Tapping the scrim (not the panel) closes it. Panel clears the home indicator.
 */
export function Sheet({ open, onClose, children }: SheetProps) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end',
        background: 'rgba(2,4,10,0.55)',
        animation: 'navy-scrim-in 180ms ease both',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          background: colors.bgElevated,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: `${radius.xxl}px ${radius.xxl}px 0 0`,
          padding: `${space.md}px ${space.xl}px calc(${space.xl}px + env(safe-area-inset-bottom))`,
          animation: 'navy-sheet-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
        }}
      >
        <div
          style={{
            width: 38,
            height: 4,
            borderRadius: 9,
            background: 'rgba(255,255,255,0.2)',
            margin: `0 auto ${space.lg}px`,
          }}
        />
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Export from index**

Add to `src/ui/index.ts`: `export * from './Sheet';`

- [ ] **Step 4: Typecheck + build**

Run: `pnpm exec tsc --noEmit` → no errors. Run: `pnpm build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Sheet.tsx src/app/globals.css src/ui/index.ts
git commit -m "feat(web-wallet): bottom Sheet primitive"
```

---

## Task 4: SlideToConfirm primitive (+ pure progress helper)

**Files:**
- Create: `src/lib/ui/slide.ts` (pure helper)
- Create: `src/lib/ui/slide.test.ts`
- Create: `src/ui/SlideToConfirm.tsx`
- Modify: `src/ui/index.ts`

- [ ] **Step 1: Write the failing test for the progress helper**

`src/lib/ui/slide.test.ts`:

```ts
import { clampProgress, isConfirmed } from './slide';

describe('slide progress', () => {
  it('clamps knob travel to 0..1', () => {
    expect(clampProgress(-20, 300)).toBe(0);
    expect(clampProgress(150, 300)).toBe(0.5);
    expect(clampProgress(600, 300)).toBe(1);
  });

  it('treats a zero or negative track as no progress', () => {
    expect(clampProgress(50, 0)).toBe(0);
  });

  it('confirms only at/above the 0.92 threshold', () => {
    expect(isConfirmed(0.91)).toBe(false);
    expect(isConfirmed(0.92)).toBe(true);
    expect(isConfirmed(1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test slide`
Expected: FAIL — cannot find module `./slide`.

- [ ] **Step 3: Implement the helper**

`src/lib/ui/slide.ts`:

```ts
/** Fraction (0..1) of the way the knob has travelled along the track. */
export function clampProgress(offsetPx: number, trackPx: number): number {
  if (trackPx <= 0) return 0;
  const p = offsetPx / trackPx;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** The slider fires once the knob is essentially at the end. */
export function isConfirmed(progress: number): boolean {
  return progress >= 0.92;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test slide`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the SlideToConfirm component**

`src/ui/SlideToConfirm.tsx`:

```tsx
'use client';
import React, { useRef, useState } from 'react';
import { colors, gradients, radius } from './theme';
import { Text } from './Text';
import { Gradient } from './Gradient';
import { Icon } from './Icon';
import { clampProgress, isConfirmed } from '@/lib/ui/slide';

const KNOB = 46;

export interface SlideToConfirmProps {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}

/** Drag-to-confirm control for money-moving actions. Snaps back if released early. */
export function SlideToConfirm({ label, onConfirm, disabled }: SlideToConfirmProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);

  const trackPx = () => (trackRef.current?.offsetWidth ?? 0) - KNOB - 8;

  const move = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw = clientX - rect.left - KNOB / 2;
    const t = trackPx();
    const clamped = Math.max(0, Math.min(raw, t));
    setOffset(clamped);
    if (isConfirmed(clampProgress(clamped, t)) && !done) {
      setDone(true);
      setDragging(false);
      setOffset(t);
      onConfirm();
    }
  };

  const start = () => { if (!disabled && !done) setDragging(true); };
  const end = () => {
    setDragging(false);
    if (!done) setOffset(0);
  };

  return (
    <div
      ref={trackRef}
      onMouseMove={(e) => dragging && move(e.clientX)}
      onMouseUp={end}
      onMouseLeave={end}
      onTouchMove={(e) => dragging && move(e.touches[0].clientX)}
      onTouchEnd={end}
      style={{
        position: 'relative',
        height: 54,
        borderRadius: `${radius.pill}px`,
        background: colors.surfaceHi,
        border: `1px solid ${colors.borderStrong}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        opacity: disabled ? 0.5 : 1,
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <Text variant="bodyStrong" color={colors.textDim}>
        {done ? 'Confirmed' : label}
      </Text>
      <div
        onMouseDown={start}
        onTouchStart={start}
        style={{
          position: 'absolute',
          left: 4,
          top: 4,
          width: KNOB,
          height: KNOB,
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 200ms cubic-bezier(0.22,1,0.36,1)',
          cursor: disabled ? 'not-allowed' : 'grab',
        }}
      >
        <Gradient
          colors={gradients.ocean}
          style={{
            width: KNOB,
            height: KNOB,
            borderRadius: `${radius.pill}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="chevron" size={22} color={colors.onAccent} strokeWidth={2.4} />
        </Gradient>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Export + verify**

Add to `src/ui/index.ts`: `export * from './SlideToConfirm';`
Run: `pnpm test slide` → PASS. `pnpm exec tsc --noEmit` → no errors. `pnpm build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ui/slide.ts src/lib/ui/slide.test.ts src/ui/SlideToConfirm.tsx src/ui/index.ts
git commit -m "feat(web-wallet): SlideToConfirm control + progress helper"
```

---

## Task 5: OtpInput primitive (+ pure code helper)

**Files:**
- Create: `src/lib/ui/otp.ts`
- Create: `src/lib/ui/otp.test.ts`
- Create: `src/ui/OtpInput.tsx`
- Modify: `src/ui/index.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/ui/otp.test.ts`:

```ts
import { normalizeOtp, isComplete } from './otp';

describe('otp helpers', () => {
  it('keeps only digits and caps at length', () => {
    expect(normalizeOtp('12ab34', 6)).toBe('1234');
    expect(normalizeOtp('123456789', 6)).toBe('123456');
    expect(normalizeOtp('  1 2 3 ', 6)).toBe('123');
  });

  it('detects completeness at exact length', () => {
    expect(isComplete('12345', 6)).toBe(false);
    expect(isComplete('123456', 6)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test otp`
Expected: FAIL — cannot find module `./otp`.

- [ ] **Step 3: Implement**

`src/lib/ui/otp.ts`:

```ts
/** Strip non-digits and cap to the code length. */
export function normalizeOtp(raw: string, length: number): string {
  return raw.replace(/\D/g, '').slice(0, length);
}

export function isComplete(code: string, length: number): boolean {
  return code.length === length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test otp`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the OtpInput component**

`src/ui/OtpInput.tsx`. A single hidden input drives 6 display boxes (robust for mobile keyboards + autofill):

```tsx
'use client';
import React, { useRef } from 'react';
import { colors, radius } from './theme';
import { Text } from './Text';
import { normalizeOtp } from '@/lib/ui/otp';

export interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  length?: number;
  onComplete?: (code: string) => void;
}

/** Six-box one-time-code field. One real input underlays clickable display cells. */
export function OtpInput({ value, onChange, length = 6, onComplete }: OtpInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const cells = Array.from({ length });

  const handle = (raw: string) => {
    const next = normalizeOtp(raw, length);
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  return (
    <div style={{ position: 'relative' }} onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => handle(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
        }}
        aria-label="One-time code"
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {cells.map((_, i) => {
          const active = i === value.length;
          return (
            <div
              key={i}
              style={{
                width: 44,
                height: 54,
                borderRadius: `${radius.md}px`,
                background: colors.bgElevated,
                border: `1px solid ${active ? colors.accent : colors.borderStrong}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="h2" color={colors.textHi}>
                {value[i] ?? ''}
              </Text>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Export + verify**

Add to `src/ui/index.ts`: `export * from './OtpInput';`
Run: `pnpm test otp` → PASS. `pnpm exec tsc --noEmit` → no errors. `pnpm build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ui/otp.ts src/lib/ui/otp.test.ts src/ui/OtpInput.tsx src/ui/index.ts
git commit -m "feat(web-wallet): OtpInput 6-box field + code helper"
```

---

## Task 6: SuccessCheck primitive

**Files:**
- Create: `src/ui/SuccessCheck.tsx`
- Modify: `src/app/globals.css` (check-draw keyframe)
- Modify: `src/ui/index.ts`

- [ ] **Step 1: Add check-draw keyframe to globals.css**

Append:

```css
@keyframes navy-check-draw { to { stroke-dashoffset: 0; } }
@keyframes navy-check-pop {
  0% { transform: scale(0.6); opacity: 0; }
  60% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); }
}
```

- [ ] **Step 2: Create the SuccessCheck component**

```tsx
'use client';
import React from 'react';
import { colors } from './theme';

export interface SuccessCheckProps {
  size?: number;
}

/** Animated seafoam success check with a glowing disc. */
export function SuccessCheck({ size = 88 }: SuccessCheckProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'radial-gradient(circle, #2FE0C2, #17C4A8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 44px rgba(47,224,194,0.6)',
        animation: 'navy-check-pop 420ms cubic-bezier(0.22,1,0.36,1) both',
      }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12.5 10 17.5 19 7"
          stroke={colors.onAccent}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 30,
            strokeDashoffset: 30,
            animation: 'navy-check-draw 360ms ease 200ms forwards',
          }}
        />
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Export + verify**

Add to `src/ui/index.ts`: `export * from './SuccessCheck';`
Run: `pnpm exec tsc --noEmit` → no errors. `pnpm build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/ui/SuccessCheck.tsx src/app/globals.css src/ui/index.ts
git commit -m "feat(web-wallet): animated SuccessCheck primitive"
```

---

## Task 7: Relabel Pay tab

**Files:**
- Modify: `src/ui/TabBar.tsx:8-13`

- [ ] **Step 1: Rename the Scan tab to "Pay" and the Home tab to "Wallet"→keep**

In `src/ui/TabBar.tsx`, change the `TABS` array entry for `/scan` label from `'Scan'` to `'Pay'`. Leave routes and icons unchanged:

```tsx
const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/home', label: 'Wallet', icon: 'home' },
  { href: '/scan', label: 'Pay', icon: 'scan' },
  { href: '/farming', label: 'Earn', icon: 'sprout' },
  { href: '/history', label: 'Activity', icon: 'clock' },
];
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm exec tsc --noEmit` → no errors. `pnpm build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/ui/TabBar.tsx
git commit -m "feat(web-wallet): relabel Scan tab to Pay"
```

---

## Task 8: Login screen — drop SMS, restyle to Aurora

**Files:**
- Modify: `src/app/login/page.tsx` (full rewrite)

**Context:** Current file (read it first) supports email + phone (SMS) + passkey + Google + Apple with a segmented channel toggle. Privy SMS is US/Canada only → remove phone entirely. Keep `useLoginWithEmail`, `useLoginWithOAuth`, `useLoginWithPasskey`, `establishFromPrivy`, and the `finish()` → `router.replace('/home')` flow exactly.

- [ ] **Step 1: Rewrite `src/app/login/page.tsx`**

Remove `useLoginWithSms`, the `Channel` type/state, the phone input, and phone branches. Use the new `OtpInput`. Structure per `login-v3.html`: brand mark, wordmark + tagline, "Sign in with" label, email field + "Send code", "or" divider, Passkey/Google/Apple buttons, Privy footnote. After send, show "Enter your code" state with `OtpInput`, "change email", "resend".

```tsx
'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLoginWithOAuth, useLoginWithEmail, useLoginWithPasskey } from '@privy-io/react-auth';
import { useNavySession } from '@/lib/auth/SessionContext';
import { useToast } from '@/ui/Toast';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Gradient } from '@/ui/Gradient';
import { Icon } from '@/ui/Icon';
import { OtpInput } from '@/ui/OtpInput';
import { isComplete } from '@/lib/ui/otp';
import { colors, gradients, radius, space } from '@/ui/theme';

export default function Login() {
  const router = useRouter();
  const toast = useToast();
  const { establishFromPrivy } = useNavySession();
  const { initOAuth } = useLoginWithOAuth();
  const email = useLoginWithEmail();
  const { loginWithPasskey } = useLoginWithPasskey();

  const [emailAddr, setEmailAddr] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, label: string) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(`${label}: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  const finish = async () => { await establishFromPrivy(); router.replace('/home'); };
  const passkey = () => run(async () => { await loginWithPasskey(); await finish(); }, 'Passkey login failed');
  const social = (provider: 'google' | 'apple') => run(async () => { await initOAuth({ provider }); }, 'Social login failed');
  const sendCode = () => run(async () => { await email.sendCode({ email: emailAddr }); setSent(true); }, 'Could not send code');
  const verify = (c: string) => run(async () => { await email.loginWithCode({ code: c }); await finish(); }, 'Verification failed');

  const inputStyle: React.CSSProperties = {
    background: colors.bgElevated,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: `${radius.md}px`,
    padding: `${space.lg}px`,
    color: colors.textHi,
    fontSize: 16,
    marginTop: `${space.sm}px`,
    width: '100%',
    outline: 'none',
  };

  return (
    <Screen scroll>
      {/* Brand */}
      <div style={{ marginTop: `${space.huge}px` }}>
        <Gradient colors={gradients.ocean} glow style={{ width: 64, height: 64, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="wallet" size={30} color={colors.onAccent} strokeWidth={2} />
        </Gradient>
        <div style={{ marginTop: `${space.xxl}px` }}>
          <Text variant="display" color={colors.textHi}>Navy</Text>
          <Text variant="h3" dim style={{ marginTop: `${space.xs}px`, display: 'block' }}>
            Your wallet for the open ocean.
          </Text>
        </div>
      </div>

      {!sent ? (
        <>
          <div style={{ marginTop: `${space.huge}px` }}>
            <Text variant="label" muted upper>Sign in with</Text>
            <input style={inputStyle} placeholder="you@example.com" autoCapitalize="none" type="email"
              value={emailAddr} onChange={(e) => setEmailAddr(e.target.value)} />
            <div style={{ marginTop: `${space.md}px` }}>
              <Button label="Send code" icon="send" loading={busy} disabled={!emailAddr} onPress={sendCode} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: `${space.md}px`, margin: `${space.xxl}px 0` }}>
            <div style={{ flex: 1, height: 1, background: colors.border }} />
            <Text variant="label" muted upper>or</Text>
            <div style={{ flex: 1, height: 1, background: colors.border }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: `${space.md}px` }}>
            <Button label="Continue with passkey" icon="shield" variant="secondary" onPress={passkey} />
            <Button label="Continue with Google" icon="shield" variant="secondary" onPress={() => social('google')} />
            <Button label="Continue with Apple" icon="shield" variant="secondary" onPress={() => social('apple')} />
          </div>

          <Text variant="caption" muted center style={{ display: 'block', marginTop: `${space.xxl}px` }}>
            Secured by Privy · non-custodial
          </Text>
        </>
      ) : (
        <div style={{ marginTop: `${space.huge}px` }}>
          <Text variant="h2" color={colors.textHi}>Enter your code</Text>
          <Text variant="caption" dim style={{ display: 'block', marginTop: `${space.xs}px` }}>
            Sent to {emailAddr} ·{' '}
            <span style={{ color: colors.aqua, cursor: 'pointer' }} onClick={() => { setSent(false); setCode(''); }}>Change</span>
          </Text>
          <div style={{ marginTop: `${space.xxl}px` }}>
            <OtpInput value={code} onChange={setCode} onComplete={verify} />
          </div>
          <div style={{ marginTop: `${space.xxl}px` }}>
            <Button label="Verify & sign in" icon="check" loading={busy} disabled={!isComplete(code, 6)} onPress={() => verify(code)} />
          </div>
          <Text variant="caption" color={colors.aqua} center style={{ display: 'block', marginTop: `${space.xl}px`, cursor: 'pointer' }} onClick={sendCode}>
            Resend code
          </Text>
        </div>
      )}
    </Screen>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm exec tsc --noEmit` → no errors. `pnpm build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat(web-wallet): Aurora login, email-only (drop SMS)"
```

---

## Task 9: Home screen restyle + tip rule helper

**Files:**
- Create: `src/lib/wallet/tips.ts`
- Create: `src/lib/wallet/tips.test.ts`
- Modify: `src/app/(tabs)/home/page.tsx`

- [ ] **Step 1: Write the failing test for the tip rule**

`src/lib/wallet/tips.test.ts`:

```ts
import { earnTip } from './tips';

describe('earnTip', () => {
  it('suggests earning when idle USDC is at/above threshold', () => {
    expect(earnTip(1000, 100)).toEqual({ show: true, amount: '1,000' });
  });
  it('stays hidden below the threshold', () => {
    expect(earnTip(50, 100)).toEqual({ show: false });
  });
  it('handles non-finite balances as hidden', () => {
    expect(earnTip(NaN, 100)).toEqual({ show: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tips`
Expected: FAIL — cannot find module `./tips`.

- [ ] **Step 3: Implement the rule**

`src/lib/wallet/tips.ts`:

```ts
export type EarnTip = { show: false } | { show: true; amount: string };

/** Rule-based (non-AI) home tip: nudge idle USDC into the Earn vault. */
export function earnTip(usdc: number, thresholdUsdc: number): EarnTip {
  if (!Number.isFinite(usdc) || usdc < thresholdUsdc) return { show: false };
  return { show: true, amount: usdc.toLocaleString('en-US') };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tips`
Expected: PASS (3 tests).

- [ ] **Step 5: Restyle Home**

Rewrite the `return (...)` block of `src/app/(tabs)/home/page.tsx` to match `screenset.html` "Home". Keep all existing hooks/state/`load`/`refresh`/`copy`/`handleSignOut` logic. Changes:
- Header: left = `Text variant="caption" dim` "Welcome back" over `Text variant="h3"` name (use `short(address)` if no name); right = two round icon buttons (`Icon name="clock"` placeholder for notifications is NOT needed — use only the existing `logout` button; drop the notification bell to avoid a dead control).
- Balance hero: **centered**, not the gradient card. Eyebrow `Text variant="label" muted upper` = "Total balance · Gasless" (append a `Pill tone="accent" label="Gasless"` inline, or keep text). Big number: `Text variant="display" numeric` with gradient via a wrapping span using `WebkitBackgroundClip`. When `usdc === '—'`, render `<Skeleton width={180} height={40} />` instead. Sub-line `Text variant="caption"` color aqua: `{sol} SOL`.
- Quick actions: a row of three using existing `Action`/`PressRow`, but reorder to **Receive · Pay · Earn**; Receive calls `router.push('/receive')`, Pay calls `router.push('/scan')`, Earn calls `router.push('/farming')`. Make Pay the emphasized one (wrap its `actionCard` in a `Gradient colors={gradients.ocean}`).
- Tip card: compute `const tip = earnTip(Number(usdc.replaceAll(',', '')) || 0, 100);` and when `tip.show`, render a `Card glass` with gradient tint (`style={{ background: 'linear-gradient(135deg, rgba(61,116,255,0.26), rgba(47,224,194,0.15))' }}`) containing `Text bodyStrong` "Idle USDC could earn 4.2%" and a `PressRow onPress={() => router.push('/farming')}` "Move to the Earn vault →".
- Activity preview: keep the existing recent-activity `Card compact` block but switch it to `Card glass compact`.

Import additions at top: `import { Skeleton } from '@/ui/Skeleton';` and `import { earnTip } from '@/lib/wallet/tips';`.

Keep the file's existing `styles` object; add/adjust style keys as needed for the centered hero. Do not change the data-loading effects.

- [ ] **Step 6: Typecheck + build**

Run: `pnpm test tips` → PASS. `pnpm exec tsc --noEmit` → no errors. `pnpm build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/wallet/tips.ts src/lib/wallet/tips.test.ts "src/app/(tabs)/home/page.tsx"
git commit -m "feat(web-wallet): Aurora home with centered hero + earn tip"
```

---

## Task 10: Receive screen (new route)

**Files:**
- Create: `src/app/(tabs)/receive/page.tsx`

**Context:** `/receive` sits under the `(tabs)` group so it keeps the tab bar and frame, but it is not itself a tab. It reads the address from `useWebSigner()` and renders a QR. Check whether a QR library is available; if not, render the address prominently and rely on copy/share (do NOT add a dependency — a QR image can use a `<canvas>`-free fallback: a styled address block). Use the existing `useToast` for copy feedback and `navigator.share` when present.

- [ ] **Step 1: Create the Receive page**

```tsx
'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { useWebSigner } from '@/lib/wallet/useWebSigner';
import { useToast } from '@/ui/Toast';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';
import { PressRow } from '@/ui/Bits';
import { colors, radius, space } from '@/ui/theme';

export default function Receive() {
  const router = useRouter();
  const { address } = useWebSigner();
  const toast = useToast();

  const copy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    toast('Wallet address copied');
  };
  const share = async () => {
    if (!address) return;
    if (navigator.share) { try { await navigator.share({ text: address }); } catch { /* dismissed */ } }
    else copy();
  };

  return (
    <Screen scroll tabSafe>
      <PressRow onPress={() => router.back()} style={{ gap: `${space.sm}px`, marginBottom: `${space.xl}px` }}>
        <Icon name="chevron" size={20} color={colors.textDim} style={{ transform: 'rotate(180deg)' }} />
        <Text variant="h3" color={colors.textHi}>Receive</Text>
      </PressRow>

      <Card style={{ background: '#FFFFFF', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: 180, height: 180, borderRadius: `${radius.md}px`, background:
          'repeating-linear-gradient(0deg,#0b1322 0 8px,#fff 8px 16px), repeating-linear-gradient(90deg,#0b1322 0 8px,transparent 8px 16px)' }} />
      </Card>

      <Text variant="caption" dim center style={{ display: 'block', marginTop: `${space.xl}px` }}>Your Navy address</Text>
      <Card glass compact style={{ marginTop: `${space.sm}px` }}>
        <Text variant="mono" color={colors.textHi} style={{ userSelect: 'text', wordBreak: 'break-all' }}>
          {address ?? 'provisioning…'}
        </Text>
      </Card>

      <div style={{ display: 'flex', gap: `${space.md}px`, marginTop: `${space.lg}px` }}>
        <Button label="Copy" icon="copy" variant="secondary" onPress={copy} />
        <Button label="Share" icon="send" onPress={share} />
      </div>

      <Card glass compact style={{ marginTop: `${space.lg}px` }}>
        <Text variant="caption" color={colors.text}>
          Only send SOL or USDC (SPL) on Solana devnet to this address.
        </Text>
      </Card>
    </Screen>
  );
}
```

Note: the QR block above is a placeholder pattern; if the repo already has a QR generator util, use it. Do not add a dependency.

- [ ] **Step 2: Verify PressRow accepts a `style` with rotate + Icon accepts `style`**

`PressRow` accepts `style` (see `Bits.tsx`). `Icon` does NOT accept a `style` prop — instead wrap the chevron in a `<span style={{ transform:'rotate(180deg)', display:'inline-flex' }}>`. Fix the code accordingly before building.

- [ ] **Step 3: Typecheck + build**

Run: `pnpm exec tsc --noEmit` → no errors. `pnpm build` → succeeds. Navigate check: `/receive` compiles as a route.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(tabs)/receive/page.tsx"
git commit -m "feat(web-wallet): Receive screen with QR + copy/share"
```

---

## Task 11: Scan screen restyle

**Files:**
- Modify: `src/app/(tabs)/scan/page.tsx`

**Context:** Read the file first. Keep all camera/`useQrScanner` logic and navigation-on-detect. Only restyle the overlay to match `screenset.html` "Pay · Scan": dimmed surround via a radial mask, a centered rounded reticle with an animated scan line (reuse `navy-laser` keyframe already in globals.css), a top bar (close · "Scan to pay" · torch if supported), a "Point at a Navy QR code" hint, and a "Paste address instead" fallback button (wire to existing paste/manual-entry handler if present; otherwise a `Button` that focuses a hidden text input already used by the logic — do not invent new logic).

- [ ] **Step 1: Restyle the overlay only**

Apply the overlay markup from `screenset.html` "Pay · Scan". Keep the `<video>`/scanner element and its ref intact. Use `colors`/`space` tokens. The scan line: `<div style={{ animation: 'navy-laser 2.4s ease-in-out infinite' }}>` inside the reticle.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm exec tsc --noEmit` → no errors. `pnpm build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(tabs)/scan/page.tsx"
git commit -m "feat(web-wallet): Aurora scan overlay with reticle + scan line"
```

---

## Task 12: Pay confirm sheet + success state

**Files:**
- Modify: `src/app/pay/[orderId]/page.tsx`

**Context:** Read the file first. This screen already runs `payFlow` (build tx → sign → submit). Restyle it into: a details view, a **confirm bottom `Sheet`** with `SlideToConfirm`, and a **success** state using `SuccessCheck`. Keep every step of the existing pay logic — `SlideToConfirm.onConfirm` calls the SAME function the current confirm button calls. Do not change amounts, signing, or submit calls.

- [ ] **Step 1: Wrap confirm in Sheet + SlideToConfirm**

Replace the current confirm button/section with:
- Order details (merchant/recipient, amount) shown in a `Card glass`.
- A `Sheet open={confirming} onClose={() => setConfirming(false)}` containing: merchant avatar/name, big amount + "USDC", a `Card glass compact` key/value block with `Field label="Network fee" value="Sponsored · Gasless"` (aqua) and `Field label="You pay" value="{amount} USDC"`, then `<SlideToConfirm label="Slide to pay" onConfirm={submitPayment} disabled={busy} />` where `submitPayment` is the existing submit handler.
- On success (existing success state/flag), render a centered `SuccessCheck` + `Text h2` "Paid {amount} USDC", sub-line "to {merchant}", a `Card glass` with status "Confirmed on-chain" and "Fee paid by you: $0.00", a secondary `Button label="View on explorer"` (existing explorer URL if available; else omit), and a primary `Button label="Done" onPress={() => router.push('/home')}`.

Introduce `const [confirming, setConfirming] = useState(false)` and open the sheet from the primary "Pay" button. Import `Sheet`, `SlideToConfirm`, `SuccessCheck`, `Field`.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm exec tsc --noEmit` → no errors. `pnpm build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/pay/[orderId]/page.tsx"
git commit -m "feat(web-wallet): pay confirm sheet with slide-to-pay + success"
```

---

## Task 13: Earn screen restyle

**Files:**
- Modify: `src/app/(tabs)/farming/page.tsx`

**Context:** Read the file first. Keep all `FarmingClient`/deposit/withdraw/`sign` logic and state. Restyle the `return (...)` per `screenset.html` "Earn".

- [ ] **Step 1: Restyle Earn**

- Header row: `Text variant="h2"` "Earn" + `Text variant="caption" dim` "Save · devnet".
- Position hero: a `Card glass` with gradient tint (`background: 'linear-gradient(135deg, rgba(61,116,255,0.28), rgba(47,224,194,0.16))'`), centered: eyebrow "Deposited · earning", `Text variant="display" numeric` value (or `<Skeleton>` while `pos === null` and loading), sub-line aqua "`{apy}` · +`{earned}`" using existing `Position` fields (`formatSol`).
- Deposit/Withdraw: keep the existing two `Button`s (primary Deposit, secondary Withdraw), preserving their existing `onPress` handlers.
- "How it works": `Card glass compact` with the security explainer text: "Your USDC is deposited into Save's SOL reserve via a Navy-secured subwallet. Keys stay encrypted — the agent can never move funds off-policy."
- Positions list: a `Card glass compact` list row per position with `IconBadge name="sprout" color={colors.aqua}`, name/subtitle, and value.

Import `Skeleton` if used.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm exec tsc --noEmit` → no errors. `pnpm build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(tabs)/farming/page.tsx"
git commit -m "feat(web-wallet): Aurora earn screen"
```

---

## Task 14: Activity screen restyle

**Files:**
- Modify: `src/app/(tabs)/history/page.tsx`

**Context:** Read the file first. Keep the data fetch. Restyle per `screenset.html` "Activity": header + (optional) search icon, filter chips (All / Payments / Earn), items grouped by day with glass rows and signed amounts (received = aqua `+`).

- [ ] **Step 1: Add client-side filter state + grouping**

- `const [filter, setFilter] = useState<'all' | 'payments' | 'earn'>('all')`.
- Render three chips using `PressRow`; the active chip uses a `Gradient colors={gradients.ocean}` pill, inactive use `Card glass`-style pills. Filter the existing list by a simple predicate on the item's type/category (use whatever field the existing items expose; if only payments exist, keep All + Payments and hide Earn — do not fabricate data).
- Group the filtered list by day label. If the existing data has timestamps, derive Today/Yesterday/date; if not, render a single "Recent" group. Each row: typed `IconBadge`, counterparty/reference, time·status caption, signed amount (`+` in `colors.aqua` for received/positive, default for outgoing).
- Wrap each day group's rows in a `Card glass compact`.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm exec tsc --noEmit` → no errors. `pnpm build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(tabs)/history/page.tsx"
git commit -m "feat(web-wallet): Aurora activity screen with filters"
```

---

## Task 15: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: all pure-logic tests pass (including new `slide`, `otp`, `tips`). The `bigint-buffer` warning is harmless noise (per CLAUDE.md).

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build (runtime gate)**

Run: `pnpm build`
Expected: build succeeds with no Buffer/crypto resolution errors on any route. If a newly-loaded screen throws a `Buffer`/`crypto` error, add the polyfill per CLAUDE.md (`globalThis.Buffer ??= Buffer` in a client boundary or `resolve.fallback` in `next.config.ts`).

- [ ] **Step 4: Manual device-mode smoke (reviewer)**

Run: `pnpm dev -p 3001` and open each route in a phone viewport (`/login`, `/home`, `/scan`, `/receive`, `/farming`, `/history`, and a pay link). Confirm: safe-area padding, no iOS input zoom (16px inputs), slide-to-pay fires, success check animates, tabs relabelled, no phone login option. This step is a human check — note results in the PR.

- [ ] **Step 5: Final commit (if any polyfill/fix needed)**

```bash
git add -A
git commit -m "chore(web-wallet): redesign verification fixes"
```

---

## Self-Review Notes (spec coverage)

- Direction/palette/glass → Tasks 1, 9–14. Tabular-nums already in `Text` (no task needed).
- Motion primitives → Tasks 2 (skeleton), 3 (sheet), 4 (slide), 6 (check); keyframes in globals.
- Nav (Home/Pay/Earn/Activity; Receive as action) → Task 7 (relabel), Task 9 (Receive action), Task 10 (route).
- Screens 4.1–4.8 → Tasks 8 (login), 9 (home), 11 (scan), 12 (confirm+success), 10 (receive), 13 (earn), 14 (activity).
- Drop SMS → Task 8.
- Mobile guardrails (safe-area, 16px inputs, tap targets) → existing `Screen`/inputs preserved; verified in Task 15.
- Out-of-scope items intentionally have no task.
