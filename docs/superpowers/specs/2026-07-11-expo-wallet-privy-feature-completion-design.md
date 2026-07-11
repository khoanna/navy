# Expo Wallet — Privy Feature Completion (client)

**Date:** 2026-07-11
**Status:** Design approved
**Scope:** Complete the self-contained Privy features in `expo-wallet/` that build on the existing auth/wallet/MFA foundation — **wallet recovery**, **passkey as a second MFA method**, **MFA-gated transaction signing**, and a **fund-wallet on-ramp**. All work is client-side in `expo-wallet/`; no backend changes.

This is **sub-project A** of a two-part effort. **Sub-project B** — delegated farming signing via Privy session signers, which spans `expo-wallet/` + `be/` and must be reconciled against the existing envelope-encrypted farming subwallet custody model — is deferred to its own spec (`2026-07-1x-expo-wallet-delegated-farming-signing-design.md`).

## Background

The Expo port already ships (from `2026-07-06-expo-wallet-account-security-design.md` and the RN port): email OTP login/link/unlink, Google/Apple OAuth login/link/unlink, passkey login/link/unlink, an auto-provisioned embedded Solana wallet with transaction signing (`useMobileSigner`), and **TOTP** MFA enrollment/unenroll.

Re-verifying the installed `@privy-io/expo@0.70.0` types confirms four more capabilities exist in the **expo** package (not just web) and are worth finishing:

| Feature | Hook(s) | Verdict |
|---|---|---|
| Wallet recovery | `useSetEmbeddedWalletRecovery()`, `useRecoverEmbeddedWallet()`, `useOnNeedsRecovery()` | Build — passcode + iCloud/Google Drive |
| Passkey as 2FA | `useMfaEnrollment()` `method: 'passkey'` | Build — alongside existing TOTP |
| MFA-gated signing | `useMfa()`, `useRegisterMfaListener()` | Build — custom bottom-sheet prompt |
| Fund wallet (on-ramp) | `useFundSolanaWallet()` (`@privy-io/expo/ui`) | Build — needs `<PrivyElements/>` mounted |
| SMS login / SMS 2FA | `useLoginWithSMS()`, `useLinkSMS()`, MFA `method: 'sms'` | **Out of scope** (user decision) |
| Private-key / seed export | *none in `@privy-io/expo`* | **Not possible** — no `useExportWallet`/`getPrivateKey` on mobile |

**User decisions:** build recovery (passcode + iCloud/Google Drive), passkey MFA, MFA-gated signing (custom bottom-sheet), and fund-wallet on-ramp. Skip SMS. Defer all session-key/delegated-signing work to sub-project B.

## Verified hook shapes (`@privy-io/expo@0.70.0`)

Confirmed against the installed `.d.ts` files. The implementer re-verifies exact field names (SDK drift) before coding each hook.

- **Recovery**
  - `useSetEmbeddedWalletRecovery()` → `{ setRecovery(params) }` where `params` is a union:
    `{ recoveryMethod: 'user-passcode'; password: string }` | `{ recoveryMethod: 'google-drive' }` | `{ recoveryMethod: 'icloud' }` | `{ recoveryMethod: 'recovery-encryption-key'; recoveryKey: string }` | `{ recoveryMethod: 'privy' }`. Returns `{ user: User | null }` (`null` when a flow defers, e.g. cloud picker).
  - `useRecoverEmbeddedWallet()` → `{ recover(params) }`, same `params` union (minus set-only cases).
  - `useOnNeedsRecovery(callback)` — global listener; fires when the wallet needs recovery on a new device / after local state wipe.
- **Passkey MFA** — `useMfaEnrollment()`:
  - `initMfaEnrollment({ method: 'passkey' })` → `Promise<void>` (triggers native passkey sheet).
  - `submitMfaEnrollment({ method: 'passkey', credentialIds: string[], removeForLogin?: boolean })` → `Promise<void>`.
  - `unenrollMfa({ method: 'passkey', removeForLogin?: boolean })` → `Promise<void>`.
  - (existing TOTP overloads unchanged.)
- **MFA verification** — `useMfa()`: overloaded `init()` / `submit()` per method (`sms` | `totp` | `passkey`) plus `prompt()`, `cancel()`, `clear()`. `useRegisterMfaListener(cb)` — `cb` receives the required `MfaMethod[]` when any Privy action needs step-up verification.
- **Fund wallet** — `useFundSolanaWallet()` (from `@privy-io/expo/ui`) → `fundWallet({ address })`. Requires `<PrivyElements/>` mounted in the tree.
- MFA enrollment status is read from `usePrivy().user` (e.g. `user.mfa_methods`); the implementer verifies the exact field and shape.

## Architecture

Follow the repo convention: pure, framework-free logic in `src/lib/**` (jest-unit-tested via `pnpm test`, which runs `src/lib/**/*.test.ts`); thin UI components orchestrate the Privy hooks and are verified by `pnpm exec tsc --noEmit` + the expo build gate.

### Pure logic — `src/lib/account/` (unit-tested)

- **`recovery.ts`** (+ `recovery.test.ts`)
  - `availableRecoveryMethods(platformOS)` → ordered list of selectable methods for the platform (`icloud` on iOS, `google-drive` on Android, `user-passcode` everywhere).
  - `currentRecoveryState(user)` → derives whether recovery is set and which method, from the `user` object.
  - `recoveryMethodLabel(method)` → display label.
  - `isValidPasscode(passcode)` / `passcodesMatch(a, b)` → passcode rules for the set-passcode flow.
