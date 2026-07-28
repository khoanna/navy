// End-to-end proof of the NavyVault deposit → rebalance → redeem path against a LIVE Sepolia
// deployment. Mirrors what the backend does: the payer signs USDC's EIP-3009
// ReceiveWithAuthorization (from=payer, to=vault) so the relayer can pull funds gaslessly via
// vault.depositWithAuthorization; the keeper deploys idle liquidity to a registered adapter; and
// the payer signs an ERC-2612 Permit over the vault's OWN domain so the relayer can redeem shares
// back to USDC. Standalone (no backend/DB needed).
//
// Run (from be/):  NAVY_VAULT_E2E=1 node scripts/vault-e2e.mjs
// Needs in be/.env: SEPOLIA_RPC_URL, NAVY_VAULT_ADDRESS, NAVY_USDC_ADDRESS (Circle),
//   NAVY_RELAYER_PRIVATE_KEY, NAVY_KEEPER_PRIVATE_KEY (or NAVY_OWNER_PRIVATE_KEY),
//   NAVY_VAULT_E2E_PAYER_KEY (a plain EOA holding Sepolia USDC), and optionally
//   NAVY_USDC_EIP712_NAME/VERSION, NAVY_VAULT_EIP712_NAME/VERSION.
//
// GATING: prints a no-op message and exits 0 unless NAVY_VAULT_E2E=1 AND NAVY_VAULT_ADDRESS is set,
// so it is safe to invoke without a deployment. The LIVE run is DEFERRED until the vault is deployed
// + the relayer/keeper are funded.

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
const CHAIN_ID = parseInt(process.env.EVM_CHAIN_ID ?? '11155111', 10);
const AMOUNT = BigInt(process.env.VAULT_E2E_AMOUNT_BASE ?? '1000000'); // default 1 USDC (6 decimals)

const VAULT_ABI = JSON.parse(readFileSync(join(beRoot, 'src/evm/navy-vault-abi.json'), 'utf8')); // BARE ARRAY
const USDC_ABI = JSON.parse(readFileSync(join(beRoot, 'src/evm/usdc-abi.json'), 'utf8')).abi;     // { abi: [...] }
const ADAPTER_ABI = [
  'function supplyRatePerYear() view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function asset() view returns (address)',
];

// EIP-3009 ReceiveWithAuthorization (USDC domain) — payer signs so the relayer can pull funds.
const RWA_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
};
// ERC-2612 Permit (vault's own domain) — payer signs so the relayer can redeem shares.
const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

function log(ok, msg) { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) process.exitCode = 1; }

