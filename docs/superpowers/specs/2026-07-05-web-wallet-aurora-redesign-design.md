# Web-Wallet "Aurora" Visual Redesign — Design Spec

**Date:** 2026-07-05
**App:** `web-wallet/` (Next.js 16, mobile-first web wallet)
**Status:** Approved for planning

## 1. Purpose

The Navy web-wallet is the surface end users touch daily — balances, scan-to-pay,
receive, earn, activity. This spec re-skins the entire wallet in a single cohesive
visual system ("Aurora Glass") and tightens the interaction details that make a
payment wallet feel premium and trustworthy on a phone.

This is a **presentation-layer redesign**, not a feature change. Business logic,
auth, chain calls, and the `src/lib/**` plain-TS modules are untouched except for
one deliberate cleanup (removing dead SMS/phone login — see §7). All work stays in
`src/ui/**` and `src/app/**` screens.

## 2. Design direction: Aurora Glass (Navy palette)

Dark, premium, glass-panelled with a subtle "aurora" glow behind the balance —
an evolution of today's deep-ocean navy, not a departure. Chosen over a light-minimal
and a violet-aurora alternative because it (a) keeps the "Navy" brand identity,
(b) reads as premium/fintech, and (c) suits a payment app where calm trust matters.

**Palette (extends `src/ui/theme.ts`, on-brand blue→seafoam):**
- Base canvas `#060B17` with two radial aurora glows: navy-blue `#123A7A` top-right,
  teal `#0A5A6B` mid-left, both fading to transparent. This is a new reusable
  `AuroraBackground` behind the app shell.
- Glass panels: `rgba(255,255,255,0.055)` fill, `1px rgba(255,255,255,0.09)` border,
  `border-radius` 18–20. New `Card` variant `glass`.
- Hero balance: gradient text `#8FB4FF → #4FE6C8` (existing `gradients.ocean`).
- Primary action / CTA: filled `ocean` gradient, `onAccent` text.
- Accents/semantic unchanged (`accent` blue, `aqua` seafoam, `success`, `danger`).

**Typography:** system stack (unchanged). Money **always** uses
`font-variant-numeric: tabular-nums` so amounts don't jitter — added to the `Text`
`numeric` variant. Big balances use the existing `display` scale.

**Motion (CSS-only, respects `prefers-reduced-motion`):** button press `scale(0.97)`
120ms; bottom sheets slide up via `translateY` + keyframes; success check draws via
`stroke-dashoffset`; balance/list loading uses a shimmer skeleton; tab focus lifts
`translateY(-2px)` (already present). No animation library.

## 3. Navigation

Four-tab floating glass pill (keep existing `TabBar` structure and routes):

| Tab | Route | Label | Notes |
|---|---|---|---|
| Home | `/home` | Wallet | balance + actions + activity preview |
| Pay | `/scan` | Pay | full-bleed scanner |
| Earn | `/farming` | Earn | farming position |
| Activity | `/history` | Activity | full history |

**Receive is a Home quick-action, not a tab** (decided). It pushes a `/receive`
screen (new route, no tab). Quick-action row on Home = **Receive · Pay · Earn**,
with Pay as the filled primary.

## 4. Screens

Each screen is a thin `src/app` client component composing `src/ui` primitives.
Fidelity target is the approved mockups in `.superpowers/brainstorm/**`.

**4.1 Login** (`/login`) — Aurora background, brand mark (gradient rounded-square
anchor), wordmark + tagline. **Email OTP is the primary channel** (input → "Send code"
→ 6-digit boxed OTP → "Verify & sign in", with "change email" + "resend"). Below an
"or" divider: Passkey, Google, Apple buttons. "Secured by Privy · non-custodial"
footnote. **No phone/SMS** (see §7). New OTP input is a 6-box component replacing
today's single letter-spaced field.

**4.2 Home** (`/home`) — header (Welcome + name, notification + logout icon buttons);
centered balance hero: "Total balance · ⚡ Gasless" eyebrow, gradient big number,
sub-line "`{SOL}` SOL · `{delta}` today"; quick-action row (Receive/Pay/Earn); one
**rule-based tip card** (glass, gradient-tinted) when a simple condition holds (e.g.
idle USDC ≥ threshold → "Idle USDC could earn 4.2% — move to the Earn vault"); Activity
section header ("See all") + a glass card previewing the 3 most-recent items. Keeps
pull-to-refresh.

