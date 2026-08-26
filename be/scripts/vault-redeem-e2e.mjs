/**
 * vault-redeem-e2e.mjs — End-to-end integration test of the vault gasless redeem flow.
 *
 * Exercises the full HTTP flow: buildRedeemPermit → client signs → submitRedeem
 * against an Anvil fork of Base Mainnet. The deposit script should be run first
 * to fund the test wallet with navUSDC shares.
 *
 * Prerequisites (same as vault-deposit-e2e.mjs):
 *   - Anvil fork running on http://127.0.0.1:8545
 *   - `source ../srcla/.env.anvil`
 *   - Backend server with evm.module pointing to the Anvil fork
 *   - `npx prisma migrate deploy` run against navypayments DB
 *
 * Usage (from be/):
 *   source ../srcla/.env.anvil
 *   # First fund the test wallet with USDC and get navUSDC shares:
 *   node scripts/vault-deposit-e2e.mjs
 *   # Then run the redeem test:
 *   NAVY_VAULT_REDEEM_E2E=1 node scripts/vault-redeem-e2e.mjs
 *
 * The script also works standalone (no backend):
 *   NAVY_VAULT_REDEEM_E2E=standalone node scripts/vault-redeem-e2e.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ethers } from 'ethers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const beRoot = join(__dirname, '..');

// Load env
function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch { /* optional */ }
}
loadEnv(join(beRoot, '.env'));

// Gate
const mode = process.env.NAVY_VAULT_REDEEM_E2E ?? '';
if (!mode) {
  console.log('NAVY_VAULT_REDEEM_E2E unset — skipping. Set to "http" or "standalone".');
  process.exit(0);
}

