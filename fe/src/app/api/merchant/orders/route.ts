import { NextRequest, NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await sessionBackendFetch('/merchant/orders', { method: 'POST', body: JSON.stringify(body) });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  const res = await sessionBackendFetch(`/merchant/orders${qs}`);
  return NextResponse.json(await res.json().catch(() => ([])), { status: res.status });
}
