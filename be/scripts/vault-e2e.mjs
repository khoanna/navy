// End-to-end proof of the NavyVault approve → deposit → redeem path against a LIVE Base
// deployment, driven through the backend's UNSIGNED TRANSACTION PROPOSALS.
//
// Paper §2.1: "Farming has no backend relayer, EIP-3009 deposit flow, sponsored gas, or
// relayed redemption." §10.2: the backend "does not relay farming transactions, possess the
// allocator key, or execute rebalances." So this script mirrors what the CLIENT does, not
// what a relayer used to do:
//
//   1. POST /vault/transactions/approve  → unsigned ERC-20 approve(vault, amount)
//   2. the payer signs and broadcasts it themselves, paying their own Base gas
//   3. POST /vault/transactions/deposit  → unsigned vault.deposit(assets, payer)
//   4. the payer signs and broadcasts that too
//   5. GET  /vault/position              → assert shares/assets moved
//   6. POST /vault/transactions/redeem   → unsigned vault.redeem(shares, payer, payer)
//   7. the payer signs and broadcasts, and we assert the USDC came back
//
// There is no relayer key here and no keeper step: rebalancing belongs to srcla, which holds
// the allocator key. The backend only *describes* transactions; every one of them is signed
// and paid for by the payer's own EOA.
//
// REQUIRES A FUNDED EOA AND A LIVE CHAIN. The payer must hold both Base USDC (to deposit)
// and Base ETH (to pay gas for three transactions) — that is the deliberate UX regression
// §2.1 accepts. It also needs the backend running and a Navy user JWT whose walletAddress
// IS the payer, because every proposal route derives the wallet from the token.
//
// NOT RUN IN THIS PHASE. No chain, backend or database was available when it was written;
// it has never been executed against a live deployment and must be treated as unverified.
//
// Run (from be/):
//   NAVY_VAULT_E2E=1 \
//   VAULT_E2E_JWT=<navy user jwt> \
//   NAVY_VAULT_E2E_PAYER_KEY=<plain EOA private key, same wallet as the JWT> \
//   node scripts/vault-e2e.mjs
//
// Needs in be/.env (or the shell): BASE_RPC_URL, NAVY_VAULT_ADDRESS, NAVY_USDC_ADDRESS.
// Optional: VAULT_E2E_BACKEND_URL (default http://localhost:3000),
//           VAULT_E2E_AMOUNT_BASE (default 1000000 = 1 USDC), EVM_CHAIN_ID (default 8453).
//
// GATING: prints a no-op message and exits 0 unless NAVY_VAULT_E2E=1 AND NAVY_VAULT_ADDRESS
// is set, so it is safe to invoke without a deployment.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ethers } from 'ethers';

const beRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch { /* optional */ }
}
loadEnv(join(beRoot, '.env'));

// Gate: no-op (exit 0) unless explicitly enabled AND a vault is deployed.
if (process.env.NAVY_VAULT_E2E !== '1') {
  console.log('NAVY_VAULT_E2E != 1 — skipping the live vault E2E (no-op). Set NAVY_VAULT_E2E=1 to run.');
  process.exit(0);
}
if (!process.env.NAVY_VAULT_ADDRESS) {
  console.log('NAVY_VAULT_ADDRESS is unset — vault not deployed yet, skipping the live vault E2E (no-op).');
  process.exit(0);
}

const req = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; };
const CHAIN_ID = parseInt(process.env.EVM_CHAIN_ID ?? '8453', 10);
const AMOUNT = BigInt(process.env.VAULT_E2E_AMOUNT_BASE ?? '1000000'); // default 1 USDC (6 decimals)
const BACKEND = (process.env.VAULT_E2E_BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const JWT = req('VAULT_E2E_JWT');

const VAULT_ABI = JSON.parse(readFileSync(join(beRoot, 'src/evm/navy-vault-abi.json'), 'utf8')); // BARE ARRAY
const USDC_ABI = JSON.parse(readFileSync(join(beRoot, 'src/evm/usdc-abi.json'), 'utf8')).abi;     // { abi: [...] }

// Decoders — deliberately independent of the backend, so a malformed proposal is caught here
// rather than silently broadcast.
const ERC20_IFACE = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
]);
const VAULT_IFACE = new ethers.Interface([
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
]);

function log(ok, msg) { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) process.exitCode = 1; }

async function api(method, path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${JWT}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res.json();
}

/** Sign and broadcast one proposal from the payer's own EOA. The payer pays the gas. */
async function broadcast(payer, proposal, label) {
  log(proposal.chainId === CHAIN_ID, `${label}: proposal chainId ${proposal.chainId} === ${CHAIN_ID}`);
  const tx = await payer.sendTransaction({
    to: proposal.to,
    data: proposal.data,
    value: BigInt(proposal.value ?? '0'),
  });
  const rcpt = await tx.wait();
  log(rcpt.status === 1, `${label}: mined ok (tx ${tx.hash})`);
  return rcpt;
}

