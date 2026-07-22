import { mapSendError } from './sendErrors';

describe('mapSendError', () => {
  const t = (input: any) => mapSendError(input).title;
  it('maps insufficient ETH for gas', () => {
    expect(t(new Error('insufficient funds for intrinsic transaction cost'))).toMatch(/gas/i);
  });
  it('maps user rejection', () => {
    expect(t({ code: 4001, message: 'User rejected the request' })).toMatch(/cancell?ed/i);
  });
  it('maps an on-chain revert', () => {
    expect(t(new Error('execution reverted'))).toMatch(/revert|fail/i);
  });
  it('maps insufficient USDC (from the backend 400 message)', () => {
    expect(t(new Error('Insufficient USDC balance'))).toMatch(/usdc/i);
  });
  it('maps relayer unavailable (503)', () => {
    expect(t(new Error('Transfer relayer temporarily unavailable'))).toMatch(/temporar|relayer|try again/i);
  });
  it('always returns a non-empty title + detail for unknown errors', () => {
    const r = mapSendError(null);
    expect(r.title.length).toBeGreaterThan(0);
    expect(typeof r.detail).toBe('string');
  });
});
