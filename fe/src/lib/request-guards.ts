// Thin helpers shared by mutating route handlers: an Origin/CSRF check and a
// safe JSON body parse. Handlers call `guardMutation(req)` first; a non-null
// return is the rejection Response to send back immediately.
import { NextResponse } from 'next/server';
import { isSameOrigin } from './origin-guard';

/** Returns a 403 Response if the request is cross-origin, else null. */
export function guardOrigin(req: Request): Response | null {
  return isSameOrigin(req) ? null : new NextResponse(null, { status: 403 });
}

export type JsonResult<T> = { ok: true; body: T } | { ok: false; response: Response };

/** Safely parse a JSON body; on failure yields a 400 Response to return. */
export async function parseJson<T = unknown>(req: Request): Promise<JsonResult<T>> {
  try {
    const body = (await req.json()) as T;
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 }),
    };
  }
}
