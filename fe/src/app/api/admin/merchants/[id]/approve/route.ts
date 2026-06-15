import { NextResponse } from 'next/server';
import { adminBackendFetch } from '@/lib/admin-api';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await adminBackendFetch(`/admin/merchants/${id}/approve`, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
