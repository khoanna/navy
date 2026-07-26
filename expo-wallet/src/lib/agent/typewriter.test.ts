import { nextRevealLen } from './typewriter';

describe('nextRevealLen', () => {
  it('returns target once fully revealed', () => {
    expect(nextRevealLen(10, 10, 1, 8)).toBe(10);
    expect(nextRevealLen(12, 10, 1, 8)).toBe(10); // clamps if somehow past target
  });

  it('advances by at least minStep', () => {
    expect(nextRevealLen(0, 5, 2, 100)).toBe(2); // remaining/divisor rounds to <2 → minStep
  });

  it('catches up faster when far behind (proportional to backlog)', () => {
    // remaining 80, divisor 8 → step 10
    expect(nextRevealLen(0, 80, 1, 8)).toBe(10);
  });

  it('never overshoots the target', () => {
    expect(nextRevealLen(9, 10, 5, 2)).toBe(10);
  });

  it('reveals smoothly char-by-char near the end', () => {
    expect(nextRevealLen(3, 4, 1, 8)).toBe(4);
  });
});
