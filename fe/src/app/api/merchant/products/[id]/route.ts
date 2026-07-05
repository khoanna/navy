import { NextRequest, NextResponse } from 'next/server';
import { sessionBackendFetch } from '@/lib/session-backend';
import { guardOrigin, parseJson } from '@/lib/request-guards';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  const parsed = await parseJson(req);
  if (!parsed.ok) return parsed.response;
  const res = await sessionBackendFetch(`/merchant/products/${id}`, { method: 'PATCH', body: JSON.stringify(parsed.body) });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  const res = await sessionBackendFetch(`/merchant/products/${id}`, { method: 'DELETE' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
