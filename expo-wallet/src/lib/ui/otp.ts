/** Strip non-digits and cap to the code length. */
export function normalizeOtp(raw: string, length: number): string {
  return raw.replace(/\D/g, '').slice(0, length);
}

export function isComplete(code: string, length: number): boolean {
  return code.length === length;
}
