import type { MappedError } from '../wallet/sendErrors';
export type { MappedError };

/** Turn any load/read failure (network, RPC, backend 4xx/5xx) into friendly, actionable text. */
export function mapError(raw: unknown): MappedError {
  const msg = ((raw as any)?.message ?? String(raw ?? '')).toString();
  const m = msg.toLowerCase();

  if (m.includes('http 401') || m.includes('unauthorized') || m.includes('sign out') || m.includes('signed out')) {
    return { title: 'Session expired', detail: 'Please sign in again to continue.' };
  }
  if (m.includes('http 404') || m.includes('not found')) {
    return { title: 'Not found', detail: "We couldn't find what you were looking for." };
  }
  if (/http 5\d\d/.test(m) || m.includes('server error')) {
    return { title: 'Server problem', detail: 'Something went wrong on our side. Please try again in a moment.' };
  }
  if (m.includes('network') || m.includes('timeout') || m.includes('fetch') || m.includes('econn') || m.includes('offline')) {
    return { title: 'Network problem', detail: 'Could not reach the network. Check your connection and retry.' };
  }
  return { title: 'Something went wrong', detail: msg ? msg.slice(0, 140) : 'Please try again.' };
}
