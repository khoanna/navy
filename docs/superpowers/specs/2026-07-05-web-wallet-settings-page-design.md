# Web Wallet — Settings / Account Page (design)

**Date:** 2026-07-05
**App:** `web-wallet/`
**Status:** Approved, ready for planning
**Depends on:** the session-guard work landed earlier this session (`(tabs)/layout.tsx` auth guard, `useWebSigner` embedded-wallet provisioning).

## Goal

Give the end-user wallet a Settings screen that surfaces the account-management
features Privy actually supports (verified against `@privy-io/react-auth@2.25.0`
`.d.ts`, per the SDK-drift convention). Requested capabilities: **log out**,
**add a passkey login**, and **wallet recovery**. Scope was widened during
brainstorming to the full supported set: **linked-accounts management** and
**MFA enrollment**.

## Privy capabilities used (v2.25.0, verified against installed `.d.ts`)

| Capability | Hook / method | Notes |
|---|---|---|
| Log out | `useNavySession().signOut()` → `usePrivy().logout()` | Already wired; clears Navy tokens + Privy, redirect `/login`. |
| Add passkey | `useLinkWithPasskey().linkWithPasskey()` | Adds a passkey as a **login method** (distinct from login-with-passkey and from MFA passkey enrollment). Exposes `state: PasskeyFlowState`. |
| Link account | `useLinkAccount()` → `linkEmail() / linkGoogle() / linkApple()` | Opens Privy's hosted modal. Only Email/Google/Apple/Passkey surfaced (matches login screen). |
| Unlink account | `usePrivy().unlinkEmail(addr) / unlinkGoogle(sub) / unlinkApple(sub) / unlinkPasskey(credId)` | Returns updated `User`. Privy rejects unlinking the **last** account, so UI only offers unlink when >1 linked account remains. |
| Wallet recovery backup | `useSetWalletRecovery().setWalletRecovery()` | Password / iCloud / Google-Drive backup for the embedded wallet. Privy modal. |
| Export private key | `useExportWallet().exportWallet({ address })` (from `@privy-io/react-auth/solana`) | Reveals key in a Privy iframe; app never sees it. `address` from `useWebSigner()`. |
| MFA | `useMfaEnrollment().showMfaEnrollmentModal()` | Privy hosted modal covers TOTP/SMS/passkey — no custom QR/TOTP UI. |
| Identity | `usePrivy().user` (`email`, `google`, `apple`, `linkedAccounts[]`, `createdAt`, `mfaMethods[]`) | Source for the identity header + linked-accounts list. |

`useRecoverEmbeddedWallet()` is intentionally **not** used — it is a login-time
recovery flow, not a settings action.

## Entry point

A **5th bottom tab**. Add to `src/ui/TabBar.tsx`:
`{ href: '/settings', label: 'Settings', icon: 'settings' }`. The tab bar
currently has 4 items; a 5th fits the existing even-flex layout. Requires a new
`settings` (gear) glyph in `src/ui/Icon.tsx` — no existing icon fits.

## Screen structure — `src/app/(tabs)/settings/page.tsx`

Lives inside the `(tabs)` route group, so it inherits the auth guard and TabBar.
Top-to-bottom, built from existing `Screen` / `Card` / `PressRow` / `Bits`:

1. **Identity header** — deterministic gradient avatar (reuse the home hero's
   `avatarColors`), primary label (email if present else short address), wallet
   address as a copy pill (reuse the home copy-pill pattern).
2. **Linked accounts** card — one row per `linkedAccounts` entry (icon + label +
   "linked" caption), each with an **unlink** action guarded by `canUnlink`
   (only when >1 account). Below, **link** rows for not-yet-linked providers
   (Email / Google / Apple / Passkey) → `useLinkAccount()`.
3. **Wallet security** card — **Set up recovery** (`setWalletRecovery()`) and
   **Export private key** (`exportWallet({address})`), the latter behind a
   warning confirmation `Sheet`.
4. **Login & security** card — **Add passkey** (`linkWithPasskey()`) and
   **Two-factor authentication** (`showMfaEnrollmentModal()`).
5. **Log out** — danger `Button` behind a confirm `Sheet` → `signOut()` →
   `router.replace('/login')`.

## Architecture / isolation

Most actions simply invoke a Privy hook that opens Privy's own modal, so custom
UI stays thin: rows, two confirmation `Sheet`s (export key, log out), and toasts
driven by each hook's `onSuccess` / `onError` callbacks.

The one piece of real logic — turning `user.linkedAccounts` into display rows —
is extracted into a **plain-TS, framework-free** module so it is unit-testable
per the repo convention ("keep non-UI logic in plain-TS modules"):

`src/lib/account/linkedAccounts.ts`
- `describeLinkedAccounts(user): LinkedAccountRow[]` — maps each linked account
  to `{ type, icon, label, subtitle, unlinkId }`.
- `linkableProviders(user): ProviderId[]` — which of Email/Google/Apple/Passkey
  are **not** yet linked (for the "link" rows).
- `canUnlink(user): boolean` — true when `linkedAccounts.length > 1`.

`LinkedAccountRow` carries an `unlinkId` (email address / OAuth subject /
credentialId) plus the provider `type`; the screen maps `type` → the correct
`usePrivy().unlink*` function. No Privy or Next imports in this module.

## Testing

- `src/lib/account/linkedAccounts.test.ts` — jest unit tests for
  `describeLinkedAccounts`, `linkableProviders`, `canUnlink` against
  representative `User` fixtures (email-only, email+google, passkey, single vs
  multiple accounts). This is the only `src/lib/**` logic and the only unit-test
  surface.
- Screen, TabBar, Icon: verified by `pnpm exec tsc --noEmit` **and** `pnpm build`
  (the runtime gate that catches browser-bundle issues `tsc` misses), matching
  how every other web-wallet screen is validated.

## Out of scope (YAGNI)

- Phone / SMS **linking** (SMS still available inside the MFA modal).
- The social long tail (Twitter, Discord, GitHub, TikTok, etc.) — only
  Email/Google/Apple/Passkey, matching the login screen.
- `useUpdateEmail` / account deletion / cross-app accounts / wallet import.
- Delegated actions, custom MFA UI (Privy's hosted modal is used instead).
