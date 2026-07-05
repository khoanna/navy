import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE } from '@/lib/session';

type Role = 'user' | 'merchant' | 'admin';

/**
 * Read the role from a live (non-expired) access token. An expired token is
 * treated as no session, so an expired cookie redirects to login just like a
 * missing one — the client's silent refresh restores the session when possible.
 */
function activeRole(token: string | undefined): Role | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(b64).split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    const claims = JSON.parse(json) as { role?: string; exp?: number };
    if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) return null; // expired
    const role = claims.role;
    return role === 'user' || role === 'merchant' || role === 'admin' ? role : null;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const role = activeRole(req.cookies.get(ACCESS_COOKIE)?.value);

  const to = (path: string) => {
    const url = req.nextUrl.clone();
    url.pathname = path;
    url.search = '';
    return NextResponse.redirect(url);
  };

  // Login pages: bounce an already-authenticated user to their dashboard.
  if (pathname === '/admin/login') return role === 'admin' ? to('/admin') : NextResponse.next();
  if (pathname === '/merchant/login') return role === 'merchant' ? to('/merchant') : NextResponse.next();

  // Protected areas: require a live session for that role, else go to login.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return role === 'admin' ? NextResponse.next() : to('/admin/login');
  }
  if (pathname === '/merchant' || pathname.startsWith('/merchant/')) {
    return role === 'merchant' ? NextResponse.next() : to('/merchant/login');
  }

  // Landing: send authenticated back-office users straight to their dashboard.
  if (pathname === '/') {
    if (role === 'admin') return to('/admin');
    if (role === 'merchant') return to('/merchant');
  }

  return NextResponse.next();
}

export const config = { matcher: ['/', '/admin/:path*', '/merchant/:path*'] };
