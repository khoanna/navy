export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return USERNAME_RE.test(value);
}
