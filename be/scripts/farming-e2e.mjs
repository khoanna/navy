// Live farming proof against Compound III (Comet) on Sepolia — mirrors CompoundYieldAdapter.
//
// Provisions a fresh subwallet, funds it with Circle USDC (from the owner) + a little Sepolia ETH
// for gas, then: approve(Comet) -> supply(USDC) -> read balanceOf (position) -> withdrawTo(owner).
// Asserts the position appears and the owner is repaid. Standalone (no backend/DB needed).
//
// Run (from be/):  node scripts/farming-e2e.mjs
// Needs in be/.env: SEPOLIA_RPC_URL, NAVY_USDC_ADDRESS (Circle), NAVY_OWNER_PRIVATE_KEY.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ethers } from 'ethers';

const beRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const be = Object.fromEntries(readFileSync(join(beRoot, '.env'), 'utf8').split('\n')
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const req = (k) => { if (!be[k]) throw new Error(`Missing env ${k}`); return be[k]; };

const COMET = '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'; // Compound v3 USDC market, Sepolia
const AMOUNT = BigInt(process.env.FARM_AMOUNT_BASE ?? '500000'); // 0.5 USDC
const GAS_FLOAT = ethers.parseEther('0.004'); // subwallet ETH float for its own txs

const USDC_ABI = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)'];
const COMET_ABI = ['function supply(address asset, uint256 amount)', 'function withdraw(address asset, uint256 amount)', 'function withdrawTo(address to, address asset, uint256 amount)', 'function balanceOf(address) view returns (uint256)'];

function log(ok, msg) { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) process.exitCode = 1; }

async function main() {
  const provider = new ethers.JsonRpcProvider(req('SEPOLIA_RPC_URL'), parseInt(be.EVM_CHAIN_ID ?? '11155111', 10));
  const owner = new ethers.Wallet(req('NAVY_OWNER_PRIVATE_KEY'), provider);
  const usdcAddr = ethers.getAddress(req('NAVY_USDC_ADDRESS'));
  const subwallet = ethers.Wallet.createRandom().connect(provider); // Navy-generated farming subwallet

  const usdc = new ethers.Contract(usdcAddr, USDC_ABI, provider);
  const comet = new ethers.Contract(COMET, COMET_ABI, provider);
  console.log(`Comet=${COMET}  usdc=${usdcAddr}\nowner=${owner.address}  subwallet=${subwallet.address}`);

  // Fund the subwallet: Circle USDC (from owner) + ETH gas float (subwallet is msg.sender for Comet).
  console.log('… funding subwallet (USDC + ETH gas float)');
  await (await usdc.connect(owner).transfer(subwallet.address, AMOUNT)).wait();
  await (await owner.sendTransaction({ to: subwallet.address, value: GAS_FLOAT })).wait();
  log((await usdc.balanceOf(subwallet.address)) >= AMOUNT, `subwallet funded with ${AMOUNT} USDC`);

  // Deposit: approve + supply (buildDeposit).
  console.log('… deposit: approve + Comet.supply');
  await (await usdc.connect(subwallet).approve(COMET, AMOUNT)).wait();
  await (await comet.connect(subwallet).supply(usdcAddr, AMOUNT)).wait();

  // Position (getPosition).
  const pos = await comet.balanceOf(subwallet.address);
  console.log(`   position (Comet.balanceOf) = ${pos}`);
  log(pos >= AMOUNT - 2n, `position reflects the supply (~${AMOUNT})`);

  // Withdraw all to owner (buildWithdraw 'all' = withdrawTo(owner, USDC, balanceOf)).
  // NOTE: some public RPCs' eth_estimateGas spuriously reverts for Comet withdraw (the call + real
  // execution succeed), so pass an explicit gasLimit rather than relying on estimation.
  const ownerBefore = await usdc.balanceOf(owner.address);
  console.log(`… withdraw all (${pos}) to owner: Comet.withdrawTo`);
  const wtx = await comet.connect(subwallet).withdrawTo(owner.address, usdcAddr, pos, { gasLimit: 400000n });
  await wtx.wait();
  console.log('   withdraw tx', wtx.hash);
  const gained = (await usdc.balanceOf(owner.address)) - ownerBefore;
  log(gained >= AMOUNT - 2n, `owner repaid ${gained} (~${AMOUNT})`);
  log((await comet.balanceOf(subwallet.address)) <= 2n, 'subwallet position closed');

  console.log(process.exitCode ? '\nFARMING E2E FAILED' : '\nFARMING E2E PASSED ✅');
}

main().catch((e) => { console.error('farming e2e error:', e.shortMessage ?? e.message ?? e); process.exit(1); });
