import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, decodeJwtRole } from '@/lib/session';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { guardOrigin } from '@/lib/request-guards';

// Fetch the backend's single-use payout challenge (stored server-side with a nonce + expiry).
// The merchant signs THIS exact string with their EVM wallet; setPayout matches it against the
// stored challenge, so we must return the backend's challenge — not a locally-built message.
export async function POST(req: NextRequest) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? '';
  if (decodeJwtRole(token) !== 'merchant') return NextResponse.json({ ok: false }, { status: 401 });
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const { challenge } = await api.requestPayoutChallenge(token);
    return NextResponse.json({ ok: true, message: challenge });
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    return NextResponse.json({ ok: false, error: 'Could not prepare payout' }, { status });
  }
}