- **`mfaFlow.ts`** (+ `mfaFlow.test.ts`) — pure state machine for the step-up prompt:
  - given `MfaMethod[]`, produce the initial prompt state, allow method selection, and validate a submitted code (reuse `@/lib/ui/otp` `isComplete` for TOTP/SMS codes; passkey needs no code). No Privy imports — the sheet feeds it inputs and reads back the next UI state.
- **`mfa.ts`** (extend; **fill the empty `mfa.test.ts`**) — add helpers for the multi-method world: `enrolledMfaMethods(user)`, keep `mfaMethodLabel`/`isValidEnrollCode`/`otpauthSecretGroups`. Passkey label already exists.
- **`linkedAccounts.ts`** — unchanged logic, but **fill the empty `linkedAccounts.test.ts`** while we're here (currently untested).

### UI components (custom, existing primitives)

- **`src/features/settings/RecoverySheet.tsx`** — `{ open, onClose, onDone }`. Method picker from `availableRecoveryMethods(Platform.OS)`. Passcode path: two `TextInput`s (enter + confirm, validated by `recovery.ts`) → `setRecovery({ recoveryMethod: 'user-passcode', password })`. Cloud path: single tap → `setRecovery({ recoveryMethod: 'icloud' | 'google-drive' })` (opens the native picker). Toast on error; `onDone` on success.
- **`src/features/mfa/MfaPromptSheet.tsx`** — custom bottom-sheet styled like `MfaEnrollSheet`, driven by `useMfa` + `mfaFlow.ts`. Shows the required method(s); for TOTP/SMS renders `OtpInput` → `submit`; for passkey a single "Verify" action. Cancel calls `useMfa().cancel()`. Purely reactive to the listener — never opened manually.
- **`src/features/mfa/MfaProvider.tsx`** — mounts at root, registers `useRegisterMfaListener` and renders `MfaPromptSheet` when a step-up is required. This is what makes `signTransaction` in the pay/farming flows prompt for MFA when the user is enrolled — no changes needed in `useMobileSigner` or the pay/farming screens.
- **`src/features/mfa/RecoveryGate.tsx`** — mounts at root, registers `useOnNeedsRecovery`, and renders a recovery prompt (`useRecoverEmbeddedWallet`) when the SDK signals the wallet needs recovery on this device (passcode entry, or cloud one-tap).
- **`src/features/wallet/FundButton.tsx`** — `{ address }`. "Add funds" button → `useFundSolanaWallet().fundWallet({ address })`. Reuses existing button primitives; no-op/disabled when `address` is undefined.

### Passkey MFA (extend existing sheet)

Extend **`MfaEnrollSheet`** with a small method picker (TOTP | Passkey). TOTP path is unchanged. Passkey path: `initMfaEnrollment({ method: 'passkey' })` → on the native sheet result, `submitMfaEnrollment({ method: 'passkey', credentialIds })`. Keep the sheet a single component; the picker just branches the body.

### Screen composition

- **`app/_layout.tsx`** — mount `<PrivyElements/>` (`@privy-io/expo/ui`) inside the Privy tree; wrap the authed tree with `<MfaProvider>` and `<RecoveryGate>` (both no-render until their listener fires). Order: `PrivyProvider` → `PrivyElements` → session/providers → gates.
- **`app/(tabs)/settings.tsx` — Security section:**
  - **Wallet recovery** row → shows `currentRecoveryState(user)` ("iCloud" / "Passcode" / "Not set") → opens `RecoverySheet`.
  - **Two-factor authentication** → show the **list** of enrolled methods (`enrolledMfaMethods(user)`): each with a Remove action; an "Add method" entry opens `MfaEnrollSheet` (picker: Authenticator app / Passkey).
- **`app/(tabs)/home.tsx`** hero and **`app/(tabs)/receive.tsx`** — render `<FundButton address={address} />` ("Add funds").
- Everything else (identity header, linked accounts, about, sign-out, pay/farming/scan/history) unchanged.

## Error handling

Every hook call is wrapped in the screen's existing `run(fn, label)` toast pattern (try/catch → `useToast`). Sheets keep local `busy` state and disable actions in flight. User-cancelled native prompts (passkey, cloud picker, MFA cancel) are caught, non-fatal toasts. The MFA prompt and recovery gate must be resilient to being dismissed and re-triggered.

## Config prerequisites (operator, on-device)

These flows only fully complete on a dev-client build with the features enabled in the Privy dashboard:
- **MFA** (TOTP + passkey) enabled for the app; MFA-gating requires MFA to be an enforced/available step-up in the dashboard.
- **Recovery**: iCloud recovery needs the iOS entitlement/associated config; Google Drive needs the Android config; passcode works without extra platform config.
- **Fund wallet**: the dashboard on-ramp provider (MoonPay/Coinbase) must be configured; otherwise the funding modal shows Privy's "unavailable" state — the button still renders.
- **Passkey** reuses the existing associated-domain / relying-party config already required by passkey login.

No new backend work.

## Testing & gates

- **Pure logic** (`recovery.ts`, `mfaFlow.ts`, extended `mfa.ts`, backfilled `linkedAccounts.ts`): jest unit tests via `pnpm test`.
- **Sheets/screens/providers:** `pnpm exec tsc --noEmit` + the expo build gate (matching the web-wallet convention that `tsc` alone misses bundle issues). No unit tests for hook-orchestrating components.
- **Manual (dev-client):** recovery set + new-device recover, passkey MFA enroll + step-up on a pay tx, fund-wallet modal opens.

## Out of scope (explicit)

- All session-key / delegated-actions / `useSigners` / `useHeadlessDelegatedActions` work and any `be/` changes → **sub-project B**.
- SMS login, SMS link, SMS MFA → dropped per user decision.
- Private-key / seed-phrase export → not available in `@privy-io/expo`.
