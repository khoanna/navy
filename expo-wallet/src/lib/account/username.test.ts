import { normalizeUsername, isValidUsername } from './username';

describe('username (expo)', () => {
  it('normalizes and validates', () => {
    expect(normalizeUsername('@Linh')).toBe('linh');
    expect(isValidUsername('linh_01')).toBe(true);
    expect(isValidUsername('ab')).toBe(false);
  });
});
