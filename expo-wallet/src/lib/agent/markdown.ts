// A small, framework-free Markdown parser for the assistant's chat text.
//
// Scope is deliberately narrow — the subset an LLM chat reply actually emits:
// headings, paragraphs, unordered/ordered lists, fenced code blocks, and the
// inline markers **bold**, *italic*/_italic_, `code`, and [text](href).
//
// It is intentionally forgiving: any unterminated marker (common while text is
// still streaming in) falls back to literal text rather than throwing. Inline
// parsing is flat (no nesting) — enough for chat, and trivially unit-testable.

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; value: string; href: string };

export type Block =
  | { type: 'heading'; level: number; spans: Inline[] }
  | { type: 'paragraph'; spans: Inline[] }
  | { type: 'bullet'; items: Inline[][] }
  | { type: 'ordered'; items: Inline[][]; start: number }
  | { type: 'code'; value: string; lang?: string };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*(\d+)\.\s+(.*)$/;
const FENCE = /^\s*```(\w*)\s*$/;

/** Parse a Markdown string into a flat list of blocks. Never throws. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', spans: parseInline(para.join(' ')) });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block: consume until the closing fence (or EOF).
    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1] || undefined;
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      blocks.push({ type: 'code', value: body.join('\n'), ...(lang ? { lang } : {}) });
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ type: 'heading', level: heading[1].length, spans: parseInline(heading[2].trim()) });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      const last = blocks[blocks.length - 1];
      const item = parseInline(bullet[1].trim());
      if (last && last.type === 'bullet') last.items.push(item);
      else blocks.push({ type: 'bullet', items: [item] });
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushPara();
      const last = blocks[blocks.length - 1];
      const item = parseInline(ordered[2].trim());
      if (last && last.type === 'ordered') last.items.push(item);
      else blocks.push({ type: 'ordered', items: [item], start: parseInt(ordered[1], 10) });
      continue;
    }

    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

const CODE = /^`([^`]+)`/;
const BOLD = /^(?:\*\*([^*]+)\*\*|__([^_]+)__)/;
const ITALIC = /^(?:\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_)/;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)/;

/** Parse a single line/segment into flat inline spans. Never throws. */
export function parseInline(src: string): Inline[] {
  const spans: Inline[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) {
      spans.push({ type: 'text', value: buf });
      buf = '';
    }
  };

  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpExecArray | null;

    if ((m = CODE.exec(rest))) {
      flush();
      spans.push({ type: 'code', value: m[1] });
      i += m[0].length;
    } else if ((m = BOLD.exec(rest))) {
      flush();
      spans.push({ type: 'bold', value: m[1] ?? m[2] });
      i += m[0].length;
    } else if ((m = ITALIC.exec(rest))) {
      flush();
      spans.push({ type: 'italic', value: m[1] ?? m[2] });
      i += m[0].length;
    } else if ((m = LINK.exec(rest))) {
      flush();
      spans.push({ type: 'link', value: m[1], href: m[2] });
      i += m[0].length;
    } else {
      buf += src[i];
      i++;
    }
  }
  flush();
  return spans;
}
