import { fetch as expoFetch } from 'expo/fetch';
import { SseParser, type SseEvent } from './sseParser';

/**
 * POST /agent/chat and stream SSE frames.
 *
 * Uses `expo/fetch` streaming (Expo SDK 54): verified against the installed
 * `node_modules/expo/build/winter/fetch/FetchResponse.d.ts` — `FetchResponse.body`
 * is a `ReadableStream<Uint8Array>` (nullable), which exposes `getReader()`. So the
 * spec's ReadableStream reader path is used directly (no XHR fallback needed).
 */
export async function streamAgentChat(
  baseUrl: string,
  accessToken: string,
  body: { message: string; conversationId?: string },
  onEvent: (e: SseEvent) => void,
): Promise<void> {
  const res = await expoFetch(`${baseUrl}/agent/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`agent chat failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }), onEvent);
  }
}
