# Landing Product Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Float an on-brand mock of the real product UI beside each landing story beat so the voyage *shows* the wallet, checkout, on-chain settlement, and farming — without changing the 3D scene.

**Architecture:** Four pure presentational mock components (wallet card, checkout sheet, settlement receipt, yield widget) built from the shared `@/ui/theme` tokens. A `ProductMock` switch maps a scene id → its mock. In `VoyageBeats`, each story `.voyage-beat` gets the mock as an **absolutely-positioned layer on the edge opposite the copy** (so the copy is untouched and tablet/mobile collapse to today's single-column). The static path stacks the mock below the copy. All CSS-only motion; reduced-motion is already neutralized globally.

**Tech Stack:** Next.js 16 / React 19, inline-style components, `@/ui/theme` tokens, GSAP ScrollTrigger (unchanged), Jest for the one pure helper.

---

## File Structure

- Modify `fe/src/lib/landing/copy.ts` — add `PRODUCT_MOCKS` data, move+export `ALIGN`, add pure `mediaAlignFor(id)`.
- Create `fe/src/lib/landing/copy.test.ts` — unit test for `mediaAlignFor`.
- Create `fe/src/components/landing/product/MockCard.tsx` — shared glass-card shell + `Badge` + `Row` helpers.
- Create `fe/src/components/landing/product/WalletCard.tsx`
- Create `fe/src/components/landing/product/CheckoutSheet.tsx`
- Create `fe/src/components/landing/product/SettlementReceipt.tsx`
- Create `fe/src/components/landing/product/YieldWidget.tsx`
- Create `fe/src/components/landing/product/ProductMock.tsx` — scene id → mock switch.
- Modify `fe/src/app/globals.css` — `product-float` keyframe + `.voyage-media` hide rule.
- Modify `fe/src/components/landing/VoyageBeats.tsx` — import `ALIGN` from copy, add media layer to animated story beats + static sections.

---

## Task 1: Content data + `mediaAlignFor` helper (TDD)

**Files:**
- Modify: `fe/src/lib/landing/copy.ts`
- Test: `fe/src/lib/landing/copy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `fe/src/lib/landing/copy.test.ts`:

```ts
import { mediaAlignFor, PRODUCT_MOCKS } from './copy';

describe('mediaAlignFor', () => {
  it('places media on the edge opposite the copy', () => {
    expect(mediaAlignFor('sail')).toBe('right'); // copy left
    expect(mediaAlignFor('port')).toBe('left'); // copy right
    expect(mediaAlignFor('sea')).toBe('right');
    expect(mediaAlignFor('treasure')).toBe('left');
  });
});

describe('PRODUCT_MOCKS', () => {
  it('has an entry for each of the four story beats', () => {
    expect(Object.keys(PRODUCT_MOCKS).sort()).toEqual(['port', 'sail', 'sea', 'treasure']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fe && pnpm test copy`
Expected: FAIL — `mediaAlignFor` / `PRODUCT_MOCKS` are not exported.

- [ ] **Step 3: Add the data and helper to `copy.ts`**

Append to `fe/src/lib/landing/copy.ts` (after the existing `FEATURES` block):

```ts
/** Which side the copy sits on per story beat (index-aligned to SCENE_COPY).
 *  Lives here so both VoyageBeats and mediaAlignFor share one source of truth. */
export const ALIGN: ReadonlyArray<'left' | 'right'> = ['left', 'right', 'left', 'right'];

/** The product mock floats on the edge OPPOSITE the copy, clearing the vessel. */
export function mediaAlignFor(id: SceneCopyItem['id']): 'left' | 'right' {
  const i = SCENE_COPY.findIndex((c) => c.id === id);
  return (ALIGN[i] ?? 'left') === 'left' ? 'right' : 'left';
}

/** Static, plausible devnet content for the per-beat product mocks. Strings live
 *  beside the rest of the landing copy so they're editable without touching JSX. */
export const PRODUCT_MOCKS = {
  sail: { balance: '$1,248.50', unit: 'USDC · Solana', actions: ['Send', 'Scan', 'Farm'] },
  port: { merchant: 'Ocean Coffee', amount: '12.00', unit: 'USDC', badges: ['Gasless', '1% fee'], cta: 'Pay 12.00 USDC' },
  sea: {
    event: 'InvoicePaid', sig: '5Qx7…8Kd', status: 'Confirmed',
    rows: [['Amount', '12.00 USDC'], ['Fee', '0.12 USDC'], ['Payer', '9aF2…tuv']],
  },
  treasure: { protocol: 'Save · devnet', apy: '5.2%', principal: '820.00 USDC', badges: ['Non-custodial', 'Policy-guarded'] },
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd fe && pnpm test copy`
Expected: PASS (both suites).

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/landing/copy.ts fe/src/lib/landing/copy.test.ts
git commit -m "feat(fe): landing product-mock copy data + mediaAlignFor helper"
```

---

## Task 2: Shared `MockCard` shell

**Files:**
- Create: `fe/src/components/landing/product/MockCard.tsx`

UI component — no unit test; verified by `tsc` in Task 6.

- [ ] **Step 1: Create `MockCard.tsx`**

```tsx
import type { CSSProperties, ReactNode } from 'react';
import { colors } from '@/ui/theme';

/** Shared glass-card shell for the landing product mocks. `width` collapses on
 *  narrow viewports so the same card works in the desktop edge-overlay and the
 *  stacked static/mobile path. The float animation is CSS-only (globals.css) and
 *  is neutralized by the global prefers-reduced-motion rule. */
const shell: CSSProperties = {
  width: 'min(340px, 80vw)',
  border: `1px solid ${colors.borderStrong}`,
  background: 'rgba(12,20,36,0.62)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  borderRadius: 20,
  overflow: 'hidden',
  boxShadow: '0 24px 60px rgba(3,8,20,0.55)',
  color: colors.text,
};

export function MockCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="product-float" style={{ ...shell, ...style }}>
      {children}
    </div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: colors.aqua, border: `1px solid ${colors.borderStrong}`, background: colors.glassFill, padding: '4px 10px', borderRadius: 999 }}>
      {children}
    </span>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderTop: `1px solid ${colors.border}`, fontSize: 13 }}>
      <span style={{ color: colors.textDim }}>{label}</span>
      <span style={{ color: colors.textHi, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add fe/src/components/landing/product/MockCard.tsx
git commit -m "feat(fe): shared MockCard shell for landing product mocks"
```

---

## Task 3: The four product mocks + `ProductMock` switch

**Files:**
- Create: `fe/src/components/landing/product/WalletCard.tsx`
- Create: `fe/src/components/landing/product/CheckoutSheet.tsx`
- Create: `fe/src/components/landing/product/SettlementReceipt.tsx`
- Create: `fe/src/components/landing/product/YieldWidget.tsx`
- Create: `fe/src/components/landing/product/ProductMock.tsx`

UI components — verified by `tsc` in Task 6.

- [ ] **Step 1: Create `WalletCard.tsx`**

```tsx
import { colors, gradients } from '@/ui/theme';
import { PRODUCT_MOCKS } from '@/lib/landing/copy';
import { MockCard } from './MockCard';

/** Beat `sail` — the wallet hero balance card (Send / Scan / Farm). */
export function WalletCard() {
  const m = PRODUCT_MOCKS.sail;
  return (
    <MockCard>
      <div style={{ background: `linear-gradient(135deg, ${gradients.ocean[0]}, ${gradients.ocean[1]})`, padding: 20, color: colors.onAccent }}>
        <div style={{ fontSize: 12, opacity: 0.8, letterSpacing: '0.04em' }}>Total balance</div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', margin: '4px 0 2px' }}>{m.balance}</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>{m.unit}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: 16 }}>
        {m.actions.map((a) => (
          <div key={a} style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 600, color: colors.textHi, border: `1px solid ${colors.borderStrong}`, background: colors.glassFill, padding: '10px 0', borderRadius: 12 }}>
            {a}
          </div>
        ))}
      </div>
    </MockCard>
  );
}
```

- [ ] **Step 2: Create `CheckoutSheet.tsx`**

```tsx
import { colors } from '@/ui/theme';
import { PRODUCT_MOCKS } from '@/lib/landing/copy';
import { MockCard, Badge } from './MockCard';

/** Beat `port` — a merchant checkout sheet (gasless, 1% fee, Pay). */
export function CheckoutSheet() {
  const m = PRODUCT_MOCKS.port;
  return (
    <MockCard style={{ padding: 20 }}>
      <div style={{ fontSize: 12, color: colors.textDim, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Pay merchant</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: colors.textHi, margin: '6px 0 14px' }}>{m.merchant}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 40, fontWeight: 700, color: colors.textHi, letterSpacing: '-0.02em' }}>{m.amount}</span>
        <span style={{ fontSize: 15, color: colors.textDim }}>{m.unit}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '14px 0 16px' }}>
        {m.badges.map((b) => (
          <Badge key={b}>{b}</Badge>
        ))}
      </div>
      <div style={{ textAlign: 'center', fontWeight: 700, color: colors.onAccent, background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`, padding: '12px 0', borderRadius: 12 }}>
        {m.cta}
      </div>
    </MockCard>
  );
}
```

- [ ] **Step 3: Create `SettlementReceipt.tsx`**

```tsx
import { colors } from '@/ui/theme';
import { PRODUCT_MOCKS } from '@/lib/landing/copy';
import { MockCard, Row } from './MockCard';

/** Beat `sea` — the on-chain settlement proof (InvoicePaid event). */
export function SettlementReceipt() {
  const m = PRODUCT_MOCKS.sea;
  return (
    <MockCard style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.textHi }}>{m.event}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: colors.success }}>✓ {m.status}</span>
      </div>
      <div style={{ fontSize: 12, color: colors.textDim, margin: '4px 0 6px', fontFamily: 'ui-monospace, monospace' }}>sig {m.sig}</div>
      {m.rows.map(([label, value]) => (
        <Row key={label} label={label} value={value} />
      ))}
    </MockCard>
  );
}
```

- [ ] **Step 4: Create `YieldWidget.tsx`**

```tsx
import { colors } from '@/ui/theme';
import { PRODUCT_MOCKS } from '@/lib/landing/copy';
import { MockCard, Badge, Row } from './MockCard';

