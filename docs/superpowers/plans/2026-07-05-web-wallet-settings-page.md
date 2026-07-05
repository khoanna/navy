# Web Wallet — Settings / Account Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings tab to the web-wallet exposing logout, add-passkey, wallet recovery + key export, linked-accounts management, and MFA enrollment — all backed by verified `@privy-io/react-auth@2.25.0` hooks.

**Architecture:** A new `(tabs)/settings` screen (inherits the auth guard + TabBar) composes Privy hooks that mostly open Privy's own hosted modals, so custom UI is thin: rows + two confirm sheets + toasts. The one piece of real logic — mapping `user.linkedAccounts` to display rows — lives in a plain-TS, unit-tested module. Shared identity helpers (`short`, `avatarColors`) are extracted so home and settings don't duplicate them.

**Tech Stack:** Next.js 16 (App Router) + React 19, `@privy-io/react-auth` v2 (+ `/solana` subpath), existing `src/ui` kit, jest for `src/lib/**` logic.

**Spec:** `docs/superpowers/specs/2026-07-05-web-wallet-settings-page-design.md`

**Working dir for all commands:** `/home/khoa/Desktop/uni/web-wallet`

**Runtime caveat (note, not a task):** passkeys and MFA must be enabled for the app in the Privy dashboard, and the web origin whitelisted, for these flows to complete against live Privy. The code compiles/builds regardless; live verification needs dashboard config.

---

### Task 1: Add `settings`, `mail`, `key` glyphs to the icon set

**Files:**
- Modify: `src/ui/Icon.tsx:10-28` (the `IconName` union) and `src/ui/Icon.tsx:30-49` (the `PATHS` map)

- [ ] **Step 1: Extend the `IconName` union**

In `src/ui/Icon.tsx`, add three names to the union (after `'search'`):

```typescript
  | 'search'
  | 'settings'
  | 'mail'
  | 'key';
```

- [ ] **Step 2: Add the three path entries**

In the `PATHS` object, add these entries (24×24, round-cap stroke style matching the rest):

```typescript
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M12 3.5l1.3 2.2 2.5-.5.4 2.5 2.2 1.3-1.1 2.3 1.1 2.3-2.2 1.3-.4 2.5-2.5-.5L12 20.5l-1.3-2.2-2.5.5-.4-2.5-2.2-1.3 1.1-2.3-1.1-2.3 2.2-1.3.4-2.5 2.5.5L12 3.5z'],
  mail: ['M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5z', 'M4.5 7.5 12 13l7.5-5.5'],
  key: ['M15 3a6 6 0 1 0 5.2 9L21 12l-1.5-1.5L21 9l-1.8-1.8A6 6 0 0 0 15 3z', 'M9.8 8.2 3 15v3h3l6.8-6.8', 'M15 8h.01'],
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output (clean). This confirms the union + map stay exhaustive (`PATHS: Record<IconName, string[]>` forces all names to have paths).

- [ ] **Step 4: Commit**

```bash
git add src/ui/Icon.tsx
git commit -m "feat(web-wallet): add settings, mail, key icons"
```

---

### Task 2: Extract shared identity helpers (`short`, `avatarColors`)

Both the home hero and the new settings header need the wallet short-form and the deterministic avatar gradient. Extract them from `home/page.tsx` into a pure, tested module (DRY).

**Files:**
- Create: `src/lib/wallet/identicon.ts`
- Create: `src/lib/wallet/identicon.test.ts`
- Modify: `src/app/(tabs)/home/page.tsx:19-31` (remove local copies, import instead)

- [ ] **Step 1: Write the failing test**

Create `src/lib/wallet/identicon.test.ts`:

```typescript
import { short, avatarColors } from './identicon';

describe('short', () => {
  it('renders a placeholder when no address', () => {
    expect(short(undefined)).toBe('provisioning…');
  });
  it('abbreviates an address as first4…last4', () => {
    expect(short('ABCDEFGHIJKL')).toBe('ABCD…IJKL');
  });
});

