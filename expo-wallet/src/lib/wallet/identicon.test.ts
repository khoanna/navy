import { short, avatarColors } from './identicon';

describe('short', () => {
  it('renders a placeholder when no address', () => {
    expect(short(undefined)).toBe('provisioning…');
  });
  it('abbreviates an address as first4…last4', () => {
    expect(short('ABCDEFGHIJKL')).toBe('ABCD…IJKL');
  });
});

describe('avatarColors', () => {
  it('returns the brand default for no address', () => {
    expect(avatarColors(undefined)).toEqual(['#3D74FF', '#2FE0C2']);
  });
  it('is deterministic for the same address', () => {
    expect(avatarColors('So1anaWallet')).toEqual(avatarColors('So1anaWallet'));
  });
  it('returns two hsl stops for an address', () => {
    const [a, b] = avatarColors('So1anaWallet');
    expect(a).toMatch(/^hsl\(/);
    expect(b).toMatch(/^hsl\(/);
    expect(a).not.toBe(b);
  });
});
