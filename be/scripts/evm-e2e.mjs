// End-to-end proof of the Navy EVM payment path against a LIVE Sepolia deployment.
//
// Exercises exactly what the backend does — build the EIP-2612 Permit (mirrors
// be/src/evm/payment-authorization.ts), have the payer sign it, and have the relayer submit
// payInvoice (permit + transferFrom) — against the deployed NavyPayments + the Aave Sepolia
// USDC, then asserts the 99/1 split and the InvoicePaid event.
//
// Run (from be/):  node scripts/evm-e2e.mjs
// Needs in be/.env: SEPOLIA_RPC_URL, NAVY_PAYMENTS_ADDRESS, NAVY_USDC_ADDRESS (Aave USDC),
//   NAVY_TREASURY_ADDRESS, NAVY_OWNER_PRIVATE_KEY, NAVY_RELAYER_PRIVATE_KEY,
//   NAVY_USDC_EIP712_NAME (USDC) / NAVY_USDC_EIP712_VERSION (1)
// and in contract/e2e-actors.env: E2E_PAYER_PRIVATE_KEY, E2E_MERCHANT_PAYOUT_ADDRESS.
// Aave USDC has a public mint() faucet, so this script self-funds the payer.

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

// helpers mirroring be/src/evm/payment-authorization.ts
function uuidToBytes16Hex(uuid) {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`invalid uuid: ${uuid}`);
  return '0x' + hex;
}
const RWA_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
};
const invoiceKey = (m, i) => ethers.keccak256(ethers.concat([m, i]));

const PAYMENTS_ABI = JSON.parse(readFileSync(join(beRoot, 'src/evm/navy-payments-abi.json'), 'utf8')).abi;
const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function name() view returns (string)',
  'function transfer(address,uint256) returns (bool)',
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

  console.log(`Network chainId=${CHAIN_ID}  payments=${paymentsAddr}  usdc=${usdcAddr}`);
  console.log(`owner=${owner.address}  relayer=${relayer.address}  payer=${payer.address}`);

  // Fund the payer with Circle USDC from the owner wallet (Circle USDC has no on-chain mint;
  // the human faucet is faucet.circle.com). Skipped when the owner IS the payer.
  if (payer.address.toLowerCase() !== owner.address.toLowerCase() && (await usdc.balanceOf(payer.address)) < AMOUNT) {
    console.log('… transferring Circle USDC to payer from owner');
    await (await usdc.connect(owner).transfer(payer.address, AMOUNT * 2n)).wait();
  }
  log((await usdc.balanceOf(payer.address)) >= AMOUNT, `payer USDC balance >= ${AMOUNT}`);
  log((await provider.getBalance(relayer.address)) > 0n, 'relayer has Sepolia ETH for gas');

  if (!(await payments.relayers(relayer.address))) {
    console.log('… allowlisting relayer'); await (await payments.connect(owner).setRelayer(relayer.address, true)).wait();
  }

  // Fresh merchant + order ids each run (unique invoice → never a replay).
  const merchantUuid = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const merchantId = uuidToBytes16Hex(merchantUuid);
  const invoiceId = uuidToBytes16Hex(orderId);

  console.log('… registering merchant'); await (await payments.connect(owner).registerMerchant(merchantId, merchantPayout)).wait();

  // Build the EIP-3009 ReceiveWithAuthorization (nonce = keccak256(merchantId, invoiceId)) and sign it.
  const domain = { name: process.env.NAVY_USDC_EIP712_NAME ?? await usdc.name(), version: process.env.NAVY_USDC_EIP712_VERSION ?? '2', chainId: CHAIN_ID, verifyingContract: usdcAddr };
  const validBefore = Math.floor(Date.now() / 1000) + 3600;
  const nonce = invoiceKey(merchantId, invoiceId);
  const message = { from: payer.address, to: paymentsAddr, value: AMOUNT.toString(), validAfter: '0', validBefore: validBefore.toString(), nonce };
  const signature = await payer.signTypedData(domain, RWA_TYPES, message);
  const sig = ethers.Signature.from(signature);
  log(ethers.verifyTypedData(domain, RWA_TYPES, message, signature) === payer.address, 'payer signature recovers to payer (USDC EIP-3009 domain)');

  const mBefore = await usdc.balanceOf(merchantPayout);
  const tBefore = await usdc.balanceOf(treasury);

  console.log('… relayer submits payInvoice (gasless for payer: receiveWithAuthorization)');
  const tx = await payments.connect(relayer).payInvoice(merchantId, invoiceId, AMOUNT, 0, validBefore, payer.address, sig.v, sig.r, sig.s);
  const receipt = await tx.wait();
  log(receipt.status === 1, `payInvoice mined ok (tx ${tx.hash})`);

  const fee = (AMOUNT * 100n) / 10000n; // feeBps=100
  log((await usdc.balanceOf(merchantPayout)) - mBefore === AMOUNT - fee, `merchant received ${AMOUNT - fee}`);
  log((await usdc.balanceOf(treasury)) - tBefore === fee, `treasury received ${fee}`);

  const evt = receipt.logs.map((l) => { try { return payments.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && p.name === 'InvoicePaid');
  log(!!evt, 'InvoicePaid event emitted');
  if (evt) log(String(evt.args.payer) === payer.address && evt.args.amount === AMOUNT && evt.args.fee === fee && String(evt.args.invoiceId).toLowerCase() === invoiceId, 'InvoicePaid args match');

  // Replay must fail (same invoice → invoicePaid guard).
  try {
    await (await payments.connect(relayer).payInvoice(merchantId, invoiceId, AMOUNT, 0, validBefore, payer.address, sig.v, sig.r, sig.s)).wait();
    log(false, 'replay was rejected');
  } catch { log(true, 'replay of the same invoice was rejected'); }

  console.log(process.exitCode ? '\nE2E FAILED' : '\nE2E PASSED ✅');
}

main().catch((e) => { console.error('E2E error:', e.message ?? e); process.exit(1); });
