import { NextRequest, NextResponse } from 'next/server';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';

export async function POST(req: NextRequest) {
  const { email, password, totp } = await req.json();
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const tokens = await api.adminLogin({ email, password, totp });
    const res = NextResponse.json({ ok: true, role: 'admin' });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res;
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    return NextResponse.json({ ok: false, error: 'Login failed' }, { status });
  }
}

export function setAuthCookies(res: NextResponse, access: string, refresh: string) {
  const common = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
  res.cookies.set(ACCESS_COOKIE, access, { ...common, maxAge: 60 * 15 });
  res.cookies.set(REFRESH_COOKIE, refresh, { ...common, maxAge: 60 * 60 * 24 * 30 });
}
