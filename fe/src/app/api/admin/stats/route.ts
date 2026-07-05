import { NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';

export async function GET() {
  const res = await sessionBackendFetch('/admin/stats');
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
