# Expo Wallet — Account-security actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email-link, passkey-link, and MFA (TOTP) flows to the Expo wallet's Settings screen, with custom UI built from existing primitives.

**Architecture:** Pure helpers in `src/lib/account/` (jest-tested); two focused Sheet components in `src/features/settings/`; a shared relying-party constant; the Settings screen composes rows + sheets. All Privy calls use verified `@privy-io/expo@0.70.0` hooks.

**Tech Stack:** `@privy-io/expo` (`useLinkEmail`, `useMfaEnrollment`, `useMfa`), `@privy-io/expo/passkey` (`useLinkWithPasskey`), `react-native-qrcode-svg`, `expo-clipboard`, existing `@/ui` primitives (`Sheet`, `OtpInput`, `Button`, `Text`, `Field`), jest.

---

## Verified hook shapes (`@privy-io/expo@0.70.0` — confirm against installed `.d.ts` before use)

- `useLinkEmail()` → `{ sendCode({ email }), linkWithCode({ code, email? }), state }` (OTP shape, same as login email).
- `useLinkWithPasskey()` (from `@privy-io/expo/passkey`) → `{ linkWithPasskey({ relyingParty }), state }`.
- `useMfaEnrollment()` → `initMfaEnrollment({ method: 'totp' }) → Promise<{ authUrl?, secret? }>`; `submitMfaEnrollment({ method: 'totp', code }) → Promise<void>`; `unenrollMfa({ method: 'totp' }) → Promise<void>`.
- `useMfa()` → MFA state incl. enrolled methods (implementer verifies the exact field name against the installed `.d.ts` — likely `user.mfa_methods` on `usePrivy().user` or a list from `useMfa()`).

## Current state (read before editing)
- `expo-wallet/app/(tabs)/settings.tsx` already imports `usePrivy`, `useLinkWithOAuth`, `useUnlink*`, `describeLinkedAccounts`, `Sheet`, `Button`, `Text`, `Icon`, `IconBadge`/`PressRow`, `useToast`, and renders `const rows = describeLinkedAccounts(user)`. Follow its existing error-handling pattern (wrap async calls, toast on failure) — read it and match, don't invent a new one.
- `expo-wallet/app/login.tsx` uses `useLoginWithPasskey` with a hardcoded `relyingParty: 'navy.app'` (line ~61). Task 2 centralizes this.
- `expo-wallet/src/lib/ui/otp.ts` exports `isComplete(code, length)` and `normalizeOtp(raw, length)` — reuse for code validation.
- `expo-wallet/src/ui/OtpInput.tsx`, `Sheet.tsx`, `Button.tsx`, `Text.tsx`, `Bits.tsx` (`Field`, `IconBadge`, `PressRow`, `Divider`) exist. `react-native-qrcode-svg` + `expo-clipboard` are installed.
- Gates: full-repo `pnpm exec tsc --noEmit` is currently clean (0 errors) and `pnpm test` is 59/59. Keep both green.

## File structure
```
expo-wallet/
  src/lib/account/mfa.ts                 # NEW pure helpers (mfaMethodLabel, isValidEnrollCode, otpauthSecretGroups)
  src/lib/account/mfa.test.ts            # NEW jest tests
  src/lib/config/privy.ts                # NEW shared RELYING_PARTY constant
  src/features/settings/LinkEmailSheet.tsx   # NEW email-link flow
  src/features/settings/MfaEnrollSheet.tsx   # NEW MFA TOTP enroll flow
  app/login.tsx                          # MODIFY: use RELYING_PARTY constant
  app/(tabs)/settings.tsx                # MODIFY: add email-link row, passkey-link row, 2FA section
```

---

## Task 1: Pure MFA/code helpers (TDD)

**Files:**
- Create: `expo-wallet/src/lib/account/mfa.ts`
- Test: `expo-wallet/src/lib/account/mfa.test.ts`

- [ ] **Step 1: Write the failing test**

