# Landing page — product media woven into the voyage

**Date:** 2026-07-12
**App:** `fe/`
**Branch:** `feat/landing-page-voyage`

## Problem

The landing "Voyage" hero (`fe/src/components/landing/*`) tells the Navy story with a
3D boat sailing an ocean across six pinned, scroll-scrubbed beats. The copy already
names the features (gateway, wallet, farming, security), but nothing on screen **shows**
the product — the visuals are a metaphorical boat, not the app. We want each story beat
to *prove* its feature by floating an on-brand mock of the actual product UI beside the
copy, while keeping the voyage concept and motion exactly as they are.

## Approach (locked)

Keep the boat + ocean voyage untouched. Each story beat is already side-aligned (copy on
one edge) to clear the centered vessel; that leaves the opposite edge free. Place a
**floating mock of the real product UI** on that free edge. The vessel sails in the gap
between copy and media.

Mocks are **pure presentational components** built from the shared design tokens
(`@/ui/theme` `colors`/`gradients`) — the same look as the real apps — with no
screenshots, no live data, and no framework-specific imports. This makes them reusable on
both the animated (WebGL) path and the static/reduced-motion path.

### Beat → mock mapping

| Beat (`SceneCopyItem.id`) | Copy theme | Product mock |
|---|---|---|
| `sail` (hero) | The ecosystem, one voyage | **Wallet balance card** — ocean-gradient hero card: balance, USDC, Send / Scan / Farm actions |
| `port` (merchant) | Get paid in seconds | **Checkout sheet** — "Pay Ocean Coffee · 12.00 USDC", *Gasless* + *1% fee* badges, Pay button |
| `sea` (Solana) | Settled on-chain, fast | **Settlement receipt** — `InvoicePaid` event, tx signature, ✓ Confirmed, amount/fee/payer rows |
| `treasure` (farming) | Idle balance to work | **Yield widget** — "Earning via Save · non-custodial", APY, policy-guarded badge |

The `ecosystem` (feature list) and `finale` (CTA) beats are **untouched**.

## Structure

### New files — `fe/src/components/landing/product/`

```
product/
  WalletCard.tsx        — hero balance card (ocean gradient, Send/Scan/Farm)
  CheckoutSheet.tsx     — merchant pay sheet (amount, gasless + 1% badges, Pay)
  SettlementReceipt.tsx — on-chain proof (InvoicePaid, sig, ✓ confirmed rows)
  YieldWidget.tsx       — farming card (APY, non-custodial, policy-guarded)
  ProductMock.tsx       — maps a scene id → the right mock (single switch); returns null for ids without a mock
```

Each mock:
- Consumes only `React` + `@/ui/theme` tokens. No props required beyond optional `style`.
- Renders fixed, plausible **devnet** content (`12.00 USDC`, `1% fee`, `Save · devnet`). No live data.
- Is a self-contained glass card (border `colors.border`, `glassFill`, `backdrop-filter: blur`), sized ~`320–360px` wide.

### Content data — `fe/src/lib/landing/copy.ts`

- Add a `PRODUCT_MOCKS` record keyed by scene id holding the display strings (labels,
  amounts, badge text, row labels) so copy lives beside the rest of the landing copy and
  is editable without touching JSX. Mock components read from it.
- Add a pure helper `mediaAlignFor(id)` returning the edge opposite the copy's `ALIGN`
  (copy left → media right, copy right → media left). Unit-tested in `copy.test.ts`.

### Layout — `fe/src/components/landing/VoyageBeats.tsx`

- The `Beat` slide becomes a two-column flex row **inside the same** `.voyage-beat`
  full-screen container (so it inherits the existing crossfade/scrub timeline unchanged):
  - **Copy column** pinned to its aligned edge — `maxWidth: 460`, current markup unchanged.
  - **Media column** pinned to the opposite edge, rendering `<ProductMock id={c.id} />`.
  - A center gap (~`34vw`) is reserved so both columns clear the vessel.
  - The media column is decorative: `pointerEvents: 'none'` (buttons look real but aren't clickable).
- **Responsive:** below ~`1024px` the media column is `display:none`; the copy keeps its
  current single-column, edge-aligned behavior. Narrow/tablet layout is unaffected.
- `ecosystem` and `finale` slides are unchanged. `hero` beat (`sail`) shows `WalletCard`.

### Motion — `fe/src/app/globals.css`

- Add one keyframe `product-float` (slow ±6px `translateY`, ~6s ease-in-out, infinite),
  applied to the mock card wrapper for subtle life.
- Disabled under `@media (prefers-reduced-motion: reduce)`.
- The beat crossfade/scrub in `VoyageBeats` is **not** changed — mocks ride inside `.voyage-beat`.

### Static / reduced-motion path — `StaticStory` (in `VoyageBeats.tsx`)

- Each stacked full-height section renders its `<ProductMock id={c.id} />` **below** the
  copy in a single column, so the non-WebGL / mobile / reduced-motion path also showcases
  the product. No new sections are added; `FeatureGrid` / `FinalCta` are unchanged.

## Testing / verification

- `pnpm test copy` — the `mediaAlignFor` pure helper (only unit-testable piece; repo
  convention keeps non-UI logic in `src/lib` and UI is typecheck/build-verified).
- `pnpm exec tsc --noEmit` — typecheck gate.
- `pnpm build` — runtime/bundle gate.

## Out of scope / YAGNI

- No real screenshots or device-frame capture.
- No live data or backend calls in the mocks.
- No changes to the 3D scene geometry, camera keyframes (`scenes.ts`), ocean, vessel, or
  the crossfade timeline.
- No new page sections; `ecosystem` and `finale` beats keep their current design.
