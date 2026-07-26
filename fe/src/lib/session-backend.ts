import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from './session';
import { serverEnv } from './env';

export function buildAuthHeaders(token: string | undefined): Record<string, string> {
  if (!token) throw new Error('unauthenticated: no session token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function sessionBackendFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  return fetch(`${serverEnv().navyApiUrl}${path}`, { ...init, headers: { ...buildAuthHeaders(token), ...(init?.headers ?? {}) }, cache: 'no-store' });
}

/** Like sessionBackendFetch but WITHOUT a forced JSON content-type — for forwarding multipart bodies. */
export async function sessionBackendFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) throw new Error('unauthenticated: no session token');
  return fetch(`${serverEnv().navyApiUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
}