async function main() {
  const provider = new ethers.JsonRpcProvider(req('SEPOLIA_RPC_URL'), CHAIN_ID);
  const relayer = new ethers.Wallet(req('NAVY_RELAYER_PRIVATE_KEY'), provider);
  const keeper = new ethers.Wallet(process.env.NAVY_KEEPER_PRIVATE_KEY ?? req('NAVY_OWNER_PRIVATE_KEY'), provider);
  const payer = new ethers.Wallet(req('NAVY_VAULT_E2E_PAYER_KEY'), provider); // plain EOA holding USDC

  const vaultAddr = ethers.getAddress(req('NAVY_VAULT_ADDRESS'));
  const usdcAddr = ethers.getAddress(req('NAVY_USDC_ADDRESS'));

  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, relayer);
  const usdc = new ethers.Contract(usdcAddr, USDC_ABI, provider);

  console.log(`Network chainId=${CHAIN_ID}  vault=${vaultAddr}  usdc=${usdcAddr}`);
  console.log(`relayer=${relayer.address}  keeper=${keeper.address}  payer=${payer.address}`);

  // Preconditions.
  log((await usdc.balanceOf(payer.address)) >= AMOUNT, `payer USDC balance >= ${AMOUNT}`);
  log((await provider.getBalance(relayer.address)) > 0n, 'relayer has Sepolia ETH for gas');
  const payerHasCode = (await provider.getCode(payer.address)) !== '0x';
  log(!payerHasCode, 'payer is a plain EOA (no code — required for EIP-3009 / EIP-2612 raw ECDSA)');

  // ── 1. DEPOSIT (gasless for payer: EIP-3009 ReceiveWithAuthorization → vault pulls the USDC) ──
  const usdcDomain = {
    name: process.env.NAVY_USDC_EIP712_NAME ?? await usdc.name(),
    version: process.env.NAVY_USDC_EIP712_VERSION ?? '2',
    chainId: CHAIN_ID,
    verifyingContract: usdcAddr,
  };
  const validBefore = Math.floor(Date.now() / 1000) + 3600;
  const rwaNonce = ethers.hexlify(ethers.randomBytes(32));
  const rwaMessage = {
    from: payer.address, to: vaultAddr, value: AMOUNT.toString(),
    validAfter: '0', validBefore: validBefore.toString(), nonce: rwaNonce,
  };
  const rwaSig = ethers.Signature.from(await payer.signTypedData(usdcDomain, RWA_TYPES, rwaMessage));
  log(ethers.verifyTypedData(usdcDomain, RWA_TYPES, rwaMessage, rwaSig) === payer.address, 'payer RWA signature recovers to payer (USDC EIP-3009 domain)');

  const sharesBefore = await vault.balanceOf(payer.address);
  console.log('… relayer submits vault.depositWithAuthorization (gasless for payer)');
  const dtx = await vault.depositWithAuthorization(payer.address, AMOUNT, 0, validBefore, rwaNonce, rwaSig.v, rwaSig.r, rwaSig.s);
  const drcpt = await dtx.wait();
  log(drcpt.status === 1, `depositWithAuthorization mined ok (tx ${dtx.hash})`);

  const sharesAfter = await vault.balanceOf(payer.address);
  const mintedShares = sharesAfter - sharesBefore;
  log(mintedShares > 0n, `vault.balanceOf(payer) increased by ${mintedShares} shares`);
  const assetsForShares = await vault.convertToAssets(mintedShares);
  const nearAmount = assetsForShares >= AMOUNT - 2n && assetsForShares <= AMOUNT + 2n;
  log(nearAmount, `convertToAssets(shares)=${assetsForShares} ≈ ${AMOUNT}`);

  // ── 2. READS ──
  console.log(`   totalAssets = ${await vault.totalAssets()}`);
  const adapterCount = await vault.adapterCount();
  console.log(`   adapterCount = ${adapterCount}`);
  const adapterAddrs = [];
  for (let i = 0n; i < adapterCount; i++) {
    const a = await vault.adapters(i);
    adapterAddrs.push(a);
    const ad = new ethers.Contract(a, ADAPTER_ABI, provider);
    let rate = 'n/a', ta = 'n/a';
    try { rate = (await ad.supplyRatePerYear()).toString(); } catch { /* adapter may not expose */ }
    try { ta = (await ad.totalAssets()).toString(); } catch { /* ignore */ }
    console.log(`   adapter[${i}] = ${a}  supplyRatePerYear=${rate}  totalAssets=${ta}`);
  }

  // ── 3. REBALANCE (optional; keeper deploys idle above the min-idle buffer to an adapter) ──
  if (adapterAddrs.length > 0) {
    const idle = await usdc.balanceOf(vaultAddr);
    let enabled = false;
    try { const info = await vault.adapterInfo(adapterAddrs[0]); enabled = info[0]; } catch { /* older ABI */ }
    // Deploy a conservative slice of the idle balance to keep a buffer in the vault.
    const deployAmount = idle > AMOUNT ? AMOUNT / 2n : (idle > 4n ? idle / 2n : 0n);
    if (enabled && deployAmount > 0n) {
      console.log(`… keeper deploys ${deployAmount} idle USDC to adapter ${adapterAddrs[0]} (vault.deployToAdapter)`);
      try {
        const rtx = await vault.connect(keeper).deployToAdapter(adapterAddrs[0], deployAmount, { gasLimit: 500000n });
        await rtx.wait();
        console.log(`   rebalance tx ${rtx.hash}`);
        log(true, 'deployToAdapter executed');
      } catch (e) {
        console.log(`   rebalance skipped (deployToAdapter reverted: ${e.shortMessage ?? e.message})`);
      }
    } else {
      console.log(`   rebalance no-op (enabled=${enabled}, idle=${idle}, deployAmount=${deployAmount})`);
    }
  } else {
    console.log('   rebalance no-op (no registered adapters)');
  }

  // ── 4. REDEEM (gasless for payer: ERC-2612 Permit over the vault's own domain → relayer redeems) ──
  const shares = await vault.balanceOf(payer.address);
  log(shares > 0n, `payer holds ${shares} shares to redeem`);
  const permitNonce = await vault.nonces(payer.address);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const vaultDomain = {
    name: process.env.NAVY_VAULT_EIP712_NAME ?? 'Navy Vault USDC',
    version: process.env.NAVY_VAULT_EIP712_VERSION ?? '1',
    chainId: CHAIN_ID,
    verifyingContract: vaultAddr,
  };
  const permitMessage = {
    owner: payer.address, spender: relayer.address, value: shares.toString(),
    nonce: permitNonce.toString(), deadline: deadline.toString(),
  };
  const permitSig = ethers.Signature.from(await payer.signTypedData(vaultDomain, PERMIT_TYPES, permitMessage));
  log(ethers.verifyTypedData(vaultDomain, PERMIT_TYPES, permitMessage, permitSig) === payer.address, 'payer Permit signature recovers to payer (vault EIP-2612 domain)');

  const payerUsdcBefore = await usdc.balanceOf(payer.address);
  console.log('… relayer submits vault.permit then vault.redeem (gasless for payer)');
  await (await vault.permit(payer.address, relayer.address, shares, deadline, permitSig.v, permitSig.r, permitSig.s)).wait();
  const previewedAssets = await vault.convertToAssets(shares);
  const xtx = await vault.redeem(shares, payer.address, payer.address, { gasLimit: 600000n });
  const xrcpt = await xtx.wait();
  log(xrcpt.status === 1, `redeem mined ok (tx ${xtx.hash})`);

  const gained = (await usdc.balanceOf(payer.address)) - payerUsdcBefore;
  const nearRedeem = gained >= previewedAssets - 2n && gained <= previewedAssets + 2n;
  log(nearRedeem, `payer USDC increased by ${gained} ≈ redeemed assets ${previewedAssets}`);
  log((await vault.balanceOf(payer.address)) <= 2n, 'payer vault share balance returned to ~0');

  console.log(process.exitCode ? '\nVAULT E2E FAILED' : '\nVAULT E2E PASSED ✅');
  if (process.exitCode) process.exit(1);
}

main().catch((e) => { console.error('vault e2e error:', e.shortMessage ?? e.message ?? e); process.exit(1); });