/** Beat `treasure` — the farming yield widget (APY, non-custodial). */
export function YieldWidget() {
  const m = PRODUCT_MOCKS.treasure;
  return (
    <MockCard style={{ padding: 20 }}>
      <div style={{ fontSize: 12, color: colors.textDim, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Farming · {m.protocol}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '10px 0 4px' }}>
        <span style={{ fontSize: 40, fontWeight: 700, color: colors.aqua, letterSpacing: '-0.02em' }}>{m.apy}</span>
        <span style={{ fontSize: 13, color: colors.textDim }}>APY</span>
      </div>
      <Row label="Principal" value={m.principal} />
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {m.badges.map((b) => (
          <Badge key={b}>{b}</Badge>
        ))}
      </div>
    </MockCard>
  );
}
```

- [ ] **Step 5: Create `ProductMock.tsx`**

```tsx
import type { SceneCopyItem } from '@/lib/landing/copy';
import { WalletCard } from './WalletCard';
import { CheckoutSheet } from './CheckoutSheet';
import { SettlementReceipt } from './SettlementReceipt';
import { YieldWidget } from './YieldWidget';

/** Maps a story-beat id to its product mock. Returns null for the ecosystem /
 *  finale beats, which keep their existing (mock-free) treatment. */
export function ProductMock({ id }: { id: SceneCopyItem['id'] }) {
  switch (id) {
    case 'sail':
      return <WalletCard />;
    case 'port':
      return <CheckoutSheet />;
    case 'sea':
      return <SettlementReceipt />;
    case 'treasure':
      return <YieldWidget />;
    default:
      return null;
  }
}
```

- [ ] **Step 6: Typecheck**

Run: `cd fe && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add fe/src/components/landing/product/
git commit -m "feat(fe): four landing product mocks + ProductMock switch"
```

---

## Task 4: Float keyframe + media hide rule

**Files:**
- Modify: `fe/src/app/globals.css`

- [ ] **Step 1: Add the keyframe and hide rule**

In `fe/src/app/globals.css`, add after the `.navy-fade-in` line (line ~42, before the `@media (prefers-reduced-motion: reduce)` block):

```css
@keyframes product-float { 0%, 100% { transform: translateY(-6px); } 50% { transform: translateY(6px); } }
.product-float { animation: product-float 6s ease-in-out infinite; }
/* The edge-overlaid product mock is desktop-only; below this the story beat
   collapses to its single copy column (see VoyageBeats). */