const req = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing env var: ${k}`); return v; };
const CHAIN_ID = parseInt(process.env.CHAIN_ID ?? process.env.EVM_CHAIN_ID ?? '8453', 10);
const RPC_URL = req('BASE_RPC_URL');
const VAULT_ADDRESS = req('VAULT_ADDRESS');
const USDC_ADDRESS = req('USDC_ADDRESS');

// EIP-2612 Permit types (same as service)
const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

function log(ok, msg) {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);

  // Relayer wallet
  const relayerKey = req('NAVY_RELAYER_PRIVATE_KEY');
  const relayer = new ethers.Wallet(relayerKey, provider);

  // Test wallet: restore from a saved key file or generate fresh
  // For repeatability, use a deterministic test wallet derived from the deploy key
  const testPrivateKey = process.env.VAULT_E2E_TEST_WALLET_KEY ?? (() => {
    // Derive a deterministic wallet for the E2E test
    const wallet = ethers.Wallet.createRandom();
    console.log(`Generated new test wallet: ${wallet.address}`);
    console.log(`  Export with: VAULT_E2E_TEST_WALLET_KEY=${wallet.privateKey}`);
    return wallet.privateKey;
  })();
  const testWallet = new ethers.Wallet(testPrivateKey, provider);
  console.log(`Test wallet: ${testWallet.address}`);

  // Contracts
  const VAULT_ABI = JSON.parse(readFileSync(join(beRoot, 'src/evm/navy-vault-abi.json'), 'utf8'));
  const USDC_ABI = JSON.parse(readFileSync(join(beRoot, 'src/evm/usdc-abi.json'), 'utf8')).abi;

  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, relayer);

  // Fund test wallet with ETH if needed
  const ethBalance = await provider.getBalance(testWallet.address);
  if (ethBalance === 0n) {
    console.log('\n[Setup] Funding test wallet with ETH...');
    const fundTx = await relayer.sendTransaction({ to: testWallet.address, value: ethers.parseEther('0.1') });
    await fundTx.wait();
  }
  log((await provider.getBalance(testWallet.address)) > 0n, 'test wallet has ETH for gas');

  // Check share balance — the deposit-e2e script should have minted shares
  const sharesBefore = await vault.balanceOf(testWallet.address);
  log(sharesBefore > 0n, `test wallet holds ${sharesBefore} navUSDC shares to redeem`);

  if (sharesBefore === 0n) {
    console.log('\nNo shares found — run vault-deposit-e2e.mjs first to deposit USDC and mint shares.');
    console.log('Skipping redeem test.');
    return;
  }

  // Determine how many shares to redeem
  const redeemingShares = sharesBefore; // redeem all

  // Check synchronous liquidity
  const maxRedeem = await vault.maxRedeem(testWallet.address);
  log(redeemingShares <= maxRedeem, `redeeming ${redeemingShares} shares within maxRedeem=${maxRedeem}`);

  // USDC balance before
  const usdcBalanceBefore = await usdc.balanceOf(testWallet.address);

  // ── Step 1: Build the redeem permit via HTTP endpoint ─────────────────────────
  let permitId: string;
  let typedData: any;
  let expiresAt: string;

  if (mode === 'http') {
    console.log('\n[HTTP] Calling POST /vault/redeem/permit...');
    const jwtToken = process.env.VAULT_E2E_JWT ?? req('VAULT_E2E_JWT');
    const backendUrl = process.env.VAULT_E2E_BACKEND_URL ?? 'http://localhost:3000';

    const res = await fetch(`${backendUrl}/vault/redeem/permit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({ sharesBase: redeemingShares.toString() }),
    });

    if (!res.ok) {
      const err = await res.text();
      log(false, `permit endpoint failed: ${res.status} ${err}`);
      console.log(process.exitCode ? '\nFAILED' : '\nPASSED');
      return;
    }

    const data = await res.json();
    permitId = data.id;
    typedData = data.typedData;
    expiresAt = data.expiresAt;
    log(true, `received permit id=${permitId}, expiresAt=${expiresAt}`);
    log(typedData.primaryType === 'Permit', 'typedData.primaryType is Permit');
    log(typedData.message.value === redeemingShares.toString(), 'typedData.message.value matches shares to redeem');
  } else {
    // Standalone: build typed data ourselves
    console.log('\n[Standalone] Building permit typed data locally...');
    const vaultDomain = {
      name: process.env.NAVY_VAULT_EIP712_NAME ?? 'Navy Vault USDC',
      version: process.env.NAVY_VAULT_EIP712_VERSION ?? '1',
      chainId: CHAIN_ID,
      verifyingContract: VAULT_ADDRESS,
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const deadline = nowSec + 3600;
    expiresAt = new Date(deadline * 1000).toISOString();

    // Read current permit nonce from the vault
    const nonce = await vault.nonces(testWallet.address);

    typedData = {
      domain: vaultDomain,
      types: PERMIT_TYPES,
      primaryType: 'Permit',
      message: {
        owner: testWallet.address,
        spender: relayer.address,
        value: redeemingShares.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
      },
    };
    permitId = crypto.randomUUID();
    log(true, `built permit typed data locally, id=${permitId}, nonce=${nonce}`);
  }

  // ── Step 2: Client wallet signs the EIP-2612 permit ───────────────────────────
  console.log('\n[Sign] Wallet signing EIP-2612 permit...');
  const signature = await testWallet.signTypedData(
    typedData.domain,
    typedData.types,
    typedData.message,
  );
  log(ethers.verifyTypedData(typedData.domain, typedData.types, typedData.message, signature) === testWallet.address,
    'permit signature recovers to test wallet address');

  // ── Step 3: Submit the redeem ─────────────────────────────────────────────────
  if (mode === 'http') {
    console.log('\n[HTTP] Calling POST /vault/redeem/submit...');
    const jwtToken = process.env.VAULT_E2E_JWT ?? req('VAULT_E2E_JWT');
    const backendUrl = process.env.VAULT_E2E_BACKEND_URL ?? 'http://localhost:3000';

    const res = await fetch(`${backendUrl}/vault/redeem/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({ id: permitId, signature }),
    });

    if (!res.ok) {
      const err = await res.text();
      log(false, `redeem submit endpoint failed: ${res.status} ${err}`);
    } else {
      const data = await res.json();
      log(true, `redeem submitted: txHash=${data.txHash}, status=${data.status}`);
      log(parseInt(data.assetsBase) > 0, `assets received: ${data.assetsBase}`);
    }
  } else {
    // Standalone: relay manually
    console.log('\n[Standalone] Relaying via Ethers.js directly...');

    const sig = ethers.Signature.from(signature);
    const deadlineSec = Math.floor(new Date(expiresAt).getTime() / 1000);

    // Step 3a: vault.permit (grants relayer allowance to transfer shares)
    console.log('  … relayer calls vault.permit');
    try {
      const permitTx = await vault.permit(
        testWallet.address,
        relayer.address,
        redeemingShares,
        deadlineSec,
        sig.v,
        sig.r,
        sig.s,
        { gasLimit: 200_000n },
      );
      const permitReceipt = await permitTx.wait();
      log(permitReceipt.status === 1, `vault.permit mined (tx ${permitTx.hash})`);
    } catch (e) {
      // permit might fail if the vault doesn't support it directly
      log(false, `vault.permit failed: ${e.shortMessage ?? e.message}`);
    }

    // Step 3b: vault.redeem(shares, receiver, owner)
    console.log(`  … relayer calls vault.redeem(${redeemingShares}, ${testWallet.address}, ${testWallet.address})`);
    const redeemTx = await vault.redeem(redeemingShares, testWallet.address, testWallet.address, { gasLimit: 600_000n });
    const redeemReceipt = await redeemTx.wait();
    log(redeemReceipt.status === 1, `vault.redeem mined (tx ${redeemTx.hash})`);
  }

  // ── Step 4: Verify USDC received ──────────────────────────────────────────────
  const usdcBalanceAfter = await usdc.balanceOf(testWallet.address);
  const gainedUsdc = usdcBalanceAfter - usdcBalanceBefore;
  log(gainedUsdc > 0n, `USDC balance increased by ${gainedUsdc} after redeem`);

  // Verify shares burned
  const sharesAfter = await vault.balanceOf(testWallet.address);
  const burnedShares = sharesBefore - sharesAfter;
  log(burnedShares > 0n, `navUSDC shares burned: ${burnedShares}`);

  console.log(process.exitCode ? '\nFAILED ❌' : '\nPASSED ✅');
  if (process.exitCode) process.exit(1);
}

main().catch((e) => {
  console.error('vault-redeem-e2e error:', e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
