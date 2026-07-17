import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import { sessionBackendFetch } from '@/lib/session-backend';
import { guardOrigin } from '@/lib/request-guards';

export async function POST(req: NextRequest) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;

  // Best-effort: revoke the session on the backend (ignore failures — always clear cookies).
  await sessionBackendFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}
