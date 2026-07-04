import { NextResponse } from 'next/server';
import { adminBackendFetch } from '@/lib/admin-api';
import { guardOrigin } from '@/lib/request-guards';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  const res = await adminBackendFetch(`/admin/merchants/${id}/approve`, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
