import { clampProgress, isConfirmed } from './slide';

describe('slide progress', () => {
  it('clamps knob travel to 0..1', () => {
    expect(clampProgress(-20, 300)).toBe(0);
    expect(clampProgress(150, 300)).toBe(0.5);
    expect(clampProgress(600, 300)).toBe(1);
  });

  it('treats a zero or negative track as no progress', () => {
    expect(clampProgress(50, 0)).toBe(0);
  });

  it('confirms only at/above the 0.92 threshold', () => {
    expect(isConfirmed(0.91)).toBe(false);
    expect(isConfirmed(0.92)).toBe(true);
    expect(isConfirmed(1)).toBe(true);
  });
});