async function main() {
  const rpc = req('BASE_RPC_URL');
  const provider = new ethers.JsonRpcProvider(rpc, CHAIN_ID);
  const payer = new ethers.Wallet(req('NAVY_VAULT_E2E_PAYER_KEY'), provider);

  const vaultAddr = ethers.getAddress(req('NAVY_VAULT_ADDRESS'));
  const usdcAddr = ethers.getAddress(req('NAVY_USDC_ADDRESS'));

  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
  const usdc = new ethers.Contract(usdcAddr, USDC_ABI, provider);

  console.log(`Network chainId=${CHAIN_ID}  vault=${vaultAddr}  usdc=${usdcAddr}`);
  console.log(`backend=${BACKEND}  payer=${payer.address}`);

  // ── Preconditions. The payer funds BOTH sides now — there is no relayer. ──
  log((await usdc.balanceOf(payer.address)) >= AMOUNT, `payer USDC balance >= ${AMOUNT}`);
  const ethBal = await provider.getBalance(payer.address);
  log(ethBal > 0n, `payer has Base ETH for gas (${ethBal} wei) — §2.1 makes the USER pay gas`);

  // The JWT must belong to the payer: every proposal route derives the wallet from the token,
  // so a mismatched JWT would silently build transactions for somebody else's address.
  const position0 = await api('GET', '/vault/position');
  console.log(`   starting position: shares=${position0.sharesBase} assets=${position0.assetsBase}`);

  // ── 1. APPROVE (unsigned proposal → payer signs and broadcasts) ──
  const { transactions: approveTxs } = await api('POST', '/vault/transactions/approve', {
    amountBase: AMOUNT.toString(),
  });
  log(approveTxs.length === 1, `approve proposal returned 1 transaction (got ${approveTxs.length})`);
  const approveProposal = approveTxs[0];
  log(
    approveProposal.to.toLowerCase() === usdcAddr.toLowerCase(),
    `approve proposal targets USDC (${approveProposal.to})`,
  );
  const approveArgs = ERC20_IFACE.decodeFunctionData('approve', approveProposal.data);
  log(
    approveArgs[0].toLowerCase() === vaultAddr.toLowerCase(),
    `approve spender is the vault (${approveArgs[0]})`,
  );
  log(approveArgs[1] === AMOUNT, `approve amount is ${AMOUNT} (got ${approveArgs[1]})`);
  await broadcast(payer, approveProposal, 'approve');
  log(
    (await usdc.allowance(payer.address, vaultAddr)) >= AMOUNT,
    'on-chain allowance(payer → vault) >= deposit amount',
  );

  // ── 2. DEPOSIT (unsigned proposal → payer signs and broadcasts) ──
  const { transactions: depositTxs } = await api('POST', '/vault/transactions/deposit', {
    assetsBase: AMOUNT.toString(),
  });
  // The allowance is already in place, so the builder should emit deposit alone.
  const depositProposal = depositTxs[depositTxs.length - 1];
  log(
    depositProposal.to.toLowerCase() === vaultAddr.toLowerCase(),
    `deposit proposal targets the vault (${depositProposal.to})`,
  );
  const depositArgs = VAULT_IFACE.decodeFunctionData('deposit', depositProposal.data);
  log(depositArgs[0] === AMOUNT, `deposit assets is ${AMOUNT} (got ${depositArgs[0]})`);
  log(
    depositArgs[1].toLowerCase() === payer.address.toLowerCase(),
    `deposit receiver is the payer (${depositArgs[1]}) — NOT the backend`,
  );

  const sharesBefore = await vault.balanceOf(payer.address);
  for (const t of depositTxs) await broadcast(payer, t, 'deposit');

  const sharesAfter = await vault.balanceOf(payer.address);
  const mintedShares = sharesAfter - sharesBefore;
  log(mintedShares > 0n, `vault.balanceOf(payer) increased by ${mintedShares} shares`);
  const assetsForShares = await vault.convertToAssets(mintedShares);
  log(
    assetsForShares >= AMOUNT - 2n && assetsForShares <= AMOUNT + 2n,
    `convertToAssets(shares)=${assetsForShares} ≈ ${AMOUNT}`,
  );

  // ── 3. POSITION (the backend's read view agrees with the chain) ──
  const position1 = await api('GET', '/vault/position');
  log(
    BigInt(position1.sharesBase) === sharesAfter,
    `GET /vault/position shares (${position1.sharesBase}) === on-chain (${sharesAfter})`,
  );

  // ── 4. READS ──
  console.log(`   totalAssets = ${await vault.totalAssets()}`);
  const adapterCount = await vault.adapterCount();
  console.log(`   adapterCount = ${adapterCount} (allocation across them belongs to srcla, not be)`);

  // ── 5. REDEEM (unsigned proposal → payer signs and broadcasts; no permit, no relayer) ──
  const shares = await vault.balanceOf(payer.address);
  log(shares > 0n, `payer holds ${shares} shares to redeem`);
  const { transactions: redeemTxs } = await api('POST', '/vault/transactions/redeem', {
    sharesBase: shares.toString(),
  });
  const redeemProposal = redeemTxs[redeemTxs.length - 1];
  const redeemArgs = VAULT_IFACE.decodeFunctionData('redeem', redeemProposal.data);
  log(redeemArgs[0] === shares, `redeem shares is ${shares} (got ${redeemArgs[0]})`);
  log(
    redeemArgs[1].toLowerCase() === payer.address.toLowerCase() &&
      redeemArgs[2].toLowerCase() === payer.address.toLowerCase(),
    'redeem receiver and owner are both the payer',
  );

  const payerUsdcBefore = await usdc.balanceOf(payer.address);
  const previewedAssets = await vault.convertToAssets(shares);
  for (const t of redeemTxs) await broadcast(payer, t, 'redeem');

  const gained = (await usdc.balanceOf(payer.address)) - payerUsdcBefore;
  log(
    gained >= previewedAssets - 2n && gained <= previewedAssets + 2n,
    `payer USDC increased by ${gained} ≈ redeemed assets ${previewedAssets}`,
  );
  log((await vault.balanceOf(payer.address)) <= 2n, 'payer vault share balance returned to ~0');

  console.log(process.exitCode ? '\nVAULT E2E FAILED' : '\nVAULT E2E PASSED ✅');
  if (process.exitCode) process.exit(1);
}

main().catch((e) => { console.error('vault e2e error:', e.shortMessage ?? e.message ?? e); process.exit(1); });
