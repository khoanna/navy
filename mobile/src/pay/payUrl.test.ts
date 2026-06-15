import { parsePayUrl } from './payUrl';

describe('parsePayUrl', () => {
  it('extracts the order id from a navy pay url', () => {
    expect(parsePayUrl('navy://pay/00112233-4455-6677-8899-aabbccddeeff')).toBe('00112233-4455-6677-8899-aabbccddeeff');
  });
  it('accepts an https fallback', () => {
    expect(parsePayUrl('https://pay.navy/pay/00112233-4455-6677-8899-aabbccddeeff')).toBe('00112233-4455-6677-8899-aabbccddeeff');
  });
  it('throws on a non-navy or malformed url', () => {
    expect(() => parsePayUrl('https://evil.com/x')).toThrow(/navy/i);
    expect(() => parsePayUrl('navy://pay/not-a-uuid')).toThrow(/invoice/i);
  });
});
