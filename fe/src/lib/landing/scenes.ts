/** Scroll storyboard geometry for the landing "Voyage" 3D hero. Plain-TS, no
 *  three/React imports so it stays unit-testable (repo convention). Units are
 *  three.js world units; angles in radians. Consumed by VoyageCanvas. */

export type Vec3 = readonly [number, number, number];

export interface SceneKeyframe {
  id: 'sail' | 'port' | 'sea' | 'treasure';
  camPos: Vec3;
  camTarget: Vec3;
  vesselPos: Vec3;
  vesselRotY: number;
}

export interface VoyageFrame {
  camPos: Vec3;
  camTarget: Vec3;
  vesselPos: Vec3;
  vesselRotY: number;
}

/** The four pinned beats. Tuned so the vessel reframes: front hero -> dolly to
 *  starboard -> side profile travelling -> crane down onto the harbour. */
export const SCENES: readonly SceneKeyframe[] = [
  { id: 'sail',     camPos: [0, 1.2, 6.5],  camTarget: [0, 0.6, 0],  vesselPos: [0, 0, 0],      vesselRotY: 0.4 },
  { id: 'port',     camPos: [3.2, 1.0, 4.2], camTarget: [0.4, 0.4, 0], vesselPos: [-0.3, 0, 0],  vesselRotY: 1.2 },
  { id: 'sea',      camPos: [6.0, 0.8, 0.5], camTarget: [0, 0.4, 0],  vesselPos: [0, -0.1, 0],   vesselRotY: 1.9 },
  { id: 'treasure', camPos: [1.5, 3.4, 4.0], camTarget: [0, -0.2, 0], vesselPos: [0, -0.3, 0.4], vesselRotY: 2.6 },
] as const;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  // Precise form so lerp(a, b, 1) === b exactly (no float drift at endpoints).
  return (1 - t) * a + t * b;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Smoothstep easing for a calmer camera than raw linear scrub. */
function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Map global scroll progress (0..1) across the SCENES segments to a frame. */
export function interpolateScene(progress: number): VoyageFrame {
  const p = clamp(progress, 0, 1);
  const segments = SCENES.length - 1; // 3
  const scaled = p * segments;
  const i = Math.min(Math.floor(scaled), segments - 1);
  const t = easeInOut(scaled - i);
  const a = SCENES[i];
  const b = SCENES[i + 1];
  return {
    camPos: lerpVec3(a.camPos, b.camPos, t),
    camTarget: lerpVec3(a.camTarget, b.camTarget, t),
    vesselPos: lerpVec3(a.vesselPos, b.vesselPos, t),
    vesselRotY: lerp(a.vesselRotY, b.vesselRotY, t),
  };
}
