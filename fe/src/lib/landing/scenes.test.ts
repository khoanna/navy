import { SCENES, interpolateScene, lerp, clamp } from './scenes';

describe('math helpers', () => {
  it('clamps to range', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
  it('lerps endpoints', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe('SCENES', () => {
  it('has four ordered beats', () => {
    expect(SCENES).toHaveLength(4);
    expect(SCENES.map((s) => s.id)).toEqual(['sail', 'port', 'sea', 'treasure']);
  });
});

describe('interpolateScene', () => {
  it('returns the first keyframe at progress 0', () => {
    const f = interpolateScene(0);
    expect(f.camPos).toEqual(SCENES[0].camPos);
    expect(f.vesselRotY).toBeCloseTo(SCENES[0].vesselRotY);
  });
  it('returns the last keyframe at progress 1', () => {
    const f = interpolateScene(1);
    expect(f.camPos).toEqual(SCENES[3].camPos);
  });
  it('clamps out-of-range progress', () => {
    expect(interpolateScene(-5).camPos).toEqual(SCENES[0].camPos);
    expect(interpolateScene(9).camPos).toEqual(SCENES[3].camPos);
  });
  it('lands exactly on an interior keyframe at its boundary', () => {
    const f = interpolateScene(1 / 3);
    expect(f.camPos[0]).toBeCloseTo(SCENES[1].camPos[0]);
    expect(f.camPos[1]).toBeCloseTo(SCENES[1].camPos[1]);
    expect(f.camPos[2]).toBeCloseTo(SCENES[1].camPos[2]);
  });
  it('produces an intermediate value between keyframes', () => {
    const f = interpolateScene(1 / 6);
    const lo = Math.min(SCENES[0].camPos[2], SCENES[1].camPos[2]);
    const hi = Math.max(SCENES[0].camPos[2], SCENES[1].camPos[2]);
    expect(f.camPos[2]).toBeGreaterThanOrEqual(lo);
    expect(f.camPos[2]).toBeLessThanOrEqual(hi);
  });
});
