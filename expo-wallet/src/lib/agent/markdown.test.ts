import { parseMarkdown, type Block } from './markdown';

describe('parseMarkdown — blocks', () => {
  it('returns [] for empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n  ')).toEqual([]);
  });

  it('parses a plain paragraph as one text span', () => {
    expect(parseMarkdown('hello world')).toEqual<Block[]>([
      { type: 'paragraph', spans: [{ type: 'text', value: 'hello world' }] },
    ]);
  });

  it('joins consecutive non-blank lines into one paragraph', () => {
    const blocks = parseMarkdown('line one\nline two');
    expect(blocks).toEqual<Block[]>([
      { type: 'paragraph', spans: [{ type: 'text', value: 'line one line two' }] },
    ]);
  });

  it('splits paragraphs on a blank line', () => {
    const blocks = parseMarkdown('first\n\nsecond');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'paragraph', spans: [{ type: 'text', value: 'first' }] });
    expect(blocks[1]).toEqual({ type: 'paragraph', spans: [{ type: 'text', value: 'second' }] });
  });

  it('parses headings by level', () => {
    expect(parseMarkdown('# Title')).toEqual<Block[]>([
      { type: 'heading', level: 1, spans: [{ type: 'text', value: 'Title' }] },
    ]);
    expect(parseMarkdown('### Small')[0]).toMatchObject({ type: 'heading', level: 3 });
  });

  it('groups consecutive bullet lines into one bullet block', () => {
    const blocks = parseMarkdown('- one\n- two\n- three');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual<Block>({
      type: 'bullet',
      items: [
        [{ type: 'text', value: 'one' }],
        [{ type: 'text', value: 'two' }],
        [{ type: 'text', value: 'three' }],
      ],
    });
  });

  it('accepts *, - and • as bullet markers', () => {
    const blocks = parseMarkdown('* a\n• b');
    expect(blocks[0]).toMatchObject({ type: 'bullet' });
    expect((blocks[0] as any).items).toHaveLength(2);
  });

  it('groups ordered list items and keeps the start number', () => {
    const blocks = parseMarkdown('1. first\n2. second');
    expect(blocks[0]).toEqual<Block>({
      type: 'ordered',
      start: 1,
      items: [[{ type: 'text', value: 'first' }], [{ type: 'text', value: 'second' }]],
    });
  });

  it('parses a fenced code block preserving content verbatim', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1;\nconst b = 2;\n```');
    expect(blocks[0]).toEqual<Block>({ type: 'code', lang: 'ts', value: 'const a = 1;\nconst b = 2;' });
  });
});

describe('parseMarkdown — inline spans', () => {
  const spansOf = (src: string) => (parseMarkdown(src)[0] as any).spans;

  it('parses **bold**', () => {
    expect(spansOf('a **b** c')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'bold', value: 'b' },
      { type: 'text', value: ' c' },
    ]);
  });

  it('parses *italic* and _italic_', () => {
    expect(spansOf('*x*')).toEqual([{ type: 'italic', value: 'x' }]);
    expect(spansOf('_y_')).toEqual([{ type: 'italic', value: 'y' }]);
  });

  it('parses `inline code`', () => {
    expect(spansOf('run `npm test` now')).toEqual([
      { type: 'text', value: 'run ' },
      { type: 'code', value: 'npm test' },
      { type: 'text', value: ' now' },
    ]);
  });

  it('parses [text](href) links', () => {
    expect(spansOf('see [docs](https://x.io)')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', value: 'docs', href: 'https://x.io' },
    ]);
  });

  it('prefers bold over italic for **', () => {
    expect(spansOf('**bold**')).toEqual([{ type: 'bold', value: 'bold' }]);
  });

  it('treats an unterminated marker as literal text (streaming safety)', () => {
    expect(() => parseMarkdown('balance is **1,2')).not.toThrow();
    expect(spansOf('balance is **1,2')).toEqual([{ type: 'text', value: 'balance is **1,2' }]);
  });
});
