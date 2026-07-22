import { parseSendTarget } from './parseSendTarget';

describe('parseSendTarget', () => {
  it('decodes a raw checksummed 0x address', () => {
    expect(parseSendTarget('0x0000000000000000000000000000000000000001'))
      .toEqual({ address: '0x0000000000000000000000000000000000000001' });
  });
  it('decodes an EIP-681 URI with a value', () => {
    expect(parseSendTarget('ethereum:0x0000000000000000000000000000000000000001@11155111?value=1000000000000000'))
      .toEqual({ address: '0x0000000000000000000000000000000000000001', amountWei: '1000000000000000' });
  });
  it('decodes an EIP-681 URI without a value', () => {
    expect(parseSendTarget('ethereum:0x0000000000000000000000000000000000000001'))
      .toEqual({ address: '0x0000000000000000000000000000000000000001' });
  });
  it('returns null for a pay URL or garbage', () => {
    expect(parseSendTarget('https://pay.navy/pay/abc')).toBeNull();
    expect(parseSendTarget('hello')).toBeNull();
    expect(parseSendTarget('0xnothex')).toBeNull();
  });
});
