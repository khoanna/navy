import { generateOrderReference } from './order-reference';

describe('generateOrderReference', () => {
  it('produces an ORD- prefixed 8-char Crockford-base32 code', () => {
    const ref = generateOrderReference();
    expect(ref).toMatch(/^ORD-[0-9A-HJKMNP-TV-Z]{8}$/);
  });
  it('is effectively unique across many calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateOrderReference()));
    expect(set.size).toBe(1000);
  });
});
