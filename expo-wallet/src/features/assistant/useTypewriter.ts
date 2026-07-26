import { useEffect, useRef, useState } from 'react';
import { nextRevealLen } from '@/lib/agent/typewriter';

const TICK_MS = 28; // reveal cadence
const MIN_STEP = 1; // always advance at least one char (never stalls)
const CATCHUP = 6; // reveal ~1/6 of the backlog per tick → keeps pace with bursty streaming

/**
 * Text-by-text reveal for streaming assistant text. Returns the currently
 * visible prefix of `text`, advancing a few characters per tick toward the
 * full string. When `enabled` is false (historical messages) the full text is
 * shown immediately — only the actively-streaming reply animates.
 *
 * The reveal is monotonic and self-restarting: when more tokens arrive (`text`
 * grows) the effect re-runs and continues from where it left off; once caught
 * up it stops scheduling, so completed messages don't tick forever.
 */
export function useTypewriter(text: string, enabled: boolean): string {
  const [len, setLen] = useState(enabled ? 0 : text.length);
  const lenRef = useRef(len);
  lenRef.current = len;

  useEffect(() => {
    if (!enabled) {
      setLen(text.length);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        const cur = lenRef.current;
        if (cur >= text.length) return; // caught up — effect re-runs when text grows
        const next = nextRevealLen(cur, text.length, MIN_STEP, CATCHUP);
        setLen(next);
        if (next < text.length) schedule();
      }, TICK_MS);
    };
    if (lenRef.current < text.length) schedule();
    return () => clearTimeout(timer);
  }, [enabled, text.length]);

  return enabled ? text.slice(0, len) : text;
}
