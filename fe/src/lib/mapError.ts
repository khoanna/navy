import { NavyApiError } from './navyApi';

export interface MappedError { title: string; detail: string }

/** Turn any client failure into friendly, actionable copy — preferring the backend's detail. */
export function mapError(raw: unknown): MappedError {
  if (raw instanceof NavyApiError) {
    if (raw.status === 401 || raw.status === 403) {
      return { title: 'Session expired', detail: raw.detail ?? 'Please sign in again to continue.' };
    }
    if (raw.status >= 500) {
      return { title: 'Server problem', detail: raw.detail ?? 'Something went wrong on our side. Please try again.' };
    }
    if (raw.status === 404) {
      return { title: 'Not found', detail: raw.detail ?? "We couldn't find what you were looking for." };
    }
    // 4xx with a validation detail — surface it directly.
    return { title: 'Please check the details', detail: raw.detail ?? `Request failed (${raw.status}).` };
  }

  const msg = ((raw as { message?: unknown } | null | undefined)?.message ?? String(raw ?? '')).toString();
  const m = msg.toLowerCase();
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('timeout') || m.includes('load failed')) {
    return { title: 'Network problem', detail: 'Could not reach the server. Check your connection and retry.' };
  }
  return { title: 'Something went wrong', detail: msg ? msg.slice(0, 160) : 'Please try again.' };
}
