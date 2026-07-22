import { parseRecipient, assertNotSelfTransfer, assertSufficientBalance } from './transfer-guards';

describe('transfer-guards', () => {
  it('parseRecipient detects a checksummed address', () => {
    expect(parseRecipient('0x0000000000000000000000000000000000000001'))
      .toEqual({ kind: 'address', value: '0x0000000000000000000000000000000000000001' });
  });
  it('parseRecipient treats @handle and bare handle as username', () => {
    expect(parseRecipient('@linh')).toEqual({ kind: 'username', value: 'linh' });
    expect(parseRecipient('linh')).toEqual({ kind: 'username', value: 'linh' });
  });
  it('parseRecipient rejects garbage', () => {
    expect(parseRecipient('0xnothex')).toBeNull();
    expect(parseRecipient('')).toBeNull();
  });
  it('assertNotSelfTransfer throws when from == to (case-insensitive)', () => {
    expect(() => assertNotSelfTransfer('0xAbc', '0xabc')).toThrow(/yourself/i);
  });
  it('assertSufficientBalance throws when balance < amount', () => {
    expect(() => assertSufficientBalance(10n, 20n)).toThrow(/insufficient/i);
    expect(() => assertSufficientBalance(20n, 20n)).not.toThrow();
  });
});