Create `expo-wallet/src/lib/account/mfa.test.ts`:
```ts
import { mfaMethodLabel, isValidEnrollCode, otpauthSecretGroups } from './mfa';

describe('mfaMethodLabel', () => {
  it('maps known methods to labels', () => {
    expect(mfaMethodLabel('totp')).toBe('Authenticator app');
    expect(mfaMethodLabel('sms')).toBe('Text message');
    expect(mfaMethodLabel('passkey')).toBe('Passkey');
  });
  it('falls back to the raw method for unknown values', () => {
    expect(mfaMethodLabel('email')).toBe('email');
  });
});

describe('isValidEnrollCode', () => {
  it('accepts a 6-digit code', () => {
    expect(isValidEnrollCode('123456')).toBe(true);
  });
  it('rejects short, long, or non-numeric codes', () => {
    expect(isValidEnrollCode('12345')).toBe(false);
    expect(isValidEnrollCode('1234567')).toBe(false);
    expect(isValidEnrollCode('12a456')).toBe(false);
    expect(isValidEnrollCode('')).toBe(false);
  });
});

describe('otpauthSecretGroups', () => {
  it('splits a secret into space-separated groups of 4, uppercased', () => {
    expect(otpauthSecretGroups('abcd efgh')).toBe('ABCD EFGH');
    expect(otpauthSecretGroups('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
  });
  it('returns empty string for empty input', () => {
    expect(otpauthSecretGroups('')).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd expo-wallet && pnpm test mfa.test`
Expected: FAIL — `Cannot find module './mfa'`.

- [ ] **Step 3: Write the implementation**

Create `expo-wallet/src/lib/account/mfa.ts`:
```ts
import { isComplete } from '@/lib/ui/otp';

export type MfaMethod = 'totp' | 'sms' | 'passkey';

const LABELS: Record<MfaMethod, string> = {
  totp: 'Authenticator app',
  sms: 'Text message',
  passkey: 'Passkey',
};

/** Human label for an MFA method; unknown methods echo back the raw value. */
export function mfaMethodLabel(method: string): string {
  return LABELS[method as MfaMethod] ?? method;
}

/** A valid enrollment code is exactly 6 digits. Reuses the OTP length rule. */
export function isValidEnrollCode(code: string): boolean {
  return /^\d{6}$/.test(code) && isComplete(code, 6);
}

/** Format a TOTP shared secret into uppercased groups of 4 for display/copy. */
export function otpauthSecretGroups(secret: string): string {
  const clean = secret.replace(/\s+/g, '').toUpperCase();
  if (!clean) return '';
  return (clean.match(/.{1,4}/g) ?? []).join(' ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd expo-wallet && pnpm test mfa.test`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
cd expo-wallet
git add src/lib/account/mfa.ts src/lib/account/mfa.test.ts
git commit -m "feat(expo-wallet): pure MFA/enroll-code helpers"
```

---

## Task 2: Shared relying-party constant

**Files:**
- Create: `expo-wallet/src/lib/config/privy.ts`
- Modify: `expo-wallet/app/login.tsx`

- [ ] **Step 1: Create the constant**

Create `expo-wallet/src/lib/config/privy.ts`:
```ts
/**
 * The passkey relying-party id — the app's associated domain, configured in the
 * Privy dashboard + iOS `app.json` associatedDomains. Shared by passkey LOGIN
 * (login screen) and passkey LINK (settings) so they stay in sync. Update this
 * one place when the real associated domain is provisioned.
 */
export const RELYING_PARTY = 'navy.app';
```

- [ ] **Step 2: Use it in login.tsx**

In `expo-wallet/app/login.tsx`: add `import { RELYING_PARTY } from '@/lib/config/privy';` near the other imports, and replace the literal `'navy.app'` in the `loginWithPasskey({ relyingParty: 'navy.app' })` call with `RELYING_PARTY`.

- [ ] **Step 3: Verify tsc**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd expo-wallet
git add src/lib/config/privy.ts app/login.tsx
git commit -m "feat(expo-wallet): centralize passkey relying-party constant"
```

---

## Task 3: LinkEmailSheet component

**Files:**
- Create: `expo-wallet/src/features/settings/LinkEmailSheet.tsx`

- [ ] **Step 1: Build the component**

Create `expo-wallet/src/features/settings/LinkEmailSheet.tsx`. Read `expo-wallet/app/login.tsx` for the email→OTP UI treatment (TextInput style, OtpInput usage) and mirror it inside a `Sheet`. Verify `useLinkEmail`'s shape against the installed `.d.ts` before wiring.

