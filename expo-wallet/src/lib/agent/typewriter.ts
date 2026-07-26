// Pure stepping logic for the assistant's text-by-text reveal.
//
// Given the currently-revealed character count and the target length, compute
// the next revealed count. The reveal is proportional to the backlog so it
// catches up quickly when tokens arrive in bursts, yet still steps smoothly
// (>= minStep, so it never stalls) as it approaches the end — a typewriter feel
// that keeps pace with streaming without ever running past the text.

export function nextRevealLen(
  current: number,
  target: number,
  minStep: number,
  catchupDivisor: number,
): number {
  if (current >= target) return target;
  const remaining = target - current;
  const step = Math.max(minStep, Math.ceil(remaining / catchupDivisor));
  return Math.min(target, current + step);
}
