import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { ACCESS_COOKIE } from '@/lib/session';
import { guardOrigin, parseJson } from '@/lib/request-guards';
import type { PayoutInput } from '@/lib/navyApi';

export async function POST(req: NextRequest) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  const parsed = await parseJson<PayoutInput>(req);
  if (!parsed.ok) return parsed.response;
  const { address, message, signature } = parsed.body;
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const out = await api.setPayout(token, { address, message, signature });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    return NextResponse.json({ ok: false, error: 'Could not set payout address' }, { status });
  }
}
