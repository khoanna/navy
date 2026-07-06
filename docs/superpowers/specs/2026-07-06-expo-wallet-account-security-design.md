# Expo Wallet — Account-security actions in Settings

**Date:** 2026-07-06
**Status:** Design approved
**Scope:** Add three account-security flows to the Expo wallet's Settings screen — **email link, passkey link, and MFA (TOTP)** — each with custom UI built from existing primitives. Restores capability the web wallet had that was initially hidden in the Expo port.

## Background

The Expo port's Settings screen (`expo-wallet/app/(tabs)/settings.tsx`) currently supports linked-account display, unlink (email/OAuth/passkey), link-OAuth (Google/Apple), and sign-out. Five web features were initially hidden because an earlier port pass believed `@privy-io/expo` lacked the hooks. Re-verifying `@privy-io/expo@0.70.0`'s installed types shows that was incomplete — the hooks exist (two live on subpaths the earlier pass missed):

| Feature | Hook | Verdict |
|---|---|---|
| Email link | `useLinkEmail()` (main entry) | Build |
| Passkey link | `useLinkWithPasskey()` (**`@privy-io/expo/passkey`**) | Build |
| MFA / 2FA | `useMfaEnrollment()` (main entry) | Build (TOTP) |
| Recovery | `useSetEmbeddedWalletRecovery()` | **Out of scope** (user decision) |
| Export private key | *none* | **Not possible** — no `useExportWallet`/`revealPrivateKey`/`getPrivateKey` anywhere in the SDK; `@privy-io/expo` deliberately does not expose raw key export on mobile. Skipped. |

**User decisions:** build email-link + passkey-link + MFA; **custom UI** matching the Navy design language (not Privy hosted UI); MFA = **TOTP only** (SMS/passkey MFA deferred); skip recovery and export.

## Verified hook shapes (`@privy-io/expo@0.70.0`)

- `useLinkEmail(opts?)` → `OtpLinkHookResult`: `sendCode({ email })` then `linkWithCode({ code, email? })` — same OTP shape as the login email flow. `state` reflects flow progress.
- `useLinkWithPasskey(opts?)` (from `@privy-io/expo/passkey`) → `PasskeyHookResult<'link'>`: `linkWithPasskey(input)` (input carries the relying-party id, matching the login passkey call) + `state`.
- `useMfaEnrollment()` →
  - `initMfaEnrollment({ method: 'totp' })` → `Promise<{ authUrl?: string; secret?: string }>`
  - `submitMfaEnrollment({ method: 'totp', code })` → `Promise<void>`
  - `unenrollMfa({ method: 'totp' })` → `Promise<void>`
  - (`sms`/`passkey` overloads exist but are out of scope.)
- MFA enrollment status is read from `useMfa()` / `usePrivy().user` (the implementer verifies the exact field — e.g. `user.mfa_methods`).

## Architecture

Follow the repo convention: pure, framework-free logic in `src/lib/account/` (unit-tested with jest); thin UI components that orchestrate the Privy hooks. The Settings screen stays a composition of rows plus two Sheets.

### Pure logic — `src/lib/account/` (unit-tested)
Small helpers only (keep hook orchestration in the components):
- `mfaMethodLabel(method)` → display label for an MFA method.
- `isValidEnrollCode(code)` → 6-digit numeric check (reuse/wrap `@/lib/ui/otp`'s `isComplete` where possible rather than duplicate).
- `otpauthSecretGroups(secret)` → format a TOTP secret into readable groups for display/copy.
- (Email validity check reuses whatever the login screen uses; do not add a second email validator.)

### UI components (custom, using existing primitives)
- **`LinkEmailSheet`** — `{ open, onClose, onDone }`. Email `TextInput` → "Send code" (`useLinkEmail().sendCode`) → `OtpInput` (reused) → `linkWithCode`. Toast on error; `onDone` on success.
- **`MfaEnrollSheet`** — `{ open, onClose, onDone }`. `initMfaEnrollment({method:'totp'})` → render `secret` (grouped, copyable via `expo-clipboard`) + a QR of `authUrl` (`react-native-qrcode-svg`) → `OtpInput` for the authenticator's 6-digit code → `submitMfaEnrollment`. Toast on error; `onDone` on success.
- Passkey link is a **single inline action** (no sheet): an "Add a passkey" row → `linkWithPasskey({ relyingParty })`. Uses the SAME relying-party constant as the login passkey call (configure once, covers both).

### Settings screen composition (`app/(tabs)/settings.tsx`)
- **Linked accounts** (existing): keep unlink + link-OAuth. Add a **"Link email"** row when no email is linked → opens `LinkEmailSheet`. Add an **"Add a passkey"** row → `linkWithPasskey`. After success, existing `describeLinkedAccounts(user)` renders the new linked row automatically.
- **Two-factor authentication** (new section): read enrollment status; if not enrolled → "Enable 2FA" → `MfaEnrollSheet`; if enrolled → show "On" + a "Remove" action (confirm, then `unenrollMfa({method:'totp'})`).
- Keep everything else (identity header, about rows, sign-out) unchanged.

## Error handling
Every hook call is wrapped in the screen's existing `run(fn, label)` toast pattern (try/catch → `useToast`). Sheets keep local `busy` state and disable actions while in flight. A user cancelling the native passkey prompt is a caught, non-fatal toast.

## Config prerequisites (operator, on-device)
These flows only complete on a dev-client build with the features enabled in the Privy dashboard:
- **MFA** must be enabled for the app in the Privy dashboard.
- **Passkey** requires the associated-domain / RP id already needed by passkey login (`app.json` `associatedDomains` + the shared `relyingParty` constant).
These mirror the existing passkey-login prerequisite; no new backend work.

## Testing
- Pure helpers (`mfaMethodLabel`, `isValidEnrollCode`, `otpauthSecretGroups`) → jest unit tests (the real safety net).
- Sheets + hook wiring → `tsc --noEmit` clean + on-device dev-client verification (consistent with the rest of the port; Privy/native flows aren't unit-testable).

## Non-goals
Recovery, export-key, SMS-MFA, passkey-MFA, any `be/` or business-logic change. Unlink / link-OAuth / sign-out are untouched.
