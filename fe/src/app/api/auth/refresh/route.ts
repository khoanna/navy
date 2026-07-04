import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { NavyApi } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import { setAuthCookies } from '../admin/route';
import { guardOrigin } from '@/lib/request-guards';

export async function POST(req: NextRequest) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;

  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const tokens = await api.refresh(refreshToken);
    const res = NextResponse.json({ ok: true });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res;
  } catch {
    const res = NextResponse.json({ ok: false, error: 'Session expired' }, { status: 401 });
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  }
}
