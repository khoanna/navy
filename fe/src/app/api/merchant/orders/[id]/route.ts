import { NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await sessionBackendFetch(`/merchant/orders/${id}`);
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
