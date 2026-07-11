import { isComplete } from '@/lib/ui/otp';
import type { User } from '@privy-io/expo';

export type MfaMethod = 'totp' | 'sms' | 'passkey';

const LABELS: Record<MfaMethod, string> = {
  totp: 'Authenticator app',
  sms: 'Text message',
  passkey: 'Passkey',
};

const KNOWN_MFA_METHODS: MfaMethod[] = ['totp', 'sms', 'passkey'];

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

/**
 * Reads the user's enrolled MFA methods, filtered to the ones we support.
 * (The Settings screen already reads user.mfa_methods for TOTP status.)
 */
export function enrolledMfaMethods(user: User | null): MfaMethod[] {
  // `mfa_methods` isn't stably exposed on the installed @privy-io/expo User type; read defensively.
  const raw = ((user as any)?.mfa_methods ?? []) as Array<{ type?: string }>;
  return raw
    .map((m) => m.type)
    .filter((t): t is MfaMethod => !!t && (KNOWN_MFA_METHODS as string[]).includes(t));
}
