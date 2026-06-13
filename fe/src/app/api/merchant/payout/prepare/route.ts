import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, decodeJwtRole } from '@/lib/session';
import { buildPayoutMessage } from '@/lib/payoutMessage';

function subFromToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try { return (JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: string }).sub ?? null; }
  catch { return null; }
}

export async function POST(req: NextRequest) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? '';
  if (decodeJwtRole(token) !== 'merchant') return NextResponse.json({ ok: false }, { status: 401 });
  const merchantId = subFromToken(token);
  if (!merchantId) return NextResponse.json({ ok: false }, { status: 401 });
  const { address } = await req.json();
  const nonce = globalThis.crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const message = buildPayoutMessage({ merchantId, address, nonce, issuedAt });
  return NextResponse.json({ ok: true, message });
}
