// Drive POST /agent/chat over SSE and print parsed events.
// Usage: node scripts/agent-e2e-chat.mjs "your message" [conversationId]
import { readFileSync } from 'fs';

const token = readFileSync('/tmp/navy-token.txt', 'utf8').trim();
const message = process.argv[2] ?? "what's my balance?";
const conversationId = process.argv[3];
const base = process.env.NAVY_API_URL ?? 'http://localhost:3000';

const res = await fetch(`${base}/agent/chat`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, conversationId }),
});

if (!res.ok) {
  console.error('HTTP', res.status, await res.text());
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let assistantText = '';
const toolsCalled = [];

function handleFrame(frame) {
  let event = 'message';
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;
  let data;
  try { data = JSON.parse(dataLines.join('\n')); } catch { return; }
  if (event === 'token') { assistantText += data.delta; }
  else if (event === 'tool_start') { toolsCalled.push(data.name); console.log(`  → tool_start: ${data.name}`); }
  else if (event === 'tool_result') {
    const d = data.result?.display;
    const err = data.result?.error;
    console.log(`  ← tool_result: ${data.name}  display=${JSON.stringify(d)}${err ? '  ERROR=' + err : ''}`);
    const preview = JSON.stringify(data.result);
    console.log(`      result: ${preview.length > 400 ? preview.slice(0, 400) + '…' : preview}`);
  }
  else if (event === 'done') { console.log(`  ✓ done conversationId=${data.conversationId}`); }
  else if (event === 'error') { console.log(`  ✗ error: ${data.message}`); }
}

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buffer.indexOf('\n\n')) !== -1) {
    handleFrame(buffer.slice(0, idx));
    buffer = buffer.slice(idx + 2);
  }
}

console.log('\n  ASSISTANT:', assistantText.trim() || '(empty)');
console.log('  TOOLS:', toolsCalled.join(', ') || '(none)');