describe('avatarColors', () => {
  it('returns the brand default for no address', () => {
    expect(avatarColors(undefined)).toEqual(['#3D74FF', '#2FE0C2']);
  });
  it('is deterministic for the same address', () => {
    expect(avatarColors('So1anaWallet')).toEqual(avatarColors('So1anaWallet'));
  });
  it('returns two hsl stops for an address', () => {
    const [a, b] = avatarColors('So1anaWallet');
    expect(a).toMatch(/^hsl\(/);
    expect(b).toMatch(/^hsl\(/);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test identicon`
Expected: FAIL — `Cannot find module './identicon'`.

- [ ] **Step 3: Create the module**

Create `src/lib/wallet/identicon.ts` (byte-for-byte the logic currently in `home/page.tsx`):

```typescript
/** Wallet short-form: `first4…last4`, or a provisioning placeholder. */
export function short(addr?: string): string {
  return addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : 'provisioning…';
}

/** Deterministic two-stop gradient derived from the wallet address — each
 *  wallet gets its own identicon so the avatar means something. */
export function avatarColors(addr?: string): [string, string] {
  if (!addr) return ['#3D74FF', '#2FE0C2'];
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return [`hsl(${hue} 72% 62%)`, `hsl(${(hue + 48) % 360} 76% 54%)`];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test identicon`
Expected: PASS (5 tests).

- [ ] **Step 5: Refactor home to import the shared helpers**

In `src/app/(tabs)/home/page.tsx`, delete the local `short` (lines 19-21) and `avatarColors` (lines 23-31) function definitions, and add to the import block near the top (after the existing `@/lib/wallet/...` imports):

```typescript
import { short, avatarColors } from '@/lib/wallet/identicon';
```

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean (home still references `short`/`avatarColors`, now imported).

- [ ] **Step 7: Commit**

```bash
git add src/lib/wallet/identicon.ts src/lib/wallet/identicon.test.ts "src/app/(tabs)/home/page.tsx"
git commit -m "refactor(web-wallet): extract short/avatarColors into tested identicon module"
```

---

### Task 3: Linked-accounts logic module (pure, tested)

**Files:**
- Create: `src/lib/account/linkedAccounts.ts`
- Create: `src/lib/account/linkedAccounts.test.ts`

Verified Privy facts (from `node_modules/@privy-io/react-auth/dist/dts/types-B_DvyjIb.d.ts`): linked-account discriminants are `'email'` (field `address`), `'google_oauth'` (`subject`, `email`), `'apple_oauth'` (`subject`, `email`), `'passkey'` (`credentialId`, `authenticatorName?`). `User.linkedAccounts` is the full array; Privy rejects unlinking the last account.

- [ ] **Step 1: Write the failing test**

Create `src/lib/account/linkedAccounts.test.ts`:

```typescript
import type { User } from '@privy-io/react-auth';
import { describeLinkedAccounts, linkableProviders, canUnlink } from './linkedAccounts';

// Minimal User fixtures — only the fields our functions read.
function user(linkedAccounts: any[], extra: Partial<User> = {}): User {
  return { id: 'did', createdAt: new Date(0), linkedAccounts, ...extra } as unknown as User;
}

describe('describeLinkedAccounts', () => {
  it('returns [] for a null user', () => {
    expect(describeLinkedAccounts(null)).toEqual([]);
  });

  it('maps email, google, apple, passkey to display rows', () => {
    const u = user([
      { type: 'email', address: 'me@x.com' },
      { type: 'google_oauth', subject: 'g-sub', email: 'me@gmail.com' },
      { type: 'apple_oauth', subject: 'a-sub', email: 'me@icloud.com' },
      { type: 'passkey', credentialId: 'cred-1', authenticatorName: 'iCloud Keychain' },
    ]);
    expect(describeLinkedAccounts(u)).toEqual([
      { key: 'email:me@x.com', provider: 'email', icon: 'mail', label: 'Email', subtitle: 'me@x.com', unlinkId: 'me@x.com' },
      { key: 'google:g-sub', provider: 'google', icon: 'shield', label: 'Google', subtitle: 'me@gmail.com', unlinkId: 'g-sub' },
      { key: 'apple:a-sub', provider: 'apple', icon: 'shield', label: 'Apple', subtitle: 'me@icloud.com', unlinkId: 'a-sub' },
      { key: 'passkey:cred-1', provider: 'passkey', icon: 'key', label: 'Passkey', subtitle: 'iCloud Keychain', unlinkId: 'cred-1' },
    ]);
  });

  it('ignores wallet and other account types', () => {
    const u = user([
      { type: 'wallet', address: 'So1...' },
      { type: 'email', address: 'me@x.com' },
    ]);
    expect(describeLinkedAccounts(u).map((r) => r.provider)).toEqual(['email']);
  });

  it('falls back when a passkey has no authenticator name', () => {
    const u = user([{ type: 'passkey', credentialId: 'c' }]);
    expect(describeLinkedAccounts(u)[0].subtitle).toBe('Passkey');
  });
});

describe('linkableProviders', () => {
  it('offers all three when nothing is linked', () => {
    expect(linkableProviders(user([]))).toEqual(['email', 'google', 'apple']);
  });
  it('omits already-linked providers (passkey handled separately)', () => {
    const u = user([
      { type: 'email', address: 'me@x.com' },
      { type: 'passkey', credentialId: 'c' },
    ]);
    expect(linkableProviders(u)).toEqual(['google', 'apple']);
  });
});

describe('canUnlink', () => {
  it('is false for null or a single account', () => {
    expect(canUnlink(null)).toBe(false);
    expect(canUnlink(user([{ type: 'email', address: 'me@x.com' }]))).toBe(false);
  });
  it('is true with more than one linked account', () => {
    expect(canUnlink(user([{ type: 'email', address: 'a' }, { type: 'wallet', address: 'b' }]))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test linkedAccounts`
Expected: FAIL — `Cannot find module './linkedAccounts'`.

- [ ] **Step 3: Implement the module**

Create `src/lib/account/linkedAccounts.ts`:

```typescript
import type { User } from '@privy-io/react-auth';
import type { IconName } from '@/ui/Icon';

/** Providers this wallet surfaces (matches the login screen's set). */
export type ProviderId = 'email' | 'google' | 'apple' | 'passkey';

/** A linked account rendered as a settings row. */
export interface LinkedAccountRow {
  key: string;
  provider: ProviderId;
  icon: IconName;
  label: string;
  subtitle: string;
  /** Identifier passed to the matching `unlink*` call. */
  unlinkId: string;
}

const META: Record<ProviderId, { icon: IconName; label: string }> = {
  email: { icon: 'mail', label: 'Email' },
  google: { icon: 'shield', label: 'Google' },
  apple: { icon: 'shield', label: 'Apple' },
  passkey: { icon: 'key', label: 'Passkey' },
};

/** Map `user.linkedAccounts` to display rows for the providers we surface. */
export function describeLinkedAccounts(user: User | null): LinkedAccountRow[] {
  if (!user) return [];
  const rows: LinkedAccountRow[] = [];
  for (const acc of user.linkedAccounts) {
    switch (acc.type) {
      case 'email':
        rows.push({ key: `email:${acc.address}`, provider: 'email', ...META.email, subtitle: acc.address, unlinkId: acc.address });
        break;
      case 'google_oauth':
        rows.push({ key: `google:${acc.subject}`, provider: 'google', ...META.google, subtitle: acc.email ?? 'Google account', unlinkId: acc.subject });
        break;
      case 'apple_oauth':
        rows.push({ key: `apple:${acc.subject}`, provider: 'apple', ...META.apple, subtitle: acc.email ?? 'Apple account', unlinkId: acc.subject });
        break;
      case 'passkey':
        rows.push({ key: `passkey:${acc.credentialId}`, provider: 'passkey', ...META.passkey, subtitle: acc.authenticatorName ?? 'Passkey', unlinkId: acc.credentialId });
        break;
      default:
        break; // wallet / smart_wallet / other socials: not surfaced
    }
  }
  return rows;
}

/** Providers not yet linked (passkey is added via its own dedicated action). */
export function linkableProviders(user: User | null): Exclude<ProviderId, 'passkey'>[] {
  const all: Exclude<ProviderId, 'passkey'>[] = ['email', 'google', 'apple'];
  if (!user) return all;
  const linked = new Set(describeLinkedAccounts(user).map((r) => r.provider));
  return all.filter((p) => !linked.has(p));
}

/** Privy requires >=1 account to remain, so unlink is only offered above that. */
export function canUnlink(user: User | null): boolean {
  return !!user && user.linkedAccounts.length > 1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test linkedAccounts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/account/linkedAccounts.ts src/lib/account/linkedAccounts.test.ts
git commit -m "feat(web-wallet): linked-accounts display/link/unlink logic (tested)"
```

---

### Task 4: Settings screen

**Files:**
- Create: `src/app/(tabs)/settings/page.tsx`

Composes the Privy hooks (all verified present in v2.25.0): `usePrivy` (`user`, `unlinkEmail/Google/Apple/Passkey`), `useLinkAccount`, `useLinkWithPasskey`, `useSetWalletRecovery`, `useMfaEnrollment` (all from `@privy-io/react-auth`), and `useExportWallet` (from `@privy-io/react-auth/solana`).

- [ ] **Step 1: Write the full screen**

Create `src/app/(tabs)/settings/page.tsx`:

```tsx
'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  usePrivy,
  useLinkAccount,
  useLinkWithPasskey,
  useSetWalletRecovery,
  useMfaEnrollment,
} from '@privy-io/react-auth';
import { useExportWallet } from '@privy-io/react-auth/solana';
import { useNavySession } from '@/lib/auth/SessionContext';
import { useWebSigner } from '@/lib/wallet/useWebSigner';
import { short, avatarColors } from '@/lib/wallet/identicon';
import {
  describeLinkedAccounts,
  linkableProviders,
  canUnlink,
  type ProviderId,
} from '@/lib/account/linkedAccounts';
import { useToast } from '@/ui/Toast';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { Icon, IconName } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { IconBadge, PressRow } from '@/ui/Bits';
import { colors, radius, space } from '@/ui/theme';

const LINK_META: Record<'email' | 'google' | 'apple', { label: string; icon: IconName }> = {
  email: { label: 'Link email', icon: 'mail' },
  google: { label: 'Link Google', icon: 'shield' },
  apple: { label: 'Link Apple', icon: 'shield' },
};

/** A settings list row: leading badge, title (+optional subtitle), trailing slot. */
function Row({
  icon,
  iconColor,
  title,
  subtitle,
  trailing,
  onPress,
}: {
  icon: IconName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}) {
  const ellipsis: React.CSSProperties = {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  return (
    <PressRow
      onPress={onPress}
      style={{ gap: `${space.md}px`, paddingTop: `${space.sm}px`, paddingBottom: `${space.sm}px` }}
    >
      <IconBadge name={icon} color={iconColor ?? colors.accent} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" color={colors.textHi} style={ellipsis}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="caption" muted style={ellipsis}>
            {subtitle}
          </Text>
        )}
      </div>
      {trailing}
    </PressRow>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="label" muted upper style={{ display: 'block', marginTop: `${space.xl}px`, marginBottom: `${space.sm}px` }}>
      {children}
    </Text>
  );
}

export default function Settings() {
  const router = useRouter();
  const toast = useToast();
  const { signOut } = useNavySession();
  const { address } = useWebSigner();

  const { user, unlinkEmail, unlinkGoogle, unlinkApple, unlinkPasskey } = usePrivy();
  const { linkEmail, linkGoogle, linkApple } = useLinkAccount({
    onSuccess: () => toast('Account linked'),
    onError: () => toast('Could not link account'),
  });
  const { linkWithPasskey } = useLinkWithPasskey({
    onSuccess: () => toast('Passkey added'),
    onError: () => toast('Could not add passkey'),
  });
  const { setWalletRecovery } = useSetWalletRecovery();
  const { exportWallet } = useExportWallet();
  const { showMfaEnrollmentModal } = useMfaEnrollment();

  const [confirm, setConfirm] = useState<null | 'export' | 'logout'>(null);
  const [copied, setCopied] = useState(false);

  const rows = describeLinkedAccounts(user);
  const unlinkable = canUnlink(user);
  const toLink = linkableProviders(user);
  const [avA, avB] = avatarColors(address);
  const primary = user?.email?.address ?? short(address);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const unlink = async (provider: ProviderId, id: string) => {
    try {
      if (provider === 'email') await unlinkEmail(id);
      else if (provider === 'google') await unlinkGoogle(id);
      else if (provider === 'apple') await unlinkApple(id);
      else await unlinkPasskey(id);
      toast('Account unlinked');
    } catch {
      toast('Could not unlink account');
    }
  };

  const link = (provider: 'email' | 'google' | 'apple') => {
    if (provider === 'email') linkEmail();
    else if (provider === 'google') linkGoogle();
    else linkApple();
  };

  const recover = async () => {
    try {
      await setWalletRecovery();
      toast('Recovery updated');
    } catch {
      /* user dismissed the Privy modal */
    }
  };

  const doExport = async () => {
    setConfirm(null);
    if (!address) return;
    try {
      await exportWallet({ address });
    } catch {
      /* user dismissed the export modal */
    }
  };

  const doLogout = async () => {
    setConfirm(null);
    await signOut();
    router.replace('/login');
  };

  return (
    <Screen scroll tabSafe>
      <Text variant="h2" color={colors.textHi} style={{ display: 'block', marginBottom: `${space.lg}px` }}>
        Settings
      </Text>

      {/* Identity header */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: `${space.md}px`, minWidth: 0 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: `${radius.pill}px`,
              backgroundImage: `linear-gradient(135deg, ${avA}, ${avB})`,
              border: '1px solid rgba(255,255,255,0.4)',
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <Text variant="bodyStrong" color={colors.textHi} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {primary}
            </Text>
            <button
              onClick={copyAddress}
              aria-label="Copy wallet address"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '4px',
                padding: '4px 10px',
                background: colors.glassFill,
                border: `1px solid ${colors.border}`,
                borderRadius: `${radius.pill}px`,
                cursor: 'pointer',
              }}
            >
              <Text variant="caption" numeric color={colors.textDim}>
                {short(address)}
              </Text>
              <Icon name={copied ? 'check' : 'copy'} size={13} color={colors.textDim} />
            </button>
          </div>
        </div>
      </Card>

      {/* Linked accounts */}
      <SectionTitle>Linked accounts</SectionTitle>
      <Card compact>
        {rows.map((r) => (
          <Row
            key={r.key}
            icon={r.icon}
            title={r.label}
            subtitle={r.subtitle}
            trailing={
              unlinkable ? (
                <button
                  onClick={() => unlink(r.provider, r.unlinkId)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: `${space.xs}px ${space.sm}px` }}
                >
                  <Text variant="label" color={colors.danger}>
                    Unlink
                  </Text>
                </button>
              ) : undefined
            }
          />
        ))}
        {toLink.map((p) => (
          <Row
            key={`link-${p}`}
            icon={LINK_META[p].icon}
            iconColor={colors.aqua}
            title={LINK_META[p].label}
            onPress={() => link(p)}
            trailing={<Icon name="plus" size={18} color={colors.textDim} />}
          />
        ))}
      </Card>

      {/* Wallet security */}
      <SectionTitle>Wallet security</SectionTitle>
      <Card compact>
        <Row
          icon="shield"
          title="Set up recovery"
          subtitle="Password, iCloud, or Google Drive backup"
          onPress={recover}
          trailing={<Icon name="chevron" size={18} color={colors.textDim} />}
        />
        <Row
          icon="key"
          iconColor={colors.warning}
          title="Export private key"
          subtitle="Reveal your key to import elsewhere"
          onPress={() => setConfirm('export')}
          trailing={<Icon name="chevron" size={18} color={colors.textDim} />}
        />
      </Card>

      {/* Login & security */}
      <SectionTitle>Login &amp; security</SectionTitle>
      <Card compact>
        <Row
          icon="key"
          title="Add a passkey"
          subtitle="Sign in with Face ID / Touch ID"
          onPress={() => linkWithPasskey()}
          trailing={<Icon name="plus" size={18} color={colors.textDim} />}
        />
        <Row
          icon="shield"
          title="Two-factor authentication"
          subtitle="Authenticator app, SMS, or passkey"
          onPress={() => showMfaEnrollmentModal()}
          trailing={<Icon name="chevron" size={18} color={colors.textDim} />}
        />
      </Card>

      {/* Log out */}
      <div style={{ marginTop: `${space.xxl}px` }}>
        <Button label="Log out" icon="logout" variant="danger" onPress={() => setConfirm('logout')} />
      </div>

      {/* Confirm: export private key */}
      <Sheet open={confirm === 'export'} onClose={() => setConfirm(null)}>
        <Text variant="h3" color={colors.textHi}>
          Export private key?
        </Text>
        <Text variant="caption" muted style={{ display: 'block', marginTop: `${space.sm}px` }}>
          Anyone with your private key controls this wallet. Only reveal it somewhere private. Privy shows it in a secure window this app cannot read.
        </Text>
        <div style={{ marginTop: `${space.xl}px`, display: 'flex', flexDirection: 'column', gap: `${space.md}px` }}>
          <Button label="Reveal private key" icon="key" variant="danger" onPress={doExport} />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirm(null)} />
        </div>
      </Sheet>

      {/* Confirm: log out */}
      <Sheet open={confirm === 'logout'} onClose={() => setConfirm(null)}>
        <Text variant="h3" color={colors.textHi}>
          Log out?
        </Text>
        <Text variant="caption" muted style={{ display: 'block', marginTop: `${space.sm}px` }}>
          You&apos;ll need to sign in again to access this wallet. Your funds stay safe on-chain.
        </Text>
        <div style={{ marginTop: `${space.xl}px`, display: 'flex', flexDirection: 'column', gap: `${space.md}px` }}>
          <Button label="Log out" icon="logout" variant="danger" onPress={doLogout} />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirm(null)} />
        </div>
      </Sheet>
    </Screen>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean. If a Privy hook name/signature mismatches, fix against `node_modules/@privy-io/react-auth/dist/dts/index.d.ts` (and `solana.d.ts` for `useExportWallet`) — do not guess.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(tabs)/settings/page.tsx"
git commit -m "feat(web-wallet): settings screen (identity, linked accounts, recovery, export, passkey, MFA, logout)"
```

---

### Task 5: Add the Settings tab

**Files:**
- Modify: `src/ui/TabBar.tsx:8-13` (the `TABS` array)

- [ ] **Step 1: Append the tab**

In `src/ui/TabBar.tsx`, add a 5th entry to `TABS`:

```typescript
const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/home', label: 'Wallet', icon: 'home' },
  { href: '/scan', label: 'Pay', icon: 'scan' },
  { href: '/farming', label: 'Earn', icon: 'sprout' },
  { href: '/history', label: 'Activity', icon: 'clock' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean (`'settings'` is now a valid `IconName` from Task 1).

- [ ] **Step 3: Commit**

```bash
git add src/ui/TabBar.tsx
git commit -m "feat(web-wallet): add Settings tab to the tab bar"
```

---

### Task 6: Full verification

**Files:** none (gates only).

- [ ] **Step 1: Unit tests**

Run: `pnpm test`
Expected: all suites pass, including the new `identicon` and `linkedAccounts` suites.

- [ ] **Step 2: Typecheck gate**

Run: `pnpm exec tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Runtime build gate** (catches browser-bundle issues `tsc` misses)

Run: `pnpm build`
Expected: `✓ Compiled successfully`, and the route list includes `/settings`.

- [ ] **Step 4: Final commit (if any gate required a fix)**

```bash
git add -A
git commit -m "test(web-wallet): verify settings page builds and tests pass"
```

(Skip if the working tree is already clean.)

---

## Self-review notes

- **Spec coverage:** logout (Task 4 + `signOut`), add passkey (Task 4 `linkWithPasskey`), recovery backup (`setWalletRecovery`) + export key (`exportWallet`) (Task 4), linked accounts list/link/unlink (Tasks 3 + 4), MFA (`showMfaEnrollmentModal`, Task 4), identity header (Task 4), entry via 5th tab (Task 5), new glyphs (Task 1), shared identity helpers DRY-extracted (Task 2). All spec sections mapped.
- **Type consistency:** `ProviderId`, `LinkedAccountRow`, `describeLinkedAccounts`, `linkableProviders`, `canUnlink` names match between Task 3 definition and Task 4 usage. `short`/`avatarColors` signatures match between Task 2 and Task 4. Icon names `settings`/`mail`/`key` defined in Task 1 before use in Tasks 3-5.
- **No placeholders:** every code step is complete.