```tsx
import React, { useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { useLinkEmail } from '@privy-io/expo';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { OtpInput } from '@/ui/OtpInput';
import { useToast } from '@/ui/Toast';
import { isValidEnrollCode } from '@/lib/account/mfa';
import { colors, radius, space } from '@/ui/theme';

export function LinkEmailSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { sendCode, linkWithCode } = useLinkEmail();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => { setEmail(''); setCode(''); setSent(false); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const send = async () => {
    setBusy(true);
    try { await sendCode({ email }); setSent(true); }
    catch (e) { toast(`Could not send code: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const verify = async (c: string) => {
    setBusy(true);
    try { await linkWithCode({ code: c }); toast('Email linked'); reset(); onDone(); }
    catch (e) { toast(`Link failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={close}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>Link email</Text>
        {!sent ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Button label="Send code" loading={busy} disabled={!email} onPress={send} />
          </>
        ) : (
          <>
            <Text variant="caption" color={colors.textDim} style={{ marginBottom: space.md }}>
              Enter the code sent to {email}
            </Text>
            <OtpInput value={code} onChange={setCode} onComplete={verify} />
            <View style={{ marginTop: space.lg }}>
              <Button label="Verify & link" loading={busy} disabled={!isValidEnrollCode(code)} onPress={() => verify(code)} />
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  input: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    color: colors.textHi,
    fontSize: 16,
  },
});
```
> If any token name (`colors.textDim`, `radius.md`, `space.lg`, etc.) or a `Button`/`Sheet`/`OtpInput` prop differs from the installed primitives, read the actual file and adjust — do not guess. If `useLinkEmail`'s methods are named differently in the installed types, use the real names.

- [ ] **Step 2: Verify tsc**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd expo-wallet
git add src/features/settings/LinkEmailSheet.tsx
git commit -m "feat(expo-wallet): LinkEmailSheet (useLinkEmail OTP flow)"
```

---

## Task 4: MfaEnrollSheet component (TOTP)

**Files:**
- Create: `expo-wallet/src/features/settings/MfaEnrollSheet.tsx`

- [ ] **Step 1: Build the component**

Create `expo-wallet/src/features/settings/MfaEnrollSheet.tsx`. Verify `useMfaEnrollment`'s shape against the installed `.d.ts`; the QR uses `react-native-qrcode-svg` fed the `authUrl` (an otpauth:// URI).

```tsx
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { useMfaEnrollment } from '@privy-io/expo';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { OtpInput } from '@/ui/OtpInput';
import { useToast } from '@/ui/Toast';
import { isValidEnrollCode, otpauthSecretGroups } from '@/lib/account/mfa';
import { colors, radius, space } from '@/ui/theme';

export function MfaEnrollSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { initMfaEnrollment, submitMfaEnrollment } = useMfaEnrollment();
  const [authUrl, setAuthUrl] = useState<string | undefined>();
  const [secret, setSecret] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const started = !!secret || !!authUrl;

  const reset = () => { setAuthUrl(undefined); setSecret(undefined); setCode(''); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const begin = async () => {
    setBusy(true);
    try {
      const res = await initMfaEnrollment({ method: 'totp' });
      setSecret(res?.secret);
      setAuthUrl(res?.authUrl);
    } catch (e) { toast(`Could not start 2FA: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const confirm = async (c: string) => {
    setBusy(true);
    try {
      await submitMfaEnrollment({ method: 'totp', code: c });
      toast('Two-factor authentication enabled');
      reset(); onDone();
    } catch (e) { toast(`Verification failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const copySecret = async () => {
    if (!secret) return;
    await Clipboard.setStringAsync(secret);
    toast('Secret copied');
  };

  return (
    <Sheet open={open} onClose={close}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>Two-factor authentication</Text>
        {!started ? (
          <>
            <Text variant="caption" color={colors.textDim}>
              Add a second factor with an authenticator app (Google Authenticator, 1Password, etc.).
            </Text>
            <Button label="Begin setup" loading={busy} onPress={begin} />
          </>
        ) : (
          <>
            <Text variant="caption" color={colors.textDim}>
              Scan this in your authenticator app, or enter the key manually.
            </Text>
            {authUrl ? (
              <View style={styles.qr}>
                <QRCode value={authUrl} size={180} backgroundColor="white" />
              </View>
            ) : null}
            {secret ? (
              <View style={styles.secretBox}>
                <Text variant="mono" color={colors.textHi}>{otpauthSecretGroups(secret)}</Text>
                <Button label="Copy key" variant="secondary" onPress={copySecret} />
              </View>
            ) : null}
            <Text variant="caption" color={colors.textDim} style={{ marginTop: space.md }}>
              Enter the 6-digit code from your app
            </Text>
            <OtpInput value={code} onChange={setCode} onComplete={confirm} />
            <View style={{ marginTop: space.lg }}>
              <Button label="Verify & enable" loading={busy} disabled={!isValidEnrollCode(code)} onPress={() => confirm(code)} />
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  qr: { alignSelf: 'center', padding: space.md, backgroundColor: 'white', borderRadius: radius.md },
  secretBox: { gap: space.sm, alignItems: 'center' },
});
```
> Adjust to the real primitive props / token names / `useMfaEnrollment` method names if they differ in the installed types. `Text variant="mono"` exists per the Text primitive; if not, use `body`.

- [ ] **Step 2: Verify tsc**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd expo-wallet
git add src/features/settings/MfaEnrollSheet.tsx
git commit -m "feat(expo-wallet): MfaEnrollSheet (TOTP enrollment flow)"
```

---

## Task 5: Wire the flows into Settings

**Files:**
- Modify: `expo-wallet/app/(tabs)/settings.tsx`

- [ ] **Step 1: Read settings.tsx fully**

Read `expo-wallet/app/(tabs)/settings.tsx` to learn: how `rows = describeLinkedAccounts(user)` is rendered, the existing link-OAuth / unlink handlers and their error-handling/toast pattern, how `Sheet` is already used (the logout confirm sheet), and the section/`PressRow`/`IconBadge` visual conventions. Match those patterns.

- [ ] **Step 2: Add imports + hooks**

At the top of `settings.tsx`, add:
```tsx
import { useLinkWithPasskey } from '@privy-io/expo/passkey';
import { useMfa } from '@privy-io/expo';
import { RELYING_PARTY } from '@/lib/config/privy';
import { LinkEmailSheet } from '@/features/settings/LinkEmailSheet';
import { MfaEnrollSheet } from '@/features/settings/MfaEnrollSheet';
import { mfaMethodLabel } from '@/lib/account/mfa';
```
Inside the component, add:
```tsx
const { linkWithPasskey } = useLinkWithPasskey();
const mfa = useMfa(); // verify shape: enrolled methods list; see note below
const [sheet, setSheet] = useState<null | 'email' | 'mfa'>(null);
```
> VERIFY `useMfa()`'s shape against the installed `.d.ts`. Determine (a) how to read the list of enrolled MFA methods and (b) whether unenroll lives on `useMfa()` or `useMfaEnrollment()`. Derive `const totpEnrolled = <the enrolled list>.some(m => m === 'totp' || m?.type === 'totp');` using the real field. If `useMfa()` does not expose enrolled methods, read them from `usePrivy().user` (e.g. `user?.mfa_methods`) — use whichever the installed types provide.

- [ ] **Step 3: Add the "Link email" row (only when no email is linked)**

Compute whether an email is already linked from the existing `rows` (each row has a `provider`; email rows use `provider === 'email'`):
```tsx
const hasEmail = rows.some((r) => r.provider === 'email');
```
In the linked-accounts section, after the existing rows, render (matching the existing `PressRow`/`IconBadge` style):
```tsx
{!hasEmail && (
  <PressRow onPress={() => setSheet('email')}>
    <IconBadge name="mail" color={colors.textDim} />
    <Text variant="body" color={colors.textHi}>Link email</Text>
  </PressRow>
)}
```
> Use the same row markup the file already uses for link/unlink rows (icon badge + label + optional chevron). If `PressRow`/`IconBadge` are used differently there, copy that exact usage.

- [ ] **Step 4: Add the "Add a passkey" row**

```tsx
const addPasskey = async () => {
  try {
    await linkWithPasskey({ relyingParty: RELYING_PARTY });
    toast('Passkey added');
  } catch (e) {
    toast(`Could not add passkey: ${(e as Error).message}`);
  }
};
```
Render a row (in the linked-accounts section):
```tsx
<PressRow onPress={addPasskey}>
  <IconBadge name="key" color={colors.textDim} />
  <Text variant="body" color={colors.textHi}>Add a passkey</Text>
</PressRow>
```
> `key` is a valid `IconName` (verify in `@/ui/Icon`); if not, use `shield`. Wrap in the file's existing async/toast pattern if it differs from the inline try/catch above.

- [ ] **Step 5: Add the Two-factor section + Enable/Remove**

Add a new section (matching the file's section header style) with a row that reflects `totpEnrolled`:
```tsx
{totpEnrolled ? (
  <PressRow onPress={() => setConfirm('mfa-off')}>
    <IconBadge name="shield" color={colors.textDim} />
    <View style={{ flex: 1 }}>
      <Text variant="body" color={colors.textHi}>Two-factor authentication</Text>
      <Text variant="caption" color={colors.textDim}>{mfaMethodLabel('totp')} · On</Text>
    </View>
  </PressRow>
) : (
  <PressRow onPress={() => setSheet('mfa')}>
    <IconBadge name="shield" color={colors.textDim} />
    <View style={{ flex: 1 }}>
      <Text variant="body" color={colors.textHi}>Two-factor authentication</Text>
      <Text variant="caption" color={colors.textDim}>Off</Text>
    </View>
  </PressRow>
)}
```
Add the unenroll handler + a confirm sheet (mirror the existing logout confirm `Sheet`):
```tsx
const removeMfa = async () => {
  try {
    await unenrollMfa({ method: 'totp' }); // from useMfaEnrollment() OR useMfa() — use the real source
    toast('Two-factor authentication removed');
  } catch (e) {
    toast(`Could not remove 2FA: ${(e as Error).message}`);
  } finally {
    setConfirm(null);
  }
};
```
> `setConfirm` / the `confirm` state already exist for the logout sheet — extend the union to include `'mfa-off'` and add a matching confirm `Sheet` with a "Remove" button calling `removeMfa`. Obtain `unenrollMfa` from `useMfaEnrollment()` (add that hook) or `useMfa()` per the verified types.

- [ ] **Step 6: Render the sheets**

Near the existing logout `Sheet`, render:
```tsx
<LinkEmailSheet open={sheet === 'email'} onClose={() => setSheet(null)} onDone={() => setSheet(null)} />
<MfaEnrollSheet open={sheet === 'mfa'} onClose={() => setSheet(null)} onDone={() => setSheet(null)} />
```

- [ ] **Step 7: Verify tsc**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: 0 errors. Fix any prop/token/hook-name mismatch by reading the real files.

- [ ] **Step 8: Commit**

```bash
cd expo-wallet
git add "app/(tabs)/settings.tsx"
git commit -m "feat(expo-wallet): wire email-link, passkey-link, 2FA into Settings"
```

---

## Task 6: Full verification gate

**Files:** none (verification)

- [ ] **Step 1: tsc + tests**

```bash
cd expo-wallet
pnpm exec tsc --noEmit    # expect 0 errors
pnpm test                 # expect all pass (was 59; now 59 + the new mfa.test cases)
```

- [ ] **Step 2: iOS bundle smoke (catches RN resolution issues tsc misses)**

```bash
cd expo-wallet && rm -rf dist && pnpm dlx expo export --platform ios
```
Expected: bundle succeeds (produces `dist/_expo/static/js/ios/*.hbc`). If it fails on a new import (e.g. the QR lib), resolve per the existing metro/babel setup and note it.

- [ ] **Step 3: Commit any fixes**

```bash
cd expo-wallet && git add -A -- . && git commit -m "chore(expo-wallet): account-security gate green" || echo "nothing to commit"
```
> Scope commits to `expo-wallet/` only; never stage the repo's unrelated be/ fe/ changes or untracked `.adal/`/`.agents/`.

- [ ] **Step 4: Note on-device prerequisites**

Record for the device test (Task 16 of the port plan): MFA must be **enabled in the Privy dashboard**; passkey link needs the associated-domain / `RELYING_PARTY` provisioned. Email-link works without extra config. These complete only on the EAS dev-client build.

---

## Self-review notes

- **Spec coverage:** email-link (Task 3+5) ✓; passkey-link via `@privy-io/expo/passkey` + shared RP constant (Task 2+5) ✓; MFA TOTP custom UI (Task 1 helpers + Task 4 sheet + Task 5 section/unenroll) ✓; pure helpers unit-tested (Task 1) ✓; Sheets thin, hooks verified (Tasks 3–5) ✓; error handling via toast pattern (all tasks) ✓; config prerequisites noted (Task 6) ✓; non-goals (recovery/export/SMS/passkey-MFA) — not implemented ✓.
- **Type consistency:** `isValidEnrollCode`/`otpauthSecretGroups`/`mfaMethodLabel` names identical across Tasks 1/3/4/5; `RELYING_PARTY` identical in Tasks 2/5; sheet props `{ open, onClose, onDone }` identical in Tasks 3/4/5; `sheet` state union `'email' | 'mfa'` consistent.
- **Placeholders:** the "verify against installed `.d.ts`" notes are real instructions (the codebase's SDK-drift convention), not deferrals — the concrete method names/shapes are given; the notes are guardrails for the two genuinely runtime-verified spots (`useMfa()` enrolled-list field, unenroll source).
```