**4.3 Pay · Scan** (`/scan`) — full-bleed camera, dimmed surround with a centered
rounded framing reticle + animated scan line, top bar (close · "Scan to pay" · torch),
"Point at a Navy QR code" hint, and a "Paste address instead" fallback button. Auto-detect
(no shutter). Uses existing `useQrScanner`.

**4.4 Pay · Confirm** (bottom sheet over scan/home) — drag-handle sheet: merchant
avatar + name + "verified ✓", big amount + USDC, a glass key/value block
(**"Network fee: Sponsored · Gasless ⚡"**, "You pay"), and a **slide-to-pay** control
(decided — deliberate money-moving friction). Wraps existing `payFlow`.

**4.5 Pay · Success** — centered animated seafoam check (glow), "Paid `{amt}` USDC to
`{merchant}`", glass block ("Confirmed on-chain", "Fee paid by you: $0.00"),
"View on explorer ↗" secondary + "Done" primary.

**4.6 Receive** (`/receive`, new) — back header, white QR card, "Your Navy address"
label + mono truncated address in a glass field, Copy + Share row, and a chain/asset
hint ("Only send SOL or USDC (SPL) on Solana devnet…").

**4.7 Earn** (`/farming`) — header ("Earn" · "Save · devnet"); gradient-glass position
hero ("Deposited · earning", big value, "`{APY}` · +`{earned}`"); Deposit/Withdraw row;
"How it works" plain-language security explainer (encrypted subwallet, off-policy-proof);
Positions list. Reuses `farmingClient`.

**4.8 Activity** (`/history`) — header + search icon; filter chips (All / Payments /
Earn); items grouped by day (Today / Yesterday / date), each a glass row with typed
icon, counterparty, time·status, and signed amount (received = seafoam `+`).

## 5. Shared UI work (`src/ui`)

- **`AuroraBackground`** — new; fixed radial-gradient wash behind the app shell.
- **`Card` `glass` variant** — translucent fill + hairline border.
- **`SlideToConfirm`** — new; pointer/touch drag-to-confirm control (used on Pay).
- **`OtpInput`** — new; 6-box code input, numeric, autofocus/advance.
- **`Sheet`** — new; bottom-sheet primitive (scrim + slide-up + drag handle).
- **`SuccessCheck`** — new; CSS stroke-draw check with glow.
- **`Skeleton`** — new; shimmer block for loading balance/lists.
- **`Text`** — add `tabular-nums` to `numeric`.
- **`TabBar`** — relabel Scan→"Pay"; keep routes/structure.
- **`Screen`** — ensure `viewport-fit=cover` + `env(safe-area-inset-*)` padding
  (top and bottom) on every screen; sticky CTAs clear the home indicator.

All primitives stay framework-light (inline styles + tokens, matching the existing
pattern) so screens remain thin and typecheck-gated.

## 6. Mobile-web guardrails (apply everywhere)

- Inputs `font-size: 16px` min (prevent iOS zoom) — already the login convention.
- Tap targets ≥ 44×44.
- Primary actions in the bottom/thumb zone; sheets and CTAs bottom-anchored.
- Safe-area insets on header and tab bar.
- `prefers-reduced-motion` disables non-essential motion.
- Verify by `pnpm build` (runtime gate), not just `tsc` — per CLAUDE.md, watch for
  `@solana/web3.js` Buffer/crypto bundle issues on any newly-loaded screen.

## 7. Deliberate cleanup: drop SMS/phone login

Privy SMS is **US/Canada only** (dashboard-confirmed), unusable for the Vietnam user
base. Remove from `src/app/login/page.tsx`: `useLoginWithSms`, the `Channel`
email/phone segmented toggle, the phone input, and phone branches in `sendCode`/`verify`.
Login collapses to email OTP + passkey + Google + Apple. No backend change (Privy
still issues the same identity token consumed by `/auth/privy`).

## 8. Out of scope (YAGNI)

- No swap / stake / liquidity (not Navy features — reference apps only).
- No AI advisor (tips are rule-based, not model-driven).
- No new backend endpoints, chain instructions, or `src/lib` logic changes.
- No light theme (dark Aurora only).
- No animation/UI dependency added.

## 9. Testing / verification

- `src/lib/**` unit tests remain green (unchanged logic).
- New pure helpers (e.g. tip-eligibility rule, OTP formatting) get plain-TS unit tests.
- Screens/primitives verified by `pnpm exec tsc --noEmit` **and** `pnpm build`.
- Manual pass on a phone viewport (or devtools device mode) for each screen:
  safe-area, tap targets, no input zoom, slide-to-pay, success animation.
