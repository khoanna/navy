import { NextRequest, NextResponse } from 'next/server';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { setAuthCookies } from '../admin/route';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const tokens = await api.merchantLogin({ email, password });
    const res = NextResponse.json({ ok: true, role: 'merchant' });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res;
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    return NextResponse.json({ ok: false, error: 'Login failed' }, { status });
  }
}