@media (max-width: 1024px) { .voyage-media { display: none; } }
```

(No extra reduced-motion rule needed — the existing `@media (prefers-reduced-motion: reduce)` block already forces all animations to `0.001ms`.)

- [ ] **Step 2: Commit**

```bash
git add fe/src/app/globals.css
git commit -m "feat(fe): product-float keyframe + desktop-only media hide rule"
```

---

## Task 5: Wire mocks into `VoyageBeats`

**Files:**
- Modify: `fe/src/components/landing/VoyageBeats.tsx`

- [ ] **Step 1: Update imports and remove the local `ALIGN`**

At the top of `fe/src/components/landing/VoyageBeats.tsx`, change the copy import to also pull `ALIGN` + `mediaAlignFor`, and add the `ProductMock` import:

```tsx
import { SCENE_COPY, FEATURES, ALIGN, mediaAlignFor, type SceneCopyItem } from '@/lib/landing/copy';
import type { CtaLinks } from '@/lib/landing/links';
import { ProductMock } from './product/ProductMock';
```

Then DELETE the local declaration (currently near line 114):

```tsx
/** Story beats alternate sides so they clear the centred vessel. */
const ALIGN: Array<'left' | 'right'> = ['left', 'right', 'left', 'right'];
```

- [ ] **Step 2: Add a `BeatWithMedia` wrapper**

Add this component just above `slideNodes` in `VoyageBeats.tsx`:

```tsx
/** A story beat plus its product mock. The copy stays exactly as before (edge-
 *  aligned by the slide container); the mock is an absolutely-positioned layer on
 *  the OPPOSITE edge, so it clears the centred vessel and collapses out below
 *  1024px (.voyage-media hide rule) leaving today's single-column layout intact. */
