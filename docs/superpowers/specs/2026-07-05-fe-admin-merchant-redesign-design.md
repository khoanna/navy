# FE Admin + Merchant Dashboard Redesign — Design

**Date:** 2026-07-05
**App:** `fe/` (Next.js admin + merchant web) — with two supporting read-only endpoints in `be/`
**Status:** Approved (design phase)

## Problem

`fe/` (the admin + merchant back-office) is functionally complete but visually brutalist:
inline styles, `#ddd` table borders, `crimson` error text, no design system, fixed-width
single-column pages. Meanwhile `web-wallet/` has a polished, token-driven "deep-ocean aurora"
design system (`web-wallet/src/ui/theme.ts` + primitives). The two apps look like different
products.

**Goal:** Re-house the entire `fe/` app in web-wallet's visual language, adapted from the
430px phone-column layout into a **desktop dashboard shell** (persistent left sidebar + top
bar + responsive content grid), modelled on the provided reference dashboard. Add real
metric/chart content to the two Overview landing pages.

## Locked decisions

- **Scope:** the whole `fe/` app — all admin pages (login, overview, merchant list, merchant
  detail) and all merchant pages (login, overview, orders list, create invoice, order detail).
- **Design system:** **port** web-wallet's token layer + primitives into `fe/src/ui` (inline-style
  theme tokens, no Tailwind, no new UI deps) — matches the codebase convention.
- **Layout:** desktop **sidebar shell** (not the phone frame; not a centered column).
- **Dashboard depth:** stat cards + a trend chart + recent-activity lists.
- **Backend:** may add **read-only** aggregate endpoints (with tests); **no schema changes**.
- **Charts:** hand-rolled SVG (no chart library), matching web-wallet's dependency-free sparkline
  aesthetic.

## Non-goals

- No changes to auth/session plumbing, the backend payment/farming logic, or the Prisma schema.
- No real-time transport change (existing 4s polling on order lists stays).
- No new merchant/admin *features* — only presentation + two aggregate read endpoints.
- web-wallet is untouched (it is the source of truth for the shared tokens; we copy, not import
  across apps — they are independent apps with separate `package.json`).

---

## Architecture

### Shared shell, role-parameterized

One `AppShell` renders the sidebar + top bar + content region for both roles. A nav config
(per role) drives the sidebar items. Admin and merchant are visually identical in chrome and
differ only in nav entries + page content. Login pages render **outside** the shell.

```
AppShell(role)
 ├─ Sidebar(navItems, identity)     // fixed left, ~248px
 ├─ TopBar(title, eyebrow, search?, profileChip)
 └─ <content>                        // max-width ~1360px, responsive CSS grid
```

### Design-system port → `fe/src/ui/`

Copied verbatim from `web-wallet/src/ui` (kept token-for-token identical so the two apps stay
in sync):

- `theme.ts` — `colors`, `gradients`, `space`, `radius`, `type`.
- `Text.tsx`, `Card.tsx`, `Button.tsx`, `Bits.tsx` (`Pill`, `IconBadge`, `GlowIcon`, `Field`,
  `Divider`, `PressRow`), `Icon.tsx`.
- `Icon.tsx` gains a few desktop glyphs: `users`, `store`, `orders`, `key`, `chart` (reuse
  existing `logout`, `search`, `settings`, `wallet`, `shield`, `trend`, `check`, `chevron`).

New desktop-only primitives (`fe/src/ui/`):

| Component | Responsibility | Notes |
|---|---|---|
| `AppShell` | sidebar + top bar + content frame; aurora body background | client component; wraps authenticated pages |
| `Sidebar` | Navy logo, role nav (active item on `gradients.ocean`), identity + Logout pinned bottom | active state via `usePathname()` |
| `TopBar` | page title + eyebrow, optional search field, profile chip (`avatarColors` identicon + short id) | restrained; colour only on interactive states |
| `StatCard` | one metric: `numeric` figure + label eyebrow + optional delta `Pill`; `featured` variant rides ocean gradient | pure presentational |
| `TrendChart` | hand-rolled SVG area+line chart from a `{date, value}[]` series; gradient fill | no deps; matches web-wallet sparkline |
| `DataTable` | glass-card table/list: hairline row dividers, `IconBadge` lead, `Pill` status, header eyebrow | replaces raw `<table>` styling |
| `AuthCard` | centered aurora card shell for login pages (no sidebar) | mirrors web-wallet `/login` |

### Pure-logic helpers → `fe/src/lib/` (unit-tested)

Framework-free modules so screens stay thin and typecheck-verified (per repo convention):

- `fe/src/lib/dashboard/stats.ts` — shape/format stat values (money base-unit→decimal display,
  counts, deltas). Reuses existing `money.ts`.
- `fe/src/lib/dashboard/chart.ts` — map a `{date, value}[]` series to SVG path/area geometry
  (min/max scaling, point coordinates, smoothing). Pure math, fully unit-tested.
- `fe/src/lib/dashboard/status.ts` — map order/merchant status → `Pill` tone + label.

Jest in `fe/` only runs `src/lib/**/*.test.ts`, so these get real tests; `AppShell`/pages are
verified by `tsc --noEmit` + `next build`.

### Navigation

- **Admin:** Overview (`/admin`) · Merchants (`/admin/merchants`).
- **Merchant:** Overview (`/merchant`) · Orders (`/merchant/orders`) · New Invoice
  (`/merchant/orders/new`).
- Sidebar bottom: identity chip + **Logout** (danger ghost button; reuses existing logout call).
- `/admin/login` and `/merchant/login` render in `AuthCard`, no shell.

