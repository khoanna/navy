// be/scripts/eth-send-e2e.mjs  (run: node scripts/eth-send-e2e.mjs)
//
// Live-Sepolia proof that a native ETH send confirms on-chain. Requires a funded
// sender key (E2E_SENDER_PK) with a little Sepolia ETH and a recipient (E2E_RECIPIENT_ADDR).
// The /transfer/eth/record endpoint + watcher reconciliation are exercised in the
// full e2e (D2) against the running API; this script proves the on-chain leg.
import 'dotenv/config';
import { ethers } from 'ethers';

const RPC = process.env.BASE_RPC_URL;
const senderPk = process.env.E2E_SENDER_PK;
const recipient = process.env.E2E_RECIPIENT_ADDR;
const chainId = Number(process.env.EVM_CHAIN_ID ?? 8453);

if (!senderPk || !recipient) {
  console.error('Set E2E_SENDER_PK (funded) and E2E_RECIPIENT_ADDR, then re-run.');
  process.exit(2);
}

const provider = new ethers.JsonRpcProvider(RPC, chainId);
const sender = new ethers.Wallet(senderPk, provider);
const value = 100000000000000n; // 0.0001 ETH

const before = await provider.getBalance(recipient);
const tx = await sender.sendTransaction({ to: recipient, value });
console.log('submitted', tx.hash);
const receipt = await tx.wait();
const after = await provider.getBalance(recipient);
if (receipt.status !== 1) throw new Error('eth send reverted');
if (after - before !== value) throw new Error(`balance delta ${after - before} != ${value}`);
console.log('OK native ETH send confirmed; recipient +0.0001 ETH; txHash', tx.hash);
