import { normalizeUsername, isValidUsername, USERNAME_RE } from '../../../src/common/username';

describe('username', () => {
  it('normalizes to lowercase and strips a leading @', () => {
    expect(normalizeUsername('  @Linh_01 ')).toBe('linh_01');
  });
  it('accepts 3-20 chars of [a-z0-9_]', () => {
    expect(isValidUsername('linh_01')).toBe(true);
    expect(isValidUsername('abc')).toBe(true);
  });
  it('rejects too short, too long, and bad chars', () => {
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('a'.repeat(21))).toBe(false);
    expect(isValidUsername('bad-name')).toBe(false);
    expect(isValidUsername('has space')).toBe(false);
  });
  it('USERNAME_RE matches the normalized form', () => {
    expect(USERNAME_RE.test('linh_01')).toBe(true);
    expect(USERNAME_RE.test('Linh')).toBe(false);
  });
});
