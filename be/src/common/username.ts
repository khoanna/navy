/** Canonical username charset: 3-20 lowercase alphanumerics/underscores. */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** Lowercase, trim, and drop a single leading '@' so '@Linh' and 'linh' resolve alike. */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase();
}

/** True when the (already-normalized) value is a legal handle. */
export function isValidUsername(value: string): boolean {
  return USERNAME_RE.test(value);
}
