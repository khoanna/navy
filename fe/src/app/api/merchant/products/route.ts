import { NextRequest, NextResponse } from 'next/server';
import { sessionBackendFetch, sessionBackendFetchRaw } from '@/lib/session-backend';
import { guardOrigin } from '@/lib/request-guards';

export async function GET() {
  const res = await sessionBackendFetch('/merchant/products');
  return NextResponse.json(await res.json().catch(() => ([])), { status: res.status });
}

export async function POST(req: NextRequest) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const form = await req.formData();
  const res = await sessionBackendFetchRaw('/merchant/products', { method: 'POST', body: form });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