function BeatWithMedia({ c, align, links, hero = false }: { c: SceneCopyItem; align: 'left' | 'right'; links: CtaLinks; hero?: boolean }) {
  const mediaSide = mediaAlignFor(c.id);
  return (
    <>
      <Beat c={c} align={align} links={links} hero={hero} />
      <div
        className="voyage-media"
        style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', [mediaSide]: 'clamp(28px, 7vw, 120px)' }}
      >
        <ProductMock id={c.id} />
      </div>
    </>
  );
}
```

- [ ] **Step 3: Use the wrapper for the story slides**

In `slideNodes`, change the story mapping's `node` from `<Beat .../>` to `<BeatWithMedia .../>`:

```tsx
  const story = SCENE_COPY.map((c, i) => ({
    key: c.id,
    justify: ALIGN[i] === 'right' ? 'flex-end' : 'flex-start',
    items: 'center',
    pad: sidePad,
    node: <BeatWithMedia c={c} align={ALIGN[i]} links={links} hero={i === 0} />,
  }));
```

- [ ] **Step 4: Show the mock on the static path too**

In `StaticStory`, replace the `<Beat .../>` inside each section with a column that also renders the mock:

```tsx
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32, alignItems: ALIGN[i] === 'right' ? 'flex-end' : 'flex-start' }}>
            <Beat c={c} align={ALIGN[i]} links={links} hero={i === 0} />
            <ProductMock id={c.id} />
          </div>
```

- [ ] **Step 5: Typecheck**

Run: `cd fe && pnpm exec tsc --noEmit`
Expected: no errors (the local `ALIGN` is gone and now comes from `copy.ts`).

- [ ] **Step 6: Commit**

```bash
git add fe/src/components/landing/VoyageBeats.tsx
git commit -m "feat(fe): float product mocks beside each landing story beat"
```

---

## Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Unit test the pure helper**

Run: `cd fe && pnpm test copy`
Expected: PASS.

- [ ] **Step 2: Typecheck**

Run: `cd fe && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build (runtime/bundle gate)**

Run: `cd fe && pnpm build`
Expected: build succeeds, no errors.

- [ ] **Step 4: Manual visual check (optional but recommended)**

Run: `cd fe && pnpm dev` and open the landing page. Confirm:
- Each of the first four beats shows its product mock on the edge opposite the copy, gently floating, clearing the vessel.
- Resizing below ~1024px hides the mocks; copy layout is unchanged.
- The ecosystem and finale beats are unchanged.

- [ ] **Step 5: Final commit (if any lint/format touch-ups were needed)**

```bash
git add -A
git commit -m "chore(fe): verify landing product media (tsc + build green)" --allow-empty
```
