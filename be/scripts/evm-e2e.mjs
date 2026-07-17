// End-to-end proof of the Navy EVM payment path against a LIVE Sepolia deployment.
//
// It exercises exactly what the backend does — build the EIP-712 ReceiveWithAuthorization
// (mirrors be/src/evm/payment-authorization.ts), have the payer sign it, and have the relayer
// submit payInvoice — against the deployed NavyPayments + REAL Circle USDC, then asserts the
// 99/1 split and the InvoicePaid event.
//
// Run (from be/):  node scripts/evm-e2e.mjs
// Needs, in be/.env: SEPOLIA_RPC_URL, NAVY_PAYMENTS_ADDRESS, NAVY_USDC_ADDRESS,
//   NAVY_TREASURY_ADDRESS, NAVY_OWNER_PRIVATE_KEY, NAVY_RELAYER_PRIVATE_KEY
// and in contract/e2e-actors.env: E2E_PAYER_PRIVATE_KEY, E2E_MERCHANT_PAYOUT_ADDRESS
// The payer address must hold >= 0.5 test USDC (faucet.circle.com, Ethereum Sepolia).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ethers } from 'ethers';

const here = dirname(fileURLToPath(import.meta.url));
const beRoot = join(here, '..');

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch { /* optional */ }
}
loadEnv(join(beRoot, '.env'));
loadEnv(join(beRoot, '..', 'contract', 'e2e-actors.env'));

function req(k) { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; }

const CHAIN_ID = parseInt(process.env.EVM_CHAIN_ID ?? '11155111', 10);
const AMOUNT = BigInt(process.env.E2E_AMOUNT_BASE ?? '500000'); // default 0.5 USDC (6 decimals)

// --- helpers mirroring be/src/evm/payment-authorization.ts ---
function uuidToBytes16Hex(uuid) {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`invalid uuid: ${uuid}`);
  return '0x' + hex;
}
const invoiceKey = (m, i) => ethers.keccak256(ethers.concat([m, i]));
const RWA_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
};

const PAYMENTS_ABI = JSON.parse(readFileSync(join(beRoot, 'src/evm/navy-payments-abi.json'), 'utf8')).abi;
const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function decimals() view returns (uint8)',
];

function log(ok, msg) { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) process.exitCode = 1; }

async function main() {
  const provider = new ethers.JsonRpcProvider(req('SEPOLIA_RPC_URL'), CHAIN_ID);
  const owner = new ethers.Wallet(req('NAVY_OWNER_PRIVATE_KEY'), provider);
  const relayer = new ethers.Wallet(req('NAVY_RELAYER_PRIVATE_KEY'), provider);
  const payer = new ethers.Wallet(req('E2E_PAYER_PRIVATE_KEY'), provider);
  const merchantPayout = ethers.getAddress(req('E2E_MERCHANT_PAYOUT_ADDRESS'));
  const treasury = ethers.getAddress(req('NAVY_TREASURY_ADDRESS'));
  const paymentsAddr = ethers.getAddress(req('NAVY_PAYMENTS_ADDRESS'));
  const usdcAddr = ethers.getAddress(req('NAVY_USDC_ADDRESS'));

  const payments = new ethers.Contract(paymentsAddr, PAYMENTS_ABI, provider);
  const usdc = new ethers.Contract(usdcAddr, USDC_ABI, provider);

  console.log(`Network chainId=${CHAIN_ID}  payments=${paymentsAddr}`);
  console.log(`owner=${owner.address}  relayer=${relayer.address}  payer=${payer.address}`);

  // Preconditions
  const payerBal = await usdc.balanceOf(payer.address);
  log(payerBal >= AMOUNT, `payer USDC balance ${payerBal} >= ${AMOUNT} (fund at faucet.circle.com if this fails)`);
  if (payerBal < AMOUNT) return;
  log((await provider.getBalance(relayer.address)) > 0n, 'relayer has Sepolia ETH for gas');

  // Ensure the relayer is allowlisted (deploy sets it when deployer==owner; enforce anyway).
  if (!(await payments.relayers(relayer.address))) {
    console.log('… allowlisting relayer'); const t = await payments.connect(owner).setRelayer(relayer.address, true); await t.wait();
  }

  // Fresh merchant + order ids each run (unique invoice → never a replay).
  const merchantUuid = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const merchantId = uuidToBytes16Hex(merchantUuid);
  const invoiceId = uuidToBytes16Hex(orderId);

  console.log('… registering merchant'); { const t = await payments.connect(owner).registerMerchant(merchantId, merchantPayout); await t.wait(); }

  // Build the EIP-712 authorization from the REAL on-chain USDC domain, and have the payer sign it.
  const domain = { name: await usdc.name(), version: await usdc.version(), chainId: CHAIN_ID, verifyingContract: usdcAddr };
  const validBefore = Math.floor(Date.now() / 1000) + 3600;
  const nonce = invoiceKey(merchantId, invoiceId);
  const message = { from: payer.address, to: paymentsAddr, value: AMOUNT.toString(), validAfter: '0', validBefore: validBefore.toString(), nonce };
  const signature = await payer.signTypedData(domain, RWA_TYPES, message);
  const sig = ethers.Signature.from(signature);
  log(ethers.verifyTypedData(domain, RWA_TYPES, message, signature) === payer.address, 'payer signature recovers to payer (USDC EIP-712 domain)');

  const mBefore = await usdc.balanceOf(merchantPayout);
  const tBefore = await usdc.balanceOf(treasury);

  console.log('… relayer submits payInvoice (gasless for payer)');
  const tx = await payments.connect(relayer).payInvoice(merchantId, invoiceId, AMOUNT, 0, validBefore, payer.address, sig.v, sig.r, sig.s);
  const receipt = await tx.wait();
  log(receipt.status === 1, `payInvoice mined ok (tx ${tx.hash})`);

  // Assert the 99/1 split and the InvoicePaid event.
  const fee = (AMOUNT * 100n) / 10000n; // feeBps=100
  const mAfter = await usdc.balanceOf(merchantPayout);
  const tAfter = await usdc.balanceOf(treasury);
  log(mAfter - mBefore === AMOUNT - fee, `merchant received ${mAfter - mBefore} (= ${AMOUNT - fee})`);
  log(tAfter - tBefore === fee, `treasury received ${tAfter - tBefore} (= ${fee})`);

  const evt = receipt.logs.map((l) => { try { return payments.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && p.name === 'InvoicePaid');
  log(!!evt, 'InvoicePaid event emitted');
  if (evt) {
    log(String(evt.args.payer) === payer.address && evt.args.amount === AMOUNT && evt.args.fee === fee && String(evt.args.invoiceId).toLowerCase() === invoiceId,
      `InvoicePaid args match (payer/amount/fee/invoiceId)`);
  }

  // Replay must fail (same invoice → USDC authorization + invoicePaid guard).
  try {
    await (await payments.connect(relayer).payInvoice(merchantId, invoiceId, AMOUNT, 0, validBefore, payer.address, sig.v, sig.r, sig.s)).wait();
    log(false, 'replay was rejected'); // should not reach
  } catch { log(true, 'replay of the same invoice was rejected'); }

  console.log(process.exitCode ? '\nE2E FAILED' : '\nE2E PASSED ✅');
}

main().catch((e) => { console.error('E2E error:', e.message ?? e); process.exit(1); });
