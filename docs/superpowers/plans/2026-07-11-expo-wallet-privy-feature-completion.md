# Expo Wallet — Privy Feature Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add wallet recovery, passkey-as-2FA, MFA-gated transaction signing, and a fund-wallet on-ramp to `expo-wallet/`, building on the existing Privy auth/wallet/MFA foundation. Client-only; no backend changes.

**Architecture:** Follow the repo split — pure, framework-free logic in `src/lib/account/**` (jest-unit-tested via `pnpm test`), thin UI in `src/features/**` that orchestrates Privy hooks (verified by `pnpm exec tsc --noEmit`). Two invisible root gates (`MfaGate`, `RecoveryGate`) register Privy listeners and render custom bottom-sheets, so signing screens need no changes. `<PrivyElements/>` is mounted once to enable the `/ui` fund-wallet hook.

**Tech Stack:** React Native (Expo SDK 54), `@privy-io/expo@0.70.0` (+ `/passkey`, `/ui` subpaths), `@solana/web3.js`, jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-07-11-expo-wallet-privy-feature-completion-design.md`

**All commands run from `/home/khoa/Desktop/uni/expo-wallet`.**

**SDK-drift rule (from CLAUDE.md):** Before wiring any Privy hook, re-verify its exact argument/return shape against the installed `.d.ts` under `node_modules/@privy-io/expo`. The UI tasks below note the specific shapes to confirm. Pure-logic tasks are shape-independent (they operate on fixtures we define) and are safe to TDD directly.

---

## File Structure

**New — pure logic (unit-tested):**
- `src/lib/account/recovery.ts` (+ `recovery.test.ts`) — recovery method availability, current state, passcode validation.
- `src/lib/account/mfaFlow.ts` (+ `mfaFlow.test.ts`) — step-up prompt state machine.

**Modified — pure logic:**
- `src/lib/account/mfa.ts` (+ append to `mfa.test.ts`) — add `enrolledMfaMethods(user)`.

**New — UI (tsc-gated):**
- `src/features/settings/RecoverySheet.tsx` — set a recovery method.
- `src/features/mfa/MfaPromptSheet.tsx` — custom step-up prompt sheet (presentational; state driven by `mfaFlow.ts`).
- `src/features/mfa/MfaGate.tsx` — root listener → renders `MfaPromptSheet`. (This is the spec's "MfaProvider"; renamed to a Gate since it provides no context.)
- `src/features/mfa/RecoveryGate.tsx` — root listener for needs-recovery.
- `src/features/wallet/FundButton.tsx` — on-ramp button.

**Modified — UI:**
- `app/_layout.tsx` — mount `<PrivyElements/>`, `<MfaGate/>`, `<RecoveryGate/>`.
- `app/(tabs)/settings.tsx` — Wallet-recovery row; passkey-capable 2FA method list.
- `src/features/settings/MfaEnrollSheet.tsx` — add method picker (TOTP | Passkey).
- `app/(tabs)/home.tsx`, `app/(tabs)/receive.tsx` — render `FundButton`.

---

## Task 1: Recovery pure logic (`recovery.ts`)

**Files:**
- Create: `src/lib/account/recovery.ts`
- Test: `src/lib/account/recovery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/account/recovery.test.ts`:

```typescript
import type { User } from '@privy-io/expo';
import {
  availableRecoveryMethods,
  recoveryMethodLabel,
  currentRecoveryState,
  isValidPasscode,
  passcodesMatch,
} from './recovery';

function userWith(recovery_method: string | undefined): User {
  const wallet: any = { type: 'wallet', wallet_client_type: 'privy', chain_type: 'solana' };
  if (recovery_method !== undefined) wallet.recovery_method = recovery_method;
  return { id: 'did', created_at: 0, linked_accounts: [wallet] } as unknown as User;
}

describe('availableRecoveryMethods', () => {
  it('offers iCloud + passcode on iOS', () => {
    expect(availableRecoveryMethods('ios')).toEqual(['icloud', 'user-passcode']);
  });
  it('offers Google Drive + passcode on Android', () => {
    expect(availableRecoveryMethods('android')).toEqual(['google-drive', 'user-passcode']);
  });
  it('offers passcode only on other platforms', () => {
    expect(availableRecoveryMethods('web')).toEqual(['user-passcode']);
  });
});

describe('recoveryMethodLabel', () => {
  it('labels each method', () => {
    expect(recoveryMethodLabel('user-passcode')).toBe('Passcode');
    expect(recoveryMethodLabel('icloud')).toBe('iCloud');
    expect(recoveryMethodLabel('google-drive')).toBe('Google Drive');
  });
});

