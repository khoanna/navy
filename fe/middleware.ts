import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE } from '@/lib/session';

function roleFromToken(token: string | undefined): 'user' | 'merchant' | 'admin' | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(b64).split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    const role = (JSON.parse(json) as { role?: string }).role;
    return role === 'user' || role === 'merchant' || role === 'admin' ? role : null;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const role = roleFromToken(req.cookies.get(ACCESS_COOKIE)?.value);

  const needs = (area: 'admin' | 'merchant') => {
    if (role === area) return null;
    const url = req.nextUrl.clone();
    url.pathname = `/${area}/login`;
    return NextResponse.redirect(url);
  };

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (pathname.startsWith('/admin/login')) return NextResponse.next();
    return needs('admin') ?? NextResponse.next();
  }
  if (pathname === '/merchant' || pathname.startsWith('/merchant/')) {
    if (pathname.startsWith('/merchant/login')) return NextResponse.next();
    return needs('merchant') ?? NextResponse.next();
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*', '/merchant/:path*'] };
