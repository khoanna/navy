import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { ACCESS_COOKIE } from '@/lib/session';

export async function POST() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const issued = await api.createApiKey(token);
    return NextResponse.json({ ok: true, ...issued });
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    return NextResponse.json({ ok: false, error: 'Could not create API key' }, { status });
  }
}
