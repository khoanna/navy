// be/scripts/agent-e2e.mjs  (run: node scripts/agent-e2e.mjs)
//
// Proves that the configured OpenRouter model actually performs tool-calling with
// Navy's real tool schemas — the prerequisite for the AI assistant to work at all.
// Requires OPENROUTER_API_KEY. Pick a FREE tool-capable model from
//   https://openrouter.ai/models?supported_parameters=tools&max_price=0
// and pass it via OPENROUTER_FREE_MODEL (default below), since free-model
// availability changes over time. The agent loop itself is model-agnostic.
import 'dotenv/config';

const key = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_FREE_MODEL || 'google/gemini-2.0-flash-exp:free';
const base = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

if (!key) {
  console.error('OPENROUTER_API_KEY is required. Set it in be/.env or the shell and re-run.');
  process.exit(2);
}

const tools = [
  { type: 'function', function: { name: 'get_portfolio', description: "Get the user's USDC + ETH balances and farming position.", parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'build_transfer', description: 'Build a gasless USDC transfer proposal. Call this directly with the @username the user named; the backend resolves usernames to addresses. amountBase is base units (6 decimals).', parameters: { type: 'object', properties: { recipient: { type: 'string', description: 'A @username or 0x address; pass the @username as-is.' }, amountBase: { type: 'string' } }, required: ['recipient', 'amountBase'], additionalProperties: false } } },
];

async function ask(message) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, tools, tool_choice: 'auto', messages: [
      { role: 'system', content: 'You are a wallet assistant. Use tools; amounts are base units (1 USDC = 1000000). When the user names a recipient by @username, pass it directly to build_transfer — the backend resolves usernames; do not ask for a 0x address.' },
      { role: 'user', content: message },
    ] }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()).choices[0].message;
}

const m1 = await ask("What's my balance?");
if (!m1.tool_calls?.some((t) => t.function.name === 'get_portfolio')) throw new Error('expected get_portfolio tool_call, got: ' + JSON.stringify(m1));
console.log('OK get_portfolio tool_call produced');

const m2 = await ask('Send 5 USDC to @linh');
const bt = m2.tool_calls?.find((t) => t.function.name === 'build_transfer');
if (!bt) throw new Error('expected build_transfer tool_call, got: ' + JSON.stringify(m2));
const args = JSON.parse(bt.function.arguments);
if (args.amountBase !== '5000000') console.warn('WARN model amountBase =', args.amountBase, '(expected 5000000 — check system prompt clarity)');
console.log('OK build_transfer tool_call produced:', args);
console.log('Free model', model, 'supports tool-calling ✓');
