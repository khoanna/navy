import { NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';

export async function GET() {
  const res = await sessionBackendFetch('/vault/admin/strategy');
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
