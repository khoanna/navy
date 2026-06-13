import { NextRequest, NextResponse } from 'next/server';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { setAuthCookies } from '../../admin/route';

export async function POST(req: NextRequest) {
  const { email, password, businessName } = await req.json();
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const tokens = await api.merchantSignup({ email, password, businessName });
    const res = NextResponse.json({ ok: true, role: 'merchant' });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res;
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    return NextResponse.json({ ok: false, error: 'Signup failed' }, { status });
  }
}
