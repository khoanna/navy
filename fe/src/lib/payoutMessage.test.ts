import { buildPayoutMessage } from './payoutMessage';

describe('buildPayoutMessage', () => {
  it('templates a binding message with merchant id, address, and nonce', () => {
    const msg = buildPayoutMessage({ merchantId: 'm1', address: 'PK', nonce: 'abc', issuedAt: '2026-06-13T00:00:00Z' });
    expect(msg).toContain('Navy payout authorization');
    expect(msg).toContain('merchant: m1');
    expect(msg).toContain('address: PK');
    expect(msg).toContain('nonce: abc');
    expect(msg).toContain('issuedAt: 2026-06-13T00:00:00Z');
  });
  it('is deterministic for the same inputs', () => {
    const args = { merchantId: 'm1', address: 'PK', nonce: 'abc', issuedAt: '2026-06-13T00:00:00Z' };
    expect(buildPayoutMessage(args)).toBe(buildPayoutMessage(args));
  });
});
