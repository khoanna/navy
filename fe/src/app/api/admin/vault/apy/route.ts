import { NextResponse } from 'next/server';

// No auth required — public market data
export async function GET() {
  const res = await fetch(`${process.env.NAVY_API_URL ?? 'http://localhost:3000'}/vault/apys`);
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
