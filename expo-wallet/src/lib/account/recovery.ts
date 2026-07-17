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
 */
export function currentRecoveryState(user: User | null): { isSet: boolean; method: RecoveryMethod | null } {
  if (!user) return { isSet: false, method: null };
  const wallet = user.linked_accounts.find(
    (a: any) => a.type === 'wallet' && a.wallet_client_type === 'privy' && a.chain_type === 'ethereum',
  ) as any;
  const rm = wallet?.recovery_method as string | undefined;
  if (rm === 'user-passcode' || rm === 'icloud' || rm === 'google-drive') {
    return { isSet: true, method: rm };
  }
  return { isSet: false, method: null };
}

/** Privy requires ≥6 chars for user-passcode recovery; we enforce ≥8 as a product minimum. */
const MIN_PASSCODE_LENGTH = 8;

export function isValidPasscode(passcode: string): boolean {
  return passcode.length >= MIN_PASSCODE_LENGTH;
}

export function passcodesMatch(a: string, b: string): boolean {
  return isValidPasscode(a) && a === b;
}
