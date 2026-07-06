import { parsePayUrl } from './payUrl';

describe('parsePayUrl', () => {
  it('extracts the order id from an https pay url', () => {
    expect(parsePayUrl('https://pay.navy/pay/00112233-4455-6677-8899-aabbccddeeff')).toBe('00112233-4455-6677-8899-aabbccddeeff');
  });
  it('accepts localhost for local dev', () => {
    expect(parsePayUrl('http://localhost:3001/pay/00112233-4455-6677-8899-aabbccddeeff')).toBe('00112233-4455-6677-8899-aabbccddeeff');
  });
  it('throws on a non-http or malformed url', () => {
    expect(() => parsePayUrl('https://evil.com/x')).toThrow(/navy/i);
    expect(() => parsePayUrl('navy://pay/00112233-4455-6677-8899-aabbccddeeff')).toThrow(/navy/i);
    expect(() => parsePayUrl('https://pay.navy/pay/not-a-uuid')).toThrow(/invoice/i);
  });
  it('rejects a foreign https host even with a /pay/<uuid> path (phishing)', () => {
    expect(() => parsePayUrl('https://evil.com/pay/00112233-4455-6677-8899-aabbccddeeff')).toThrow(/navy/i);
  });
  it('rejects a greedy nested /pay/ path', () => {
    expect(() => parsePayUrl('https://pay.navy/x/pay/00112233-4455-6677-8899-aabbccddeeff')).toThrow(/navy/i);
  });
});
