import { NextRequest, NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = searchParams.get('limit') ?? '20';
  const cursor = searchParams.get('cursor') ?? undefined;
  const params = new URLSearchParams({ limit });
  if (cursor) params.set('cursor', cursor);
  const res = await sessionBackendFetch(`/vault/admin/decisions?${params}`);
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
