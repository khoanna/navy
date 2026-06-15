import { NextRequest, NextResponse } from 'next/server';
import { adminBackendFetch } from '@/lib/admin-api';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { reason } = await req.json().catch(() => ({ reason: undefined }));
  const res = await adminBackendFetch(`/admin/merchants/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