describe('currentRecoveryState', () => {
  it('reports not-set for a null user', () => {
    expect(currentRecoveryState(null)).toEqual({ isSet: false, method: null });
  });
  it('treats the default privy-managed method as not-set', () => {
    expect(currentRecoveryState(userWith('privy'))).toEqual({ isSet: false, method: null });
    expect(currentRecoveryState(userWith(undefined))).toEqual({ isSet: false, method: null });
  });
  it('reports a user-selected method as set', () => {
    expect(currentRecoveryState(userWith('user-passcode'))).toEqual({ isSet: true, method: 'user-passcode' });
    expect(currentRecoveryState(userWith('icloud'))).toEqual({ isSet: true, method: 'icloud' });
    expect(currentRecoveryState(userWith('google-drive'))).toEqual({ isSet: true, method: 'google-drive' });
  });
});

describe('isValidPasscode / passcodesMatch', () => {
  it('requires at least 8 characters', () => {
    expect(isValidPasscode('1234567')).toBe(false);
    expect(isValidPasscode('12345678')).toBe(true);
  });
  it('matches only equal, valid passcodes', () => {
    expect(passcodesMatch('12345678', '12345678')).toBe(true);
    expect(passcodesMatch('12345678', '1234567')).toBe(false);
    expect(passcodesMatch('short', 'short')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test recovery`
Expected: FAIL — `Cannot find module './recovery'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/account/recovery.ts`:

```typescript
import type { User } from '@privy-io/expo';

/** User-selectable recovery methods surfaced in the UI. */
export type RecoveryMethod = 'user-passcode' | 'icloud' | 'google-drive';

const LABELS: Record<RecoveryMethod, string> = {
  'user-passcode': 'Passcode',
  icloud: 'iCloud',
  'google-drive': 'Google Drive',
};

/** Methods to offer for the given platform (Platform.OS), most-preferred first. */
export function availableRecoveryMethods(os: string): RecoveryMethod[] {
  if (os === 'ios') return ['icloud', 'user-passcode'];
  if (os === 'android') return ['google-drive', 'user-passcode'];
  return ['user-passcode'];
}

export function recoveryMethodLabel(method: RecoveryMethod): string {
  return LABELS[method];
}

/**
 * Reads the embedded (privy) wallet's recovery method from the user object.
 * The default `privy` (Privy-managed) value counts as "not user-set".
 *
 * VERIFY BEFORE CODING: confirm the field name is `recovery_method` on the
 * embedded-wallet linked account in the installed @privy-io/expo User type.
 */
export function currentRecoveryState(user: User | null): { isSet: boolean; method: RecoveryMethod | null } {
  if (!user) return { isSet: false, method: null };
  const wallet = user.linked_accounts.find(
    (a: any) => a.type === 'wallet' && a.wallet_client_type === 'privy',
  ) as any;
  const rm = wallet?.recovery_method as string | undefined;
  if (rm === 'user-passcode' || rm === 'icloud' || rm === 'google-drive') {
    return { isSet: true, method: rm };
  }
  return { isSet: false, method: null };
}

export function isValidPasscode(passcode: string): boolean {
  return passcode.length >= 8;
}

export function passcodesMatch(a: string, b: string): boolean {
  return isValidPasscode(a) && a === b;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test recovery`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/account/recovery.ts src/lib/account/recovery.test.ts
git commit -m "feat(expo-wallet): recovery pure-logic helpers"
```

---

## Task 2: MFA step-up state machine (`mfaFlow.ts`)

**Files:**
- Create: `src/lib/account/mfaFlow.ts`
- Test: `src/lib/account/mfaFlow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/account/mfaFlow.test.ts`:

```typescript
import { initialMfaPrompt, selectMethod, setCode, canSubmit, type MfaPromptState } from './mfaFlow';

describe('initialMfaPrompt', () => {
  it('selects the first available method by preference (passkey > totp > sms)', () => {
    expect(initialMfaPrompt(['totp', 'passkey']).selected).toBe('passkey');
    expect(initialMfaPrompt(['totp']).selected).toBe('totp');
    expect(initialMfaPrompt(['sms', 'totp']).selected).toBe('totp');
  });
  it('handles an empty method list', () => {
    const s = initialMfaPrompt([]);
    expect(s.selected).toBeNull();
    expect(s.code).toBe('');
  });
});

describe('selectMethod', () => {
  it('switches the selected method and clears the code', () => {
    const s = setCode(initialMfaPrompt(['totp', 'passkey']), '123456');
    const next = selectMethod(s, 'totp');
    expect(next.selected).toBe('totp');
    expect(next.code).toBe('');
  });
});

describe('setCode', () => {
  it('normalizes to digits, max 6', () => {
    const s = initialMfaPrompt(['totp']);
    expect(setCode(s, '12ab34567').code).toBe('123456');
  });
});

describe('canSubmit', () => {
  it('is always true for passkey', () => {
    expect(canSubmit(initialMfaPrompt(['passkey']))).toBe(true);
  });
  it('requires a complete 6-digit code for totp/sms', () => {
    let s: MfaPromptState = initialMfaPrompt(['totp']);
    expect(canSubmit(s)).toBe(false);
    s = setCode(s, '123456');
    expect(canSubmit(s)).toBe(true);
  });
  it('is false when nothing is selected', () => {
    expect(canSubmit(initialMfaPrompt([]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mfaFlow`
Expected: FAIL — `Cannot find module './mfaFlow'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/account/mfaFlow.ts`:

```typescript
import { normalizeOtp, isComplete } from '@/lib/ui/otp';
import type { MfaMethod } from './mfa';

export interface MfaPromptState {
  methods: MfaMethod[];
  selected: MfaMethod | null;
  code: string;
}

const PREFERENCE: MfaMethod[] = ['passkey', 'totp', 'sms'];

function pickDefault(methods: MfaMethod[]): MfaMethod | null {
  for (const m of PREFERENCE) if (methods.includes(m)) return m;
  return methods[0] ?? null;
}

export function initialMfaPrompt(methods: MfaMethod[]): MfaPromptState {
  return { methods, selected: pickDefault(methods), code: '' };
}

export function selectMethod(state: MfaPromptState, method: MfaMethod): MfaPromptState {
  return { ...state, selected: method, code: '' };
}

export function setCode(state: MfaPromptState, raw: string): MfaPromptState {
  return { ...state, code: normalizeOtp(raw, 6) };
}

export function canSubmit(state: MfaPromptState): boolean {
  if (!state.selected) return false;
  if (state.selected === 'passkey') return true;
  return isComplete(state.code, 6);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test mfaFlow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/account/mfaFlow.ts src/lib/account/mfaFlow.test.ts
git commit -m "feat(expo-wallet): MFA step-up prompt state machine"
```

---

## Task 3: `enrolledMfaMethods` helper (extend `mfa.ts`)

**Files:**
- Modify: `src/lib/account/mfa.ts`
- Test: `src/lib/account/mfa.test.ts` (append)

- [ ] **Step 1: Add the failing test**

Append to `src/lib/account/mfa.test.ts`:

```typescript
import { enrolledMfaMethods } from './mfa';
import type { User } from '@privy-io/expo';

function userWithMfa(methods: string[]): User {
  return {
    id: 'did',
    created_at: 0,
    linked_accounts: [],
    mfa_methods: methods.map((type) => ({ type })),
  } as unknown as User;
}

describe('enrolledMfaMethods', () => {
  it('returns [] for a null user or no methods', () => {
    expect(enrolledMfaMethods(null)).toEqual([]);
    expect(enrolledMfaMethods(userWithMfa([]))).toEqual([]);
  });
  it('maps known mfa method types, dropping unknowns', () => {
    expect(enrolledMfaMethods(userWithMfa(['totp', 'passkey', 'sms', 'weird']))).toEqual([
      'totp',
      'passkey',
      'sms',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mfa`
Expected: FAIL — `enrolledMfaMethods` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/account/mfa.ts` (after `otpauthSecretGroups`):

```typescript
import type { User } from '@privy-io/expo';

/**
 * Reads the user's enrolled MFA methods, filtered to the ones we support.
 * VERIFY BEFORE CODING: confirm `user.mfa_methods[].type` is the field name in
 * the installed @privy-io/expo User type (the Settings screen already reads it).
 */
export function enrolledMfaMethods(user: User | null): MfaMethod[] {
  const known: MfaMethod[] = ['totp', 'sms', 'passkey'];
  const raw = ((user as any)?.mfa_methods ?? []) as Array<{ type?: string }>;
  return raw
    .map((m) => m.type)
    .filter((t): t is MfaMethod => !!t && (known as string[]).includes(t));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test mfa`
Expected: PASS (existing + new blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/account/mfa.ts src/lib/account/mfa.test.ts
git commit -m "feat(expo-wallet): enrolledMfaMethods helper"
```

---

## Task 4: RecoverySheet component

**Files:**
- Create: `src/features/settings/RecoverySheet.tsx`

**VERIFY BEFORE CODING:** `useSetEmbeddedWalletRecovery()` returns `{ setRecovery(params) }` where `params` is the union `{ recoveryMethod: 'user-passcode'; password } | { recoveryMethod: 'icloud' } | { recoveryMethod: 'google-drive' }`. Confirm the hook name and the `recoveryMethod` param key against `node_modules/@privy-io/expo`.

- [ ] **Step 1: Write the component**

Create `src/features/settings/RecoverySheet.tsx`:

```tsx
import { useState } from 'react';
import { View, StyleSheet, TextInput, Platform, Pressable } from 'react-native';
import { useSetEmbeddedWalletRecovery } from '@privy-io/expo';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/Toast';
import { colors, space, radius } from '@/ui/theme';
import {
  availableRecoveryMethods,
  recoveryMethodLabel,
  isValidPasscode,
  passcodesMatch,
  type RecoveryMethod,
} from '@/lib/account/recovery';

export function RecoverySheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { setRecovery } = useSetEmbeddedWalletRecovery();
  const toast = useToast();
  const methods = availableRecoveryMethods(Platform.OS);
  const [method, setMethod] = useState<RecoveryMethod>(methods[0]);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setMethod(methods[0]); setPass(''); setConfirm(''); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const isPasscode = method === 'user-passcode';
  const canSave = isPasscode ? passcodesMatch(pass, confirm) : true;

  const save = async () => {
    setBusy(true);
    try {
      if (method === 'user-passcode') await setRecovery({ recoveryMethod: 'user-passcode', password: pass });
      else if (method === 'icloud') await setRecovery({ recoveryMethod: 'icloud' });
      else await setRecovery({ recoveryMethod: 'google-drive' });
      toast('Recovery method set');
      reset();
      onDone();
    } catch (e: any) {
      toast(`Could not set recovery: ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>Wallet recovery</Text>
        <Text variant="caption" color={colors.textDim}>
          Choose how to recover your wallet on a new device.
        </Text>

        <View style={styles.methods}>
          {methods.map((m) => (
            <Pressable
              key={m}
              onPress={() => setMethod(m)}
              style={[styles.methodPill, method === m && styles.methodPillActive]}
            >
              <Text variant="body" color={method === m ? colors.onAccent : colors.text}>
                {recoveryMethodLabel(m)}
              </Text>
            </Pressable>
          ))}
        </View>

        {isPasscode && (
          <View style={styles.fields}>
            <TextInput
              style={styles.input}
              placeholder="Recovery passcode (min 8 chars)"
              placeholderTextColor={colors.textMute}
              secureTextEntry
              value={pass}
              onChangeText={setPass}
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm passcode"
              placeholderTextColor={colors.textMute}
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
            />
            {pass.length > 0 && !isValidPasscode(pass) && (
              <Text variant="caption" color={colors.danger}>Passcode must be at least 8 characters.</Text>
            )}
          </View>
        )}

        <Button label="Set recovery" onPress={save} loading={busy} disabled={!canSave} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  methods: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  methodPill: {
    paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill,
    backgroundColor: colors.glassFill, borderWidth: 1, borderColor: colors.border,
  },
  methodPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  fields: { gap: space.sm },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.textHi, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 16,
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. If `setRecovery`'s param key differs from `recoveryMethod`, fix per the installed `.d.ts` (see VERIFY note).

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/RecoverySheet.tsx
git commit -m "feat(expo-wallet): RecoverySheet (set passcode/cloud recovery)"
```

---

## Task 5: RecoveryGate (needs-recovery listener)

**Files:**
- Create: `src/features/mfa/RecoveryGate.tsx`

**VERIFY BEFORE CODING:** `useOnNeedsRecovery(callback)` registers a global handler; `useRecoverEmbeddedWallet()` returns `{ recover(params) }` with the same `recoveryMethod` union. Confirm the callback signature (it may receive context about which method is expected) against the installed `.d.ts`. If the callback provides the expected method, prefer it over Platform.OS.

- [ ] **Step 1: Write the component**

Create `src/features/mfa/RecoveryGate.tsx`:

```tsx
import { useState } from 'react';
import { View, StyleSheet, TextInput, Platform } from 'react-native';
import { useOnNeedsRecovery, useRecoverEmbeddedWallet } from '@privy-io/expo';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/Toast';
import { colors, space, radius } from '@/ui/theme';
import { isValidPasscode } from '@/lib/account/recovery';

export function RecoveryGate() {
  const { recover } = useRecoverEmbeddedWallet();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);

  // iOS/Android cloud recovery is one-tap; other platforms fall back to passcode entry.
  const cloud = Platform.OS === 'ios' || Platform.OS === 'android';

  useOnNeedsRecovery(() => {
    setOpen(true);
  });

  const close = () => { setOpen(false); setPass(''); setBusy(false); };

  const run = async () => {
    setBusy(true);
    try {
      if (Platform.OS === 'ios') await recover({ recoveryMethod: 'icloud' });
      else if (Platform.OS === 'android') await recover({ recoveryMethod: 'google-drive' });
      else await recover({ recoveryMethod: 'user-passcode', password: pass });
      toast('Wallet recovered');
      close();
    } catch (e: any) {
      toast(`Recovery failed: ${e?.message ?? 'unknown error'}`);
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>Recover your wallet</Text>
        <Text variant="caption" color={colors.textDim}>
          {cloud
            ? 'Restore your wallet from your secure cloud backup to continue.'
            : 'Enter your recovery passcode to restore your wallet.'}
        </Text>
        {!cloud && (
          <TextInput
            style={styles.input}
            placeholder="Recovery passcode"
            placeholderTextColor={colors.textMute}
            secureTextEntry
            value={pass}
            onChangeText={setPass}
          />
        )}
        <Button
          label={cloud ? 'Restore from backup' : 'Recover'}
          onPress={run}
          loading={busy}
          disabled={!cloud && !isValidPasscode(pass)}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.textHi, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 16,
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (adjust to the verified `useOnNeedsRecovery` callback signature if needed).

- [ ] **Step 3: Commit**

```bash
git add src/features/mfa/RecoveryGate.tsx
git commit -m "feat(expo-wallet): RecoveryGate (needs-recovery prompt)"
```

---

## Task 6: MfaPromptSheet (presentational)

**Files:**
- Create: `src/features/mfa/MfaPromptSheet.tsx`

This component is **purely presentational** — it takes the `mfaFlow` state and callbacks as props so all logic stays testable. The Privy glue lives in `MfaGate` (Task 7).

- [ ] **Step 1: Write the component**

Create `src/features/mfa/MfaPromptSheet.tsx`:

```tsx
import { View, StyleSheet, Pressable } from 'react-native';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { OtpInput } from '@/ui/OtpInput';
import { colors, space, radius } from '@/ui/theme';
import { mfaMethodLabel } from '@/lib/account/mfa';
import { canSubmit, type MfaPromptState } from '@/lib/account/mfaFlow';

export function MfaPromptSheet({
  open,
  state,
  busy,
  onSelectMethod,
  onChangeCode,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  state: MfaPromptState;
  busy: boolean;
  onSelectMethod: (m: MfaPromptState['methods'][number]) => void;
  onChangeCode: (code: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const needsCode = state.selected === 'totp' || state.selected === 'sms';
  return (
    <Sheet open={open} onClose={onCancel}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>Verify it's you</Text>
        <Text variant="caption" color={colors.textDim}>
          This action requires two-factor authentication.
        </Text>

        {state.methods.length > 1 && (
          <View style={styles.methods}>
            {state.methods.map((m) => (
              <Pressable
                key={m}
                onPress={() => onSelectMethod(m)}
                style={[styles.pill, state.selected === m && styles.pillActive]}
              >
                <Text variant="body" color={state.selected === m ? colors.onAccent : colors.text}>
                  {mfaMethodLabel(m)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {needsCode && <OtpInput value={state.code} onChange={onChangeCode} onComplete={onSubmit} />}
        {state.selected === 'passkey' && (
          <Text variant="caption" color={colors.textDim}>Tap verify to use your passkey.</Text>
        )}

        <View style={styles.actions}>
          <Button label="Verify" onPress={onSubmit} loading={busy} disabled={!canSubmit(state)} />
          <Button label="Cancel" variant="ghost" onPress={onCancel} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  methods: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill,
    backgroundColor: colors.glassFill, borderWidth: 1, borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  actions: { gap: space.sm },
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/mfa/MfaPromptSheet.tsx
git commit -m "feat(expo-wallet): MfaPromptSheet (presentational step-up UI)"
```

---

## Task 7: MfaGate (step-up listener + Privy glue)

**Files:**
- Create: `src/features/mfa/MfaGate.tsx`

**VERIFY BEFORE CODING (critical — complex overloads):** In `node_modules/@privy-io/expo`, read the `useMfa` and `useRegisterMfaListener` declarations.
- `useRegisterMfaListener(cb)` — confirm `cb` receives the required `MfaMethod[]` (or an object containing them).
- `useMfa()` — confirm the exact method names and per-method arg shapes for `init`/`submit` (e.g. `submit({ method: 'totp', code })`, `submit({ method: 'passkey' })`), plus `cancel()`. Adjust the calls below to match. Keep all UI-state logic in `mfaFlow` (already tested); only the Privy calls change.

- [ ] **Step 1: Write the component**

Create `src/features/mfa/MfaGate.tsx`:

```tsx
import { useState } from 'react';
import { useMfa, useRegisterMfaListener } from '@privy-io/expo';
import { useToast } from '@/ui/Toast';
import { MfaPromptSheet } from './MfaPromptSheet';
import type { MfaMethod } from '@/lib/account/mfa';
import { initialMfaPrompt, selectMethod, setCode, type MfaPromptState } from '@/lib/account/mfaFlow';

export function MfaGate() {
  const mfa = useMfa();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<MfaPromptState>(initialMfaPrompt([]));

  // Fires when a Privy action (e.g. signTransaction) needs step-up verification.
  useRegisterMfaListener((methods: MfaMethod[]) => {
    setState(initialMfaPrompt(methods));
    setOpen(true);
  });

  const close = () => { setOpen(false); setBusy(false); setState(initialMfaPrompt([])); };

  const submit = async () => {
    if (!state.selected) return;
    setBusy(true);
    try {
      // VERIFY: match useMfa().submit overloads to the installed .d.ts.
      if (state.selected === 'passkey') {
        await mfa.submit({ method: 'passkey' } as any);
      } else {
        await mfa.submit({ method: state.selected, code: state.code } as any);
      }
      close();
    } catch (e: any) {
      toast(`Verification failed: ${e?.message ?? 'try again'}`);
      setBusy(false);
    }
  };

  const cancel = () => {
    try { mfa.cancel?.(); } catch { /* non-fatal */ }
    close();
  };

  return (
    <MfaPromptSheet
      open={open}
      state={state}
      busy={busy}
      onSelectMethod={(m) => setState((s) => selectMethod(s, m))}
      onChangeCode={(c) => setState((s) => setCode(s, c))}
      onSubmit={submit}
      onCancel={cancel}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. Remove the `as any` casts once the exact `submit` overload shapes are confirmed.

- [ ] **Step 3: Commit**

```bash
git add src/features/mfa/MfaGate.tsx
git commit -m "feat(expo-wallet): MfaGate (step-up listener wiring)"
```

---

## Task 8: FundButton (on-ramp)

**Files:**
- Create: `src/features/wallet/FundButton.tsx`

**VERIFY BEFORE CODING:** `useFundSolanaWallet` is exported from `@privy-io/expo/ui` and returns `{ fundWallet }`; `fundWallet({ address })`. Confirm the return shape and that it requires `<PrivyElements/>` mounted (Task 9).

- [ ] **Step 1: Write the component**

Create `src/features/wallet/FundButton.tsx`:

```tsx
import { useState } from 'react';
import { useFundSolanaWallet } from '@privy-io/expo/ui';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/Toast';

export function FundButton({ address, variant = 'secondary' }: { address?: string; variant?: 'primary' | 'secondary' | 'ghost' }) {
  const { fundWallet } = useFundSolanaWallet();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    if (!address) return;
    setBusy(true);
    try {
      await fundWallet({ address });
    } catch (e: any) {
      toast(`Could not open funding: ${e?.message ?? 'unavailable'}`);
    } finally {
      setBusy(false);
    }
  };

  return <Button label="Add funds" icon="plus" variant={variant} onPress={onPress} loading={busy} disabled={!address} />;
}
```

> If `plus` is not a valid `IconName`, pick an existing icon from `@/ui/Icon` (check its `IconName` union) — e.g. `receive`.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/wallet/FundButton.tsx
git commit -m "feat(expo-wallet): FundButton (Privy on-ramp)"
```

---

## Task 9: Wire the root layout

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Update `app/_layout.tsx`**

Replace the file with:

```tsx
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PrivyProvider } from '@privy-io/expo';
import { PrivyElements } from '@privy-io/expo/ui';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getEnv } from '@/lib/config/env';
import { SessionProvider } from '@/lib/auth/SessionContext';
import { ToastProvider } from '@/ui/Toast';
import { MfaGate } from '@/features/mfa/MfaGate';
import { RecoveryGate } from '@/features/mfa/RecoveryGate';

export default function Root() {
  const env = getEnv();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PrivyProvider
          appId={env.privyAppId}
          clientId={env.privyClientId}
          config={{ embedded: { solana: { createOnLogin: 'users-without-wallets' } } }}
        >
          <SessionProvider>
            <ToastProvider>
              <Slot />
              <MfaGate />
              <RecoveryGate />
              <PrivyElements />
            </ToastProvider>
          </SessionProvider>
        </PrivyProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

**VERIFY:** Confirm `PrivyElements` import path (`@privy-io/expo/ui`). If `PrivyElements` must sit at a specific tree depth (some SDKs require it as the last child of the provider), keep it last as shown.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat(expo-wallet): mount PrivyElements, MfaGate, RecoveryGate at root"
```

---

## Task 10: Settings — recovery row + passkey-capable 2FA

**Files:**
- Modify: `app/(tabs)/settings.tsx`
- Modify: `src/features/settings/MfaEnrollSheet.tsx`

**VERIFY BEFORE CODING:** `useMfaEnrollment()` passkey overloads — `initMfaEnrollment({ method: 'passkey' })` → `Promise<void>`, then `submitMfaEnrollment({ method: 'passkey', credentialIds })`. Passkey MFA references the user's **already-linked** passkey credentials, so `credentialIds` comes from the linked passkey accounts (`describeLinkedAccounts(user)` rows with `provider === 'passkey'` expose `unlinkId`, which is the `credential_id`). If the user has no linked passkey, guide them to add one first (link a passkey in Linked Accounts). Confirm the exact `submit` shape against the installed `.d.ts`.

### 10a — MfaEnrollSheet method picker

- [ ] **Step 1: Add a method picker to `MfaEnrollSheet.tsx`**

At the top of the sheet body, before the TOTP setup UI, add a picker and branch the flow. Insert this state and picker (keeping the existing TOTP logic intact for the `'totp'` branch):

```tsx
// add to imports
import { Pressable } from 'react-native';
import { usePrivy } from '@privy-io/expo';
import { mfaMethodLabel } from '@/lib/account/mfa';
import { describeLinkedAccounts } from '@/lib/account/linkedAccounts';

// add to component state / hooks
const { user } = usePrivy();
const [pickMethod, setPickMethod] = useState<'totp' | 'passkey'>('totp');
const passkeyCredentialIds = describeLinkedAccounts(user)
  .filter((r) => r.provider === 'passkey')
  .map((r) => r.unlinkId);

// passkey enrollment handler — references the user's already-linked passkey(s)
const enrollPasskey = async () => {
  if (passkeyCredentialIds.length === 0) {
    toast('Add a passkey in Linked accounts first, then enable it as 2FA.');
    return;
  }
  setBusy(true);
  try {
    await initMfaEnrollment({ method: 'passkey' });
    // VERIFY the exact submit shape against the installed .d.ts.
    await submitMfaEnrollment({ method: 'passkey', credentialIds: passkeyCredentialIds } as any);
    toast('Passkey two-factor enabled');
    reset();
    onDone();
  } catch (e: any) {
    toast(`Could not enable passkey 2FA: ${e?.message ?? 'unknown error'}`);
  } finally {
    setBusy(false);
  }
};
```

Render the picker at the top of the sheet content:

```tsx
<View style={{ flexDirection: 'row', gap: 8 }}>
  {(['totp', 'passkey'] as const).map((m) => (
    <Pressable
      key={m}
      onPress={() => setPickMethod(m)}
      style={{
        paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
        backgroundColor: pickMethod === m ? colors.accent : colors.glassFill,
        borderWidth: 1, borderColor: pickMethod === m ? colors.accent : colors.border,
      }}
    >
      <Text variant="body" color={pickMethod === m ? colors.onAccent : colors.text}>{mfaMethodLabel(m)}</Text>
    </Pressable>
  ))}
</View>
```

Gate the existing TOTP UI behind `pickMethod === 'totp'`, and for `pickMethod === 'passkey'` render a short explainer + a `<Button label="Enable passkey 2FA" onPress={enrollPasskey} loading={busy} />`.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

### 10b — Settings recovery row + method list

- [ ] **Step 3: Update `app/(tabs)/settings.tsx`**

Add imports:

```tsx
import { RecoverySheet } from '@/features/settings/RecoverySheet';
import { currentRecoveryState, recoveryMethodLabel } from '@/lib/account/recovery';
import { enrolledMfaMethods, mfaMethodLabel } from '@/lib/account/mfa';
```

Extend the sheet state union to include recovery:

```tsx
const [sheet, setSheet] = useState<null | 'email' | 'mfa' | 'recovery'>(null);
```

In the Security section, add the recovery row (using the existing `Row` component) and replace the single TOTP status row with a per-method list:

```tsx
{/* Wallet recovery */}
{(() => {
  const rec = currentRecoveryState(user);
  return (
    <Row
      icon="shield"
      title="Wallet recovery"
      subtitle={rec.isSet ? recoveryMethodLabel(rec.method!) : 'Not set'}
      onPress={() => setSheet('recovery')}
    />
  );
})()}

{/* Two-factor methods */}
{(() => {
  const methods = enrolledMfaMethods(user);
  return (
    <>
      {methods.map((m) => (
        <Row key={m} icon="key" title={mfaMethodLabel(m)} subtitle="On" />
      ))}
      <Row icon="key" title="Add two-factor method" onPress={() => setSheet('mfa')} />
    </>
  );
})()}
```

Add the RecoverySheet alongside the existing sheets:

```tsx
<RecoverySheet open={sheet === 'recovery'} onClose={() => setSheet(null)} onDone={() => setSheet(null)} />
```

> Keep the existing `MfaEnrollSheet` mount (`open={sheet === 'mfa'}`) — it now handles both TOTP and passkey via its picker. Preserve the existing linked-accounts section and sign-out unchanged.

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/(tabs)/settings.tsx src/features/settings/MfaEnrollSheet.tsx
git commit -m "feat(expo-wallet): settings recovery row + passkey 2FA method"
```

---

## Task 11: FundButton in Home + Receive

**Files:**
- Modify: `app/(tabs)/home.tsx`
- Modify: `app/(tabs)/receive.tsx`

- [ ] **Step 1: Add to Home**

In `app/(tabs)/home.tsx`, import and render `FundButton` below the balance block (before the quick-actions row):

```tsx
import { FundButton } from '@/features/wallet/FundButton';

// inside the hero, after the balance block <View style={styles.balanceBlock}>…</View>:
<View style={{ marginTop: space.lg }}>
  <FundButton address={address} variant="secondary" />
</View>
```

Ensure `space` is imported from `@/ui/theme` (it already is per the hero styles).

- [ ] **Step 2: Add to Receive**

In `app/(tabs)/receive.tsx`, import `FundButton` and render it under the action buttons:

```tsx
import { FundButton } from '@/features/wallet/FundButton';

// after the <View style={styles.actions}>…Copy buttons…</View> block:
<View style={{ marginTop: space.md }}>
  <FundButton address={address} />
</View>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/(tabs)/home.tsx app/(tabs)/receive.tsx
git commit -m "feat(expo-wallet): Add funds button on Home and Receive"
```

---

## Task 12: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — all `src/lib/**/*.test.ts` including `recovery`, `mfaFlow`, `mfa` (with `enrolledMfaMethods`), and existing suites.

- [ ] **Step 2: Full typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors across the project.

- [ ] **Step 3: Build gate**

Run: `pnpm build` (or the app's expo build/prebuild script; check `package.json` scripts).
Expected: build succeeds. Fix any bundler-only issues (e.g. `@privy-io/expo/ui` resolution, Buffer/crypto polyfills) per the CLAUDE.md web-wallet guidance.

- [ ] **Step 4: Manual smoke (dev-client, operator)**

Document results in the PR description:
- Settings → Wallet recovery → set passcode; state row shows "Passcode".
- Settings → Add two-factor method → Passkey → enrolls; row appears.
- With 2FA enrolled, initiate a pay/farming tx → the MFA prompt appears and, on verify, the tx proceeds.
- Home/Receive → Add funds → the Privy funding modal opens (or shows the dashboard-unavailable state).

- [ ] **Step 5: Commit any fixes from the verification pass**

```bash
git add -A
git commit -m "fix(expo-wallet): verification-pass fixes for Privy feature completion"
```

---

## Self-Review Notes (traceability to spec)

- **Wallet recovery** → Tasks 1, 4, 5, 10b. Passcode + iCloud/Google Drive; `useOnNeedsRecovery` gate for new-device recovery.
- **Passkey as 2FA** → Tasks 3, 10a. Picker in `MfaEnrollSheet`; method list in Settings.
- **MFA-gated signing** → Tasks 2, 6, 7, 9. `useRegisterMfaListener` + `useMfa` + custom sheet; no changes to `useMobileSigner`/pay/farming.
- **Fund-wallet on-ramp** → Tasks 8, 9, 11. `useFundSolanaWallet` + `<PrivyElements/>`.
- **Out of scope** (SMS, private-key export, session keys / `be/`): none of the tasks touch these; session keys are sub-project B.
- **Gates:** pure logic TDD'd (`pnpm test`); UI tsc + build-gated; manual dev-client smoke listed.
