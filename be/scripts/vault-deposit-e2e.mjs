/**
 * vault-deposit-e2e.mjs — End-to-end integration test of the vault gasless deposit flow.
 *
 * Exercises the full HTTP flow: buildDepositAuthorization → client signs → submitDeposit
 * against an Anvil fork of Base Mainnet.
 *
 * Prerequisites:
 *   - Anvil fork running on http://127.0.0.1:8545
 *   - `source ../srcla/.env.anvil` (provides VAULT_ADDRESS, USDC_ADDRESS, BASE_RPC_URL)
 *   - Backend server running with evm.module pointing to the Anvil fork
 *   - `npx prisma migrate deploy` run against the navypayments DB
 *   - Relayer and keeper funded with ETH on the fork
 *
 * Usage (from be/):
 *   source ../srcla/.env.anvil
 *   NAVY_VAULT_DEPOSIT_E2E=1 node scripts/vault-deposit-e2e.mjs
 *
 * The script also works standalone (no backend) when NAVY_VAULT_DEPOSIT_E2E=standalone:
 *   NAVY_VAULT_DEPOSIT_E2E=standalone node scripts/vault-deposit-e2e.mjs
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
const mode = process.env.NAVY_VAULT_DEPOSIT_E2E ?? '';
if (!mode) {
  console.log('NAVY_VAULT_DEPOSIT_E2E unset — skipping. Set to "http" or "standalone".');
  process.exit(0);
}

const req = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing env var: ${k}`); return v; };
const CHAIN_ID = parseInt(process.env.CHAIN_ID ?? process.env.EVM_CHAIN_ID ?? '8453', 10);
const RPC_URL = req('BASE_RPC_URL');
const VAULT_ADDRESS = req('VAULT_ADDRESS');
const USDC_ADDRESS = req('USDC_ADDRESS');

// Amounts
const MINT_AMOUNT = BigInt(process.env.VAULT_DEPOSIT_E2E_MINT ?? '100000000'); // 100 USDC to mint
const DEPOSIT_AMOUNT = BigInt(process.env.VAULT_DEPOSIT_E2E_AMOUNT ?? '50000000'); // 50 USDC to deposit

// Vault EIP-3009 RWA types (same as service)
const RWA_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

function log(ok, msg) {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);

  // Generate a fresh test wallet
  const testWallet = ethers.Wallet.createRandom().connect(provider);
  console.log(`Test wallet: ${testWallet.address}`);

  // Relayer wallet (from env)
  const relayerKey = req('NAVY_RELAYER_PRIVATE_KEY');
  const relayer = new ethers.Wallet(relayerKey, provider);

  // Contracts
  const VAULT_ABI = JSON.parse(readFileSync(join(beRoot, 'src/evm/navy-vault-abi.json'), 'utf8'));
  const USDC_ABI = JSON.parse(readFileSync(join(beRoot, 'src/evm/usdc-abi.json'), 'utf8')).abi;

  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, relayer);

  // Fund test wallet with ETH
  console.log('\n[Setup] Funding test wallet with ETH...');
  const fundTx = await relayer.sendTransaction({ to: testWallet.address, value: ethers.parseEther('0.1') });
  await fundTx.wait();
  log((await provider.getBalance(testWallet.address)) > 0n, 'test wallet funded with ETH');

  // Mint USDC to test wallet (impersonate a large holder)
  console.log('\n[Setup] Impersonating USDC whale to mint to test wallet...');
  // On Anvil: use `anvil_impersonateAccount` + `anvil_setBalance` via `debug_` RPC
  // Fallback: use the admin wallet to mint directly if USDC has a mint function
  const adminKey = process.env.NAVY_OWNER_PRIVATE_KEY ?? relayerKey;
  const admin = new ethers.Wallet(adminKey, provider);

  try {
    // Try calling mint on USDC (some test USDC implementations have mint)
    const mintFn = usdc.interface.getFunction('mint');
    if (mintFn) {
      const mintTx = await usdc.connect(admin).mint(testWallet.address, MINT_AMOUNT);
      await mintTx.wait();
      log(true, `minted ${MINT_AMOUNT} USDC to test wallet`);
    } else {
      // Transfer from a whale address instead
      const whale = '0x55E728b08FdB9432520FB3fd1b9D7777320f8ED3'; // some known holder
      try {
        const whaleBalance = await usdc.balanceOf(whale);
        if (whaleBalance >= MINT_AMOUNT) {
          // Impersonate the whale
          await provider.send('anvil_impersonateAccount', [whale]);
          const whaleSigner = new ethers.Wallet(ethers.ZeroHash.slice(2), provider); // dummy key, impersonated
          const impersonatedUsdc = usdc.connect(whaleSigner);
          const transferTx = await impersonatedUsdc.transfer(testWallet.address, MINT_AMOUNT);
          await transferTx.wait();
          await provider.send('anvil_stopImpersonatingAccount', [whale]);
          log(true, `transferred ${MINT_AMOUNT} USDC from whale to test wallet`);
        } else {
          log(false, 'whale balance too low for mint amount');
        }
      } catch {
        log(false, 'could not impersonate USDC whale — need Anvil fork with funded whale');
      }
    }
  } catch (e) {
    log(false, `USDC mint/transfer failed: ${e.shortMessage ?? e.message}`);
  }

  // Verify USDC balance
  const usdcBalance = await usdc.balanceOf(testWallet.address);
  log(usdcBalance >= DEPOSIT_AMOUNT, `test wallet USDC balance >= ${DEPOSIT_AMOUNT} (actual: ${usdcBalance})`);

  if (usdcBalance < DEPOSIT_AMOUNT) {
    console.log('\n[Standalone] Proceeding with actual balance for demonstration...');
  }

  // ── Step 1: Build the deposit authorization via HTTP endpoint ──────────────────
  let authId: string;
  let typedData: any;
  let expiresAt: string;

  if (mode === 'http') {
    console.log('\n[HTTP] Calling POST /vault/deposit/authorization...');
    const jwtToken = process.env.VAULT_E2E_JWT ?? req('VAULT_E2E_JWT');
    const backendUrl = process.env.VAULT_E2E_BACKEND_URL ?? 'http://localhost:3000';

    const res = await fetch(`${backendUrl}/vault/deposit/authorization`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({ amountBase: DEPOSIT_AMOUNT.toString() }),
    });

    if (!res.ok) {
      const err = await res.text();
      log(false, `authorization endpoint failed: ${res.status} ${err}`);
      console.log(process.exitCode ? '\nFAILED' : '\nPASSED');
      return;
    }

    const data = await res.json();
    authId = data.id;
    typedData = data.typedData;
    expiresAt = data.expiresAt;
    log(true, `received authorization id=${authId}, expiresAt=${expiresAt}`);
    log(typedData.primaryType === 'ReceiveWithAuthorization', 'typedData.primaryType is ReceiveWithAuthorization');
    log(typedData.message.value === DEPOSIT_AMOUNT.toString(), `typedData.message.value === ${DEPOSIT_AMOUNT}`);
  } else {
    // Standalone: build typed data ourselves
    console.log('\n[Standalone] Building typed data locally...');
    const usdcDomain = {
      name: process.env.NAVY_USDC_EIP712_NAME ?? 'USD Coin',
      version: process.env.NAVY_USDC_EIP712_VERSION ?? '2',
      chainId: CHAIN_ID,
      verifyingContract: USDC_ADDRESS,
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const validBefore = nowSec + 3600;
    expiresAt = new Date(validBefore * 1000).toISOString();

    // Generate unique nonce: keccak256(vault || wallet || amount || id)
    const id = crypto.randomUUID();
    const idHex = Buffer.from(id.replace(/-/g, ''), 'hex');
    const nonceDigest = ethers.solidityPackedKeccak256(
      ['address', 'address', 'uint256', 'bytes16'],
      [VAULT_ADDRESS, testWallet.address, DEPOSIT_AMOUNT, idHex],
    );

    typedData = {
      domain: usdcDomain,
      types: RWA_TYPES,
      primaryType: 'ReceiveWithAuthorization',
      message: {
        from: testWallet.address,
        to: VAULT_ADDRESS,
        value: DEPOSIT_AMOUNT.toString(),
        validAfter: nowSec.toString(),
        validBefore: validBefore.toString(),
        nonce: nonceDigest,
      },
    };
    authId = id;
    log(true, `built typed data locally, id=${authId}`);
  }

  // ── Step 2: Client wallet signs the typed data ────────────────────────────────
  console.log('\n[Sign] Wallet signing EIP-3009 typed data...');
  const signature = await testWallet.signTypedData(
    typedData.domain,
    typedData.types,
    typedData.message,
  );
  log(ethers.verifyTypedData(typedData.domain, typedData.types, typedData.message, signature) === testWallet.address,
    'signature recovers to test wallet address');

  // ── Step 3: Submit the deposit ────────────────────────────────────────────────
  const sharesBefore = await vault.balanceOf(testWallet.address);

  if (mode === 'http') {
    console.log('\n[HTTP] Calling POST /vault/deposit/submit...');
    const jwtToken = process.env.VAULT_E2E_JWT ?? req('VAULT_E2E_JWT');
    const backendUrl = process.env.VAULT_E2E_BACKEND_URL ?? 'http://localhost:3000';

    const res = await fetch(`${backendUrl}/vault/deposit/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({ id: authId, signature }),
    });

    if (!res.ok) {
      const err = await res.text();
      log(false, `submit endpoint failed: ${res.status} ${err}`);
    } else {
      const data = await res.json();
      log(true, `deposit submitted: txHash=${data.txHash}, status=${data.status}`);
      log(parseInt(data.sharesBase) > 0, `shares minted: ${data.sharesBase}`);
    }
  } else {
    // Standalone: relay manually
    console.log('\n[Standalone] Relaying via Ethers.js directly...');

    const sig = ethers.Signature.from(signature);
    const validBeforeSec = Math.floor(new Date(expiresAt).getTime() / 1000);

    // Step 3a: USDC.receiveWithAuthorization (pull USDC from wallet → vault)
    console.log('  … relayer calls USDC.receiveWithAuthorization');
    const rwaTx = await usdc.connect(relayer).receiveWithAuthorization(
      testWallet.address,
      VAULT_ADDRESS,
      DEPOSIT_AMOUNT,
      0,
      validBeforeSec,
      typedData.message.nonce,
      sig.v,
      sig.r,
      sig.s,
      { gasLimit: 300_000n },
    );
    const rwaReceipt = await rwaTx.wait();
    log(rwaReceipt.status === 1, `USDC.receiveWithAuthorization mined (tx ${rwaTx.hash})`);

    // Step 3b: vault.deposit(assets, wallet)
    console.log('  … relayer calls vault.deposit');
    const depositTx = await vault.deposit(DEPOSIT_AMOUNT, testWallet.address, { gasLimit: 500_000n });
    const depositReceipt = await depositTx.wait();
    log(depositReceipt.status === 1, `vault.deposit mined (tx ${depositTx.hash})`);
  }

  // ── Step 4: Verify shares minted ──────────────────────────────────────────────
  const sharesAfter = await vault.balanceOf(testWallet.address);
  const mintedShares = sharesAfter - sharesBefore;
  log(mintedShares > 0n, `vault.balanceOf(wallet) increased by ${mintedShares} shares`);

  if (mintedShares > 0n) {
    const assetsForShares = await vault.convertToAssets(mintedShares);
    const nearDeposit = assetsForShares >= DEPOSIT_AMOUNT - 2n && assetsForShares <= DEPOSIT_AMOUNT + 2n;
    log(nearDeposit, `convertToAssets(${mintedShares}) = ${assetsForShares} ≈ ${DEPOSIT_AMOUNT}`);
  }

  console.log(process.exitCode ? '\nFAILED ❌' : '\nPASSED ✅');
  if (process.exitCode) process.exit(1);
}

main().catch((e) => {
  console.error('vault-deposit-e2e error:', e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
