/** Fraction (0..1) of the way the knob has travelled along the track. */
export function clampProgress(offsetPx: number, trackPx: number): number {
  if (trackPx <= 0) return 0;
  const p = offsetPx / trackPx;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** The slider fires once the knob is essentially at the end. */
export function isConfirmed(progress: number): boolean {
  return progress >= 0.92;
}