---

## Screens

### Admin Overview (`/admin/page.tsx`) — new content

- **Stat cards** (from `GET /admin/stats`): Total merchants · Pending approval (warning tone,
  links to `?status=pending`) · Approved / on-chain registered · Total payment volume (USDC, all
  merchants).
- **`TrendChart`** — platform payment volume, last 30 days.
- **Pending review** list — recent pending merchants, each row → `/admin/merchants/[id]`.
- **Recent payments** list — recent paid orders across merchants (from stats payload).

### Merchant Overview (`/merchant/page.tsx`) — new content + re-housed panels

- **Featured hero** (ocean gradient `StatCard`): Total revenue (Σ paid orders) + paid-count delta.
- **Stat cards:** Paid · Awaiting payment · Expired.
- **`TrendChart`** — daily paid volume, last 30 days.
- **Recent orders** list — restyled, keeps 4s polling; rows → `/merchant/orders/[id]`.
- **API Credentials** card — existing `ApiKeyPanel` re-housed (not rewritten).
- **Payout Wallet** card — existing `WalletConnect`/`WalletConnectClient` re-housed.

### Restyled inner pages (presentation only, data flow unchanged)

- `/admin/merchants` — status-filtered `DataTable` (Business, Email, Status `Pill`, Payout
  registered ✓/—, Review). Filter chips restyled.
- `/admin/merchants/[id]` — detail via `Field` rows; Approve/Reject `Button`s (Approve disabled
  without payout, unchanged logic); on-chain tx → explorer link; rejection reason surfaced.
- `/merchant/orders` — filtered `DataTable` (Reference, Amount, Status `Pill`, View); 4s polling
  unchanged.
- `/merchant/orders/new` — restyled form (`Card` + `Button`), validation via existing `money.ts`;
  success renders QR + payUrl + orderId in a result `Card`.
- `/merchant/orders/[id]` — detail via `Field` rows; live status `Pill`; polling unchanged.
- `/admin/login`, `/merchant/login` — `AuthCard`; keep TOTP / email+password / signup logic.

### Status → Pill tone mapping (`status.ts`)

| Status | Tone |
|---|---|
| `paid`, `approved` | success |
| `awaiting_payment`, `pending` | warning |
| `expired`, `rejected`, `failed` | danger |
| other | neutral |

---

## Backend — two read-only endpoints (`be/`)

Prisma aggregations over existing `Order` / `Merchant` tables. No schema change. Money returned
as **strings** (BigInt is not JSON-serializable — repo convention). Service logic isolated and
unit-tested; controllers thin and role-guarded.

### `GET /merchant/stats` — merchant JWT (`@Roles('merchant')`)

Scoped to the caller's merchant. Returns:

```jsonc
{
  "totalRevenue": "string",   // Σ amount of paid orders (base units, as string)
  "paidCount": number,
  "awaitingCount": number,
  "expiredCount": number,
  "series": [ { "date": "YYYY-MM-DD", "amount": "string" } ]  // daily paid volume, last 30 days (zero-filled)
}
```

### `GET /admin/stats` — admin JWT (`@Roles('admin')`)

Platform-wide. Returns:

```jsonc
{
  "merchantsTotal": number,
  "pending": number,
  "approved": number,
  "rejected": number,
  "onchainRegistered": number,
  "ordersTotal": number,
  "volumeTotal": "string",     // Σ paid across all merchants (base units, string)
  "series": [ { "date": "YYYY-MM-DD", "amount": "string" } ],  // last 30 days, zero-filled
  "recentPending":  [ /* trimmed merchant rows */ ],
  "recentPayments": [ /* trimmed paid-order rows */ ]
}
```

### Frontend data access

New proxy route handlers `fe/src/app/api/merchant/stats/route.ts` and
`fe/src/app/api/admin/stats/route.ts`, using the existing `sessionBackendFetch` pattern (Bearer
from the session cookie). No new auth code.

---

## Error handling

- Stats fetch failure → Overview renders skeletons then a quiet inline "couldn't load metrics"
  state; the rest of the page (lists/panels) still works.
- Empty series → `TrendChart` renders a flat baseline + `GlowIcon` empty hint, no crash.
- Unapproved merchant (existing 409 on order create) → same message, restyled.
- Zero-division in deltas/scaling guarded in the pure `chart.ts`/`stats.ts` helpers (covered by
  unit tests).

## Testing / verification

- **`be/`:** `pnpm test` for the stats service (aggregation math, zero-fill, BigInt→string,
  merchant scoping); `pnpm build` (typecheck).
- **`fe/`:** `pnpm test` for `lib/dashboard/*` (chart geometry, stat formatting, status mapping);
  `pnpm exec tsc --noEmit`; **`pnpm build`** (the runtime gate — catches bundle/polyfill issues
  `tsc` misses).
- Manual: shell renders for both roles, active nav highlight, charts draw, polling still live,
  login pages unaffected.

## Risks / notes

- **Cross-app token drift:** `fe/src/ui` is a *copy* of web-wallet tokens; if web-wallet's theme
  changes later the two can diverge. Accepted — they are independent apps by design; the copy is
  intentional. Keep the copied files token-identical to ease manual sync.
- **`next build` is the real gate:** `@solana/web3.js` (via `WalletConnect`) already runs in `fe/`;
  the shell adds no new browser-polyfill surface, but build must pass, not just `tsc`.
- Charts are presentation-grade (SVG), not analytics-grade — adequate for a 30-day trend.
