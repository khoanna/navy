/**
 * Parses a Nest/proxy error response body and returns its `error` or `message`
 * string field (in that order), or `undefined` if the body isn't a JSON object
 * with either field. Used to surface a human-readable detail on a failed fetch.
 */
export async function detailOf(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => null);
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string') return b.error;
    if (typeof b.message === 'string') return b.message;
  }
  return undefined;
}
