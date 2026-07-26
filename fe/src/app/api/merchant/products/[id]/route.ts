import { NextRequest, NextResponse } from 'next/server';
import { sessionBackendFetch, sessionBackendFetchRaw } from '@/lib/session-backend';
import { guardOrigin } from '@/lib/request-guards';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  const form = await req.formData();
  const res = await sessionBackendFetchRaw(`/merchant/products/${id}`, { method: 'PATCH', body: form });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rejected = guardOrigin(req);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  const res = await sessionBackendFetch(`/merchant/products/${id}`, { method: 'DELETE' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
