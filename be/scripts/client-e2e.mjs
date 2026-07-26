// Black-box client E2E: drives the running backend exactly as the fe/expo clients do —
// over HTTP with real role-bearing Navy JWTs — and asserts every client-facing endpoint.
//
// Covers success paths, auth guards (401), cross-role rejection (403), validation (400),
// and not-found (404) for the user (expo), merchant + admin (fe) surfaces.
//
// Prereq: BE running on :3000, Postgres up. Run (from be/):  node scripts/client-e2e.mjs
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { ethers } from 'ethers';

const BASE = process.env.NAVY_API_URL ?? 'http://localhost:3000';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ── tiny test harness ────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name}  ${detail}`); }
}
async function call(method, path, { token, body, rawBody, headers } = {}) {
  const h = { 'Content-Type': 'application/json', ...(headers ?? {}) };
  if (token) h.Authorization = `Bearer ${token}`;
  const payload = rawBody !== undefined ? rawBody : body ? JSON.stringify(body) : undefined;
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: payload });
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const section = (t) => console.log(`\n── ${t} ─────────────────────────────`);

// ── auth setup ───────────────────────────────────────────────────────────────
async function mintUserToken() {
  // Reuse the tested seeding script (seeds alice + bob + AuthSession, prints a user JWT).
  return execSync('node scripts/agent-e2e-token.mjs', { cwd: process.cwd() }).toString().trim();
}
async function seedAdmin() {
  const email = 'admin-e2e@navy.test';
  const password = 'adminpassword123';
  const totpSecret = 'JBSWY3DPEHPK3PXP'; // fixed base32 for deterministic codes
  const passwordHash = await argon2.hash(password);
  await prisma.admin.upsert({
    where: { email },
    update: { passwordHash, totpSecret, failedTotpCount: 0, failedPasswordCount: 0, lockedUntil: null, lastTotpStep: null },
    create: { email, passwordHash, totpSecret },
  });
  return { email, password, totpSecret };
}

async function main() {
  console.log(`Client E2E against ${BASE}\n`);

  const userToken = await mintUserToken();
  const admin = await seedAdmin();

  // ── health (public) ──
  section('health + public');
  check('GET /health → 200', (await call('GET', '/health')).status === 200);

  // ── auth guards: protected routes reject anonymous ──
  section('auth guards (401 without token)');
  for (const [m, p] of [['GET', '/user/account/me'], ['GET', '/farming'], ['GET', '/agent/conversations'], ['GET', '/market/prices'], ['GET', '/merchant/stats'], ['GET', '/admin/stats']]) {
    check(`${m} ${p} → 401`, (await call(m, p)).status === 401);
  }

  // ── USER (expo) ──
  section('USER role (expo client)');
  const me = await call('GET', '/user/account/me', { token: userToken });
  check('GET /user/account/me → 200', me.status === 200, `got ${me.status}`);
  check('  …returns wallet address', typeof me.json?.walletAddress === 'string' || typeof me.json?.primaryWallet === 'string', JSON.stringify(me.json));

  const avail = await call('GET', '/user/account/username/available?u=totallyfreehandle999', { token: userToken });
  check('GET username/available → 200 {available}', avail.status === 200 && typeof avail.json?.available === 'boolean');

  const setU = await call('PUT', '/user/account/username', { token: userToken, body: { username: 'alice_e2e' } });
  check('PUT username → 200 {username}', setU.status === 200 && setU.json?.username === 'alice_e2e', JSON.stringify(setU.json));

  const pay = await call('GET', '/user/payments', { token: userToken });
  check('GET /user/payments → 200 (list)', pay.status === 200);

  const resolve = await call('GET', '/transfer/resolve?recipient=@bob', { token: userToken });
  check('GET /transfer/resolve @bob → 200 + address', resolve.status === 200 && typeof resolve.json?.address === 'string', JSON.stringify(resolve.json));
  const resolveMiss = await call('GET', '/transfer/resolve?recipient=@no_such_user_zzz', { token: userToken });
  check('GET /transfer/resolve unknown → 400 (client throws + shows error)', resolveMiss.status === 400, JSON.stringify(resolveMiss.json));

  check('GET /transfer/history → 200', (await call('GET', '/transfer/history', { token: userToken })).status === 200);

  // farming
  const sub = await call('POST', '/farming/subwallet', { token: userToken });
  check('POST /farming/subwallet → 2xx + address', sub.status < 300 && typeof sub.json?.address === 'string', `${sub.status} ${JSON.stringify(sub.json)}`);
  check('GET /farming → 200 (position)', (await call('GET', '/farming', { token: userToken })).status === 200);
  check('GET /farming/history → 200', (await call('GET', '/farming/history', { token: userToken })).status === 200);
  check('GET /farming/delegation → 200', (await call('GET', '/farming/delegation', { token: userToken })).status === 200);

  // market (user-gated)
  check('GET /market/prices?ids=ethereum → 200', (await call('GET', '/market/prices?ids=ethereum', { token: userToken })).status === 200);
  check('GET /market/token?query=bitcoin → 200', (await call('GET', '/market/token?query=bitcoin', { token: userToken })).status === 200);
  check('GET /market/top?limit=5 → 200', (await call('GET', '/market/top?limit=5', { token: userToken })).status === 200);

  // validation (400)
  const badDep = await call('POST', '/farming/deposit', { token: userToken, body: { amountBase: '-1' } });
  check('POST /farming/deposit {amountBase:-1} → 400', badDep.status === 400, `got ${badDep.status}`);
  const badXfer = await call('POST', '/transfer/authorization', { token: userToken, body: { amountBase: 'abc' } });
  check('POST /transfer/authorization {bad} → 400', badXfer.status === 400, `got ${badXfer.status}`);

  // agent conversations + 404
  check('GET /agent/conversations → 200', (await call('GET', '/agent/conversations', { token: userToken })).status === 200);
  const bogusConv = await call('GET', '/agent/conversations/00000000-0000-0000-0000-000000000000', { token: userToken });
  check('GET /agent/conversations/:bogus → 400 (rejected, no leak)', bogusConv.status === 400, `got ${bogusConv.status}`);

  // agent chat SSE (hits OpenRouter)
  section('USER agent chat (SSE)');
  await testAgentChat(userToken);

  // ── cross-role guard (403) ──
  section('cross-role rejection (403)');
  check('user token → GET /merchant/stats → 403', (await call('GET', '/merchant/stats', { token: userToken })).status === 403);
  check('user token → GET /admin/stats → 403', (await call('GET', '/admin/stats', { token: userToken })).status === 403);

  // ── MERCHANT (fe) ──
  section('MERCHANT role (fe client)');
  const memail = `merch-e2e-${Date.now()}@navy.test`;
  const signup = await call('POST', '/auth/merchant/signup', { body: { email: memail, password: 'merchantpw123', businessName: 'E2E Bakery' } });
  check('POST /auth/merchant/signup → 2xx + accessToken', signup.status < 300 && typeof signup.json?.accessToken === 'string', `${signup.status}`);
  const login = await call('POST', '/auth/merchant', { body: { email: memail, password: 'merchantpw123' } });
  check('POST /auth/merchant → 2xx + accessToken', login.status < 300 && typeof login.json?.accessToken === 'string', `${login.status}`);
  const mToken = login.json?.accessToken ?? signup.json?.accessToken;
  const badLogin = await call('POST', '/auth/merchant', { body: { email: memail, password: 'wrongpassword' } });
  check('POST /auth/merchant wrong pw → 401', badLogin.status === 401, `got ${badLogin.status}`);

  check('GET /merchant/stats → 200', (await call('GET', '/merchant/stats', { token: mToken })).status === 200);
  // products CRUD
  check('GET /merchant/products → 200', (await call('GET', '/merchant/products', { token: mToken })).status === 200);
  const prod = await call('POST', '/merchant/products', { token: mToken, body: { name: 'Croissant', unitPrice: '250000' } });
  check('POST /merchant/products → 2xx + id', prod.status < 300 && typeof prod.json?.id === 'string', `${prod.status} ${JSON.stringify(prod.json)}`);
  if (prod.json?.id) {
    check('PATCH /merchant/products/:id → 200', (await call('PATCH', `/merchant/products/${prod.json.id}`, { token: mToken, body: { active: false } })).status === 200);
    check('DELETE /merchant/products/:id → 2xx', (await call('DELETE', `/merchant/products/${prod.json.id}`, { token: mToken })).status < 300);
  }
  const badProd = await call('POST', '/merchant/products', { token: mToken, body: { name: 'x', unitPrice: 'notint' } });
  check('POST /merchant/products {bad price} → 400', badProd.status === 400, `got ${badProd.status}`);
  // charges CRUD
  check('GET /merchant/charges → 200', (await call('GET', '/merchant/charges', { token: mToken })).status === 200);
  const charge = await call('POST', '/merchant/charges', { token: mToken, body: { name: 'VAT', mode: 'percent', value: 10 } });
  check('POST /merchant/charges → 2xx + id', charge.status < 300 && typeof charge.json?.id === 'string', `${charge.status}`);
  // orders + payout challenge
  check('GET /merchant/orders → 200', (await call('GET', '/merchant/orders', { token: mToken })).status === 200);
  const chal = await call('POST', '/merchant/payout/challenge', { token: mToken });
  check('POST /merchant/payout/challenge → 2xx + challenge', chal.status < 300 && (typeof chal.json?.challenge === 'string' || typeof chal.json?.message === 'string'), `${chal.status} ${JSON.stringify(chal.json)}`);
  check('merchant token → GET /admin/stats → 403', (await call('GET', '/admin/stats', { token: mToken })).status === 403);

  // ── ADMIN (fe) ──
  section('ADMIN role (fe client)');
  const wrongTotp = await call('POST', '/auth/admin', { body: { email: admin.email, password: admin.password, totp: '000000' } });
  check('POST /auth/admin wrong totp → 401', wrongTotp.status === 401, `got ${wrongTotp.status}`);
  const code = authenticator.generate(admin.totpSecret);
  const aLogin = await call('POST', '/auth/admin', { body: { email: admin.email, password: admin.password, totp: code } });
  check('POST /auth/admin → 2xx + accessToken', aLogin.status < 300 && typeof aLogin.json?.accessToken === 'string', `${aLogin.status} ${JSON.stringify(aLogin.json)}`);
  const aToken = aLogin.json?.accessToken;
  if (aToken) {
    check('GET /admin/stats → 200', (await call('GET', '/admin/stats', { token: aToken })).status === 200);
    const merchants = await call('GET', '/admin/merchants', { token: aToken });
    check('GET /admin/merchants → 200 (list)', merchants.status === 200);
    check('admin token → GET /merchant/stats → 403', (await call('GET', '/merchant/stats', { token: aToken })).status === 403);
  }

  // ── MERCHANT onboarding lifecycle → order via API key ──
  section('MERCHANT onboarding → order via API key (mutations + edge cases)');

  // duplicate signup → 409
  const dup = await call('POST', '/auth/merchant/signup', { body: { email: memail, password: 'merchantpw123', businessName: 'dupe' } });
  check('duplicate signup → 409', dup.status === 409, `got ${dup.status}`);

  // API key before approval → 403 (assertApproved)
  const earlyKey = await call('POST', '/merchant/api-keys', { token: mToken });
  check('POST /merchant/api-keys before approval → 403', earlyKey.status === 403, `got ${earlyKey.status}`);

  // payout: challenge → bad signature → 400, then valid wallet signature → 200
  const chalR = await call('POST', '/merchant/payout/challenge', { token: mToken });
  const challenge = chalR.json?.challenge;
  const payWallet = ethers.Wallet.createRandom();
  const badSig = '0x' + '11'.repeat(65);
  const badPayout = await call('POST', '/merchant/payout', { token: mToken, body: { address: payWallet.address, message: challenge, signature: badSig } });
  check('POST /merchant/payout bad signature → 400', badPayout.status === 400, `got ${badPayout.status}`);
  const goodSig = await payWallet.signMessage(challenge);
  const setPayout = await call('POST', '/merchant/payout', { token: mToken, body: { address: payWallet.address, message: challenge, signature: goodSig } });
  check('POST /merchant/payout valid wallet sig → 2xx', setPayout.status < 300 && setPayout.json?.payoutAddress === payWallet.address, `${setPayout.status} ${JSON.stringify(setPayout.json)}`);

  // admin approve (on-chain registerMerchant via owner) — needs the merchant's DB id
  const mRow = await prisma.merchant.findUnique({ where: { email: memail } });
  console.log('   … admin approving (on-chain registerMerchant, ~15s)');
  const approve = await call('POST', `/admin/merchants/${mRow.id}/approve`, { token: aToken });
  check('POST /admin/merchants/:id/approve → 2xx (on-chain)', approve.status < 300 && approve.json?.approvalStatus === 'approved', `${approve.status} ${JSON.stringify(approve.json)}`);

  // now api key issues
  const keyR = await call('POST', '/merchant/api-keys', { token: mToken });
  check('POST /merchant/api-keys after approval → 2xx + key/secret', keyR.status < 300 && /^navy_pk_/.test(keyR.json?.apiKey ?? '') && /^navy_sk_/.test(keyR.json?.apiSecret ?? ''), `${keyR.status}`);
  const apiKey = keyR.json?.apiKey, apiSecret = keyR.json?.apiSecret;

  // product to reference in the order
  const oProd = await call('POST', '/merchant/products', { token: mToken, body: { name: 'Baguette', unitPrice: '250000' } });
  check('POST /merchant/products (for order) → id', oProd.status < 300 && typeof oProd.json?.id === 'string', `${oProd.status}`);

  // create order via API key (HMAC over the exact raw body)
  const hmac = (secret, raw) => createHmac('sha256', secret).update(raw).digest('hex');
  const orderBody = JSON.stringify({ items: [{ productId: oProd.json?.id, quantity: 2 }] });
  const order = await call('POST', '/v1/orders', { rawBody: orderBody, headers: { 'x-navy-key': apiKey, 'x-navy-signature': hmac(apiSecret, orderBody) } });
  check('POST /v1/orders via API key (HMAC) → 2xx + amount', order.status < 300 && typeof order.json?.orderId === 'string' && /^\d+$/.test(String(order.json?.amount ?? '')), `${order.status} ${JSON.stringify(order.json)}`);

  // public order read
  if (order.json?.orderId) {
    const getO = await call('GET', `/v1/orders/${order.json.orderId}`);
    check('GET /v1/orders/:id (public) → 200 + status', getO.status === 200 && getO.json?.status === 'awaiting_payment', `${getO.status} ${JSON.stringify(getO.json)}`);
  }

  // edge: bad HMAC signature → 401
  const badHmacOrder = await call('POST', '/v1/orders', { rawBody: orderBody, headers: { 'x-navy-key': apiKey, 'x-navy-signature': 'deadbeef' } });
  check('POST /v1/orders bad HMAC → 401', badHmacOrder.status === 401, `got ${badHmacOrder.status}`);

  // edge: missing API key → 401
  const noKeyOrder = await call('POST', '/v1/orders', { rawBody: orderBody });
  check('POST /v1/orders no API key → 401', noKeyOrder.status === 401, `got ${noKeyOrder.status}`);

  // edge: empty items → 400 (validation), with a valid HMAC so it reaches the DTO
  const emptyBody = JSON.stringify({ items: [] });
  const emptyOrder = await call('POST', '/v1/orders', { rawBody: emptyBody, headers: { 'x-navy-key': apiKey, 'x-navy-signature': hmac(apiSecret, emptyBody) } });
  check('POST /v1/orders empty items → 400', emptyOrder.status === 400, `got ${emptyOrder.status}`);

  // ── summary ──
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) console.log(`  FAILED: ${fails.join(', ')}`);
  console.log(fail ? '\nCLIENT E2E FAILED ✗' : '\nCLIENT E2E PASSED ✅');
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

async function testAgentChat(token) {
  const res = await fetch(`${BASE}/agent/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: "what's my balance?" }),
  });
  check('POST /agent/chat → 2xx SSE (client checks res.ok)', res.ok && (res.headers.get('content-type') ?? '').includes('event-stream'), `${res.status} ${res.headers.get('content-type')}`);
  if (!res.ok || !res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = new Set();
  let buf = '';
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (const line of buf.split('\n')) {
      const m = line.match(/^event:\s*(\w+)/);
      if (m) events.add(m[1]);
    }
    if (events.has('done')) break;
  }
  check('  agent SSE emitted token/tool events', events.has('token') || events.has('tool_start') || events.has('tool_result'), [...events].join(','));
  check('  agent SSE terminated with done', events.has('done'), [...events].join(','));
}

main().catch((e) => { console.error('client-e2e error:', e); process.exit(1); });
