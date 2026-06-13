export const ACCESS_COOKIE = 'navy_access';
export const REFRESH_COOKIE = 'navy_refresh';
export type NavyRole = 'user' | 'merchant' | 'admin';

export function decodeJwtRole(token: string): NavyRole | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const role = (JSON.parse(json) as { role?: string }).role;
    return role === 'user' || role === 'merchant' || role === 'admin' ? role : null;
  } catch {
    return null;
  }
}
