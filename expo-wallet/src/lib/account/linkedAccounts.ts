import type { User } from '@privy-io/expo';
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

/** Map `user.linked_accounts` to display rows for the providers we surface. */
export function describeLinkedAccounts(user: User | null): LinkedAccountRow[] {
  if (!user) return [];
  const rows: LinkedAccountRow[] = [];
  for (const acc of user.linked_accounts) {
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
        rows.push({ key: `passkey:${acc.credential_id}`, provider: 'passkey', ...META.passkey, subtitle: acc.authenticator_name ?? 'Passkey', unlinkId: acc.credential_id });
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
  return !!user && user.linked_accounts.length > 1;
}
