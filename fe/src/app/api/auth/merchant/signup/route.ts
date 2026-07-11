import { NextRequest, NextResponse } from 'next/server';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { setAuthCookies } from '../../admin/route';
import { guardOrigin, parseJson } from '@/lib/request-guards';
import type { MerchantSignup } from '@/lib/navyApi';

export async function POST(req: NextRequest) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const parsed = await parseJson<MerchantSignup>(req);
  if (!parsed.ok) return parsed.response;
  const { email, password, businessName } = parsed.body;
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const tokens = await api.merchantSignup({ email, password, businessName });
    const res = NextResponse.json({ ok: true, role: 'merchant' });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res;
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    const error = (e instanceof NavyApiError && e.detail) || 'Signup failed';
    return NextResponse.json({ ok: false, error }, { status });
  }
}
