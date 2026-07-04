import { NextRequest, NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';
import { guardOrigin, parseJson } from '@/lib/request-guards';

export async function POST(req: NextRequest) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const parsed = await parseJson(req);
  if (!parsed.ok) return parsed.response;
  const res = await sessionBackendFetch('/merchant/orders', { method: 'POST', body: JSON.stringify(parsed.body) });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  const res = await sessionBackendFetch(`/merchant/orders${qs}`);
  return NextResponse.json(await res.json().catch(() => ([])), { status: res.status });
}
