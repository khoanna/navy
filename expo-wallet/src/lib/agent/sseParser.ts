export interface SseEvent { event: string; data: any }

/** Incremental SSE frame parser: feed it raw text chunks, get parsed {event,data} frames. */
export class SseParser {
  private buffer = '';
  push(chunk: string, emit: (e: SseEvent) => void): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      try { emit({ event, data: JSON.parse(dataLines.join('\n')) }); } catch { /* skip malformed */ }
    }
  }
}
