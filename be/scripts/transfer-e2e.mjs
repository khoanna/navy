// be/scripts/transfer-e2e.mjs  (run: node be/scripts/transfer-e2e.mjs)
import 'dotenv/config';
import { ethers } from 'ethers';

const RPC = process.env.SEPOLIA_RPC_URL;
const USDC = process.env.NAVY_USDC_ADDRESS;
const relayerPk = process.env.NAVY_RELAYER_PRIVATE_KEY;
const senderPk = process.env.E2E_SENDER_PK;
const recipient = process.env.E2E_RECIPIENT_ADDR;
const name = process.env.NAVY_USDC_EIP712_NAME ?? 'USDC';
const version = process.env.NAVY_USDC_EIP712_VERSION ?? '2';
const chainId = Number(process.env.EVM_CHAIN_ID ?? 11155111);

const abi = [
  'function balanceOf(address) view returns (uint256)',
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
];

const provider = new ethers.JsonRpcProvider(RPC, chainId);
const relayer = new ethers.Wallet(relayerPk, provider);
const sender = new ethers.Wallet(senderPk, provider);
const usdc = new ethers.Contract(USDC, abi, relayer);

const value = 10_000n; // 0.01 USDC
const nonce = ethers.hexlify(ethers.randomBytes(32));
const validBefore = Math.floor(Date.now() / 1000) + 900;
const domain = { name, version, chainId, verifyingContract: USDC };
const types = { TransferWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] };
const message = { from: sender.address, to: recipient, value: value.toString(), validAfter: '0', validBefore: String(validBefore), nonce };

const before = await usdc.balanceOf(recipient);
const sig = ethers.Signature.from(await sender.signTypedData(domain, types, message));
const tx = await usdc.transferWithAuthorization(sender.address, recipient, value, 0, validBefore, nonce, sig.v, sig.r, sig.s);
console.log('submitted', tx.hash);
const receipt = await tx.wait();
const after = await usdc.balanceOf(recipient);
if (receipt.status !== 1) throw new Error('transfer reverted');
if (after - before !== value) throw new Error(`balance delta ${after - before} != ${value}`);
console.log('OK gasless transfer confirmed; recipient +0.01 USDC');
