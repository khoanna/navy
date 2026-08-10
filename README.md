# Navy Payment Ecosystem

[![Network: Ethereum Sepolia](https://img.shields.io/badge/Network-Ethereum_Sepolia-blue.svg)](https://sepolia.etherscan.io/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-brightgreen.svg)](https://soliditylang.org/)
[![Foundry](https://img.shields.io/badge/Foundry-Testing_%26_Deployment-orange.svg)](https://getfoundry.sh/)
[![NestJS](https://img.shields.io/badge/NestJS-11-red.svg)](https://nestjs.com/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![Expo](https://img.shields.io/badge/Expo-54-4630EB.svg)](https://expo.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748.svg)](https://www.prisma.io/)
[![License: UNLICENSED](https://img.shields.io/badge/License-UNLICENSED-lightgrey.svg)](#)

**Navy** is an end-to-end **Ethereum Sepolia (EVM)** payment ecosystem comprising a gasless payment gateway, an automated ERC-4626 yield-farming vault, a merchant/admin Web management portal, and a self-custodial mobile wallet featuring an AI assistant.

Designed for frictionless web3 payments, Navy allows end-users to pay invoices, transfer USDC, and farm yield **without holding ETH for gas fees**. Gas costs are abstracted away through EIP-3009 / EIP-2612 signatures relayed on-chain by Navy’s automated backend relayers.

---

## 🏛️ Ecosystem Architecture

Navy is structured as four independent, focused applications within a single monorepo:

```
                  ┌───────────────────────────────────────────────────┐
                  │                 Navy Ecosystem                    │
                  └─────────────────────────┬─────────────────────────┘
                                            │
         ┌──────────────────┬───────────────┴───────────────┬──────────────────┐
         │                  │                               │                  │
┌────────▼─────────┐┌───────▼──────────┐         ┌──────────▼─────────┐┌───────▼──────────┐
│    contract/     ││       be/        │         │        fe/         ││   expo-wallet/   │
│ (Foundry/Solidity)││ (NestJS / Prisma)│         │(Next.js App Router)││ (Expo/React Native)│
└────────┬─────────┘└───────┬──────────┘         └──────────┬─────────┘└───────┬──────────┘
         │                  │                               │                  │
         │ Smart Contracts  │ Backend API, Relayer,         │ Admin & Merchant │ Mobile Wallet for
         │ Payments & Vault │ AI Agent, Settlement & Keeper │ Web Dashboard    │ End-User Payers
```

### Subsystems Breakdown

| Directory | Stack | Core Role |
| :--- | :--- | :--- |
| **`contract/`** | Foundry, Solidity `0.8.24` | On-chain contracts: `NavyPayments.sol` (gasless payments) and `NavyVaultSRCLA.sol` (pooled ERC-4626 yield vault with yield adapters). |
| **`be/`** | NestJS 11, Prisma 7 (Postgres), `ethers` v6 | Core API, Privy & JWT auth, gasless EIP-712 relayers, `ChainWatcherService` settlement, rebalancing keeper cron, OpenRouter AI assistant server. |
| **`fe/`** | Next.js 16 (App Router), React 19, Three.js, GSAP | Web application for **Admins** (approvals, metrics) and **Merchants** (catalog, invoices, payout wallet configuration, Webhook settings). |
| **`expo-wallet/`** | Expo 54, React Native, `@privy-io/expo` | Mobile wallet for end-user payers: passkey/social onboarding, scan-to-pay QR, EIP-3009/2612 signing, vault position management, streaming AI assistant. |

---

## ✨ Key Features & Capabilities

### 1. Gasless EIP-712 / EIP-3009 Invoicing & Payments
- **Zero-Gas Payer Experience:** Users sign Circle USDC’s native `ReceiveWithAuthorization` (EIP-3009) off-chain. Navy's backend relayer submits `payInvoice(...)` to `NavyPayments.sol` and covers the gas fee.
- **Pay-Once Security Guarantee:** Invoice key `keccak256(abi.encodePacked(merchantId, invoiceId))` serves as the on-chain replay guard and EIP-3009 nonce. Any mismatch in payer, merchant, invoice ID, or amount reverts at the contract level.
- **Automated Payout & Fee Split:** Executes an instant on-chain split: **99%** directly to the merchant’s payout wallet and **1%** to the Navy protocol treasury.
- **Self-Healing Settlement:** `ChainWatcherService` listens for on-chain `InvoicePaid` events, verifies logs, updates invoice statuses to `paid`, and dispatches cryptographically signed HMAC webhooks to merchant endpoints.

### 2. Auto-Rebalancing Yield Vault (`NavyVaultSRCLA`)
- **Pooled ERC-4626 Vault:** Users deposit USDC to mint `navUSDC` shares. Deposits utilize gasless EIP-3009 authorizations, and redemptions utilize EIP-2612 share permits.
- **Multi-Venue Yield Optimization:** An automated keeper cron evaluates live yield opportunities across allowlisted protocols (e.g., **Compound III**) using a framework-free strategy considering target weights, drift bands, gas break-evens, and idle buffers.
- **On-Chain Risk Safety:** Reallocations are constrained by contract-level risk guards (`capBps`, `minIdleBps`, `maxLossBps`). The keeper can only shift capital between verified yield adapters, never to an arbitrary address.

### 3. In-Wallet Streaming AI Assistant
- **Read & Propose Design:** Driven by OpenRouter models (default: `google/gemini-2.5-flash`), the assistant analyzes portfolios, spending patterns, and market metrics via SSE streaming.
- **Non-Custodial Action Proposals:** The agent can build payment or vault transaction proposals but **never executes on-chain actions directly**. The user explicitly inspects, confirms, and signs proposals inside the app.

### 4. Gasless Peer-to-Peer Transfers
- End-users can send USDC directly to other wallet addresses using EIP-3009 `transferWithAuthorization` without needing ETH for gas.

### 5. Unified Authentication System
- Single role-aware JWT authentication system issuing short-lived sessions (`user`, `merchant`, `admin` roles).
- Multiple authentication entry points: **Privy** for end-user wallets, **Email/Password** for merchants, and **Password + TOTP 2FA** for administrators.

---

## 📍 Deployed Contracts (Ethereum Sepolia)

| Contract | Address | Description |
| :--- | :--- | :--- |
| **`NavyPayments`** | [`0xb135C49Ef6c0505F7fB55932F31A9E93eba6e907`](https://sepolia.etherscan.io/address/0xb135C49Ef6c0505F7fB55932F31A9E93eba6e907) | Gasless invoice settlement & fee splitter |
| **`NavyVaultSRCLA`** | [`0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE`](https://sepolia.etherscan.io/address/0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE) | ERC-4626 auto-rebalancing yield vault |
| **`CompoundAdapter`** | [`0x24d4173e6b9734a52c20190a9c5681ef350D8fE2`](https://sepolia.etherscan.io/address/0x24d4173e6b9734a52c20190a9c5681ef350D8fE2) | Yield adapter connected to Compound III Comet |
| **Circle USDC (Sepolia)** | [`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) | Native Circle USDC (EIP-3009 + EIP-2612) |

---

## 🛠️ Prerequisites & Setup

### Requirements
- **Node.js**: `v20.x` or later
- **Package Manager**: `pnpm 10+`
- **Database**: PostgreSQL 15+ (or Docker)
- **Smart Contract Toolkit**: [Foundry](https://getfoundry.sh/) (`forge`, `cast`)
- **Mobile Development**: Expo CLI & React Native tooling (Xcode / Android Studio for emulators)

---

## 🚀 Quick Start Guide

### 1. Repository Setup

```bash
git clone git@github.com:khoanna/navy.git
cd navy
```

### 2. Backend Setup (`be/`)

```bash
cd be

# Install dependencies
pnpm install

# Start PostgreSQL database (if using Docker)
docker compose up -d

# Run Prisma migrations & seed initial admin/merchant
pnpm prisma migrate dev
pnpm seed

# Start development server (Port 3000)
pnpm start:dev
```

### 3. Frontend Web Setup (`fe/`)

```bash
cd fe

# Install dependencies
pnpm install

# Start Next.js development server (Port 3001)
pnpm dev
```

### 4. Mobile Wallet Setup (`expo-wallet/`)

```bash
cd expo-wallet

# Install dependencies
pnpm install

# Start Expo dev server
pnpm start
```

### 5. Smart Contracts Setup (`contract/`)

```bash
cd contract

# Build contracts
forge build

# Run unit, fuzz, and Sepolia fork tests
forge test
```

---

## 🧪 Testing & Verification

Each application maintains focused, isolated test suites:

```bash
# Backend unit & integration tests
cd be && pnpm test

# Backend E2E tests (requires PostgreSQL)
cd be && pnpm test:e2e

# Run Live Sepolia Vault Proof (Deposit → Rebalance → Redeem)
cd be && NAVY_VAULT_E2E=1 NAVY_VAULT_E2E_PAYER_KEY=<KEY> node scripts/vault-e2e.mjs

# Frontend logic unit tests & typecheck
cd fe && pnpm test && pnpm exec tsc --noEmit

# Mobile wallet unit tests & typecheck
cd expo-wallet && pnpm test && pnpm exec tsc --noEmit

# Smart contract unit, fuzzing & fork tests
cd contract && forge test --summary
```

---

## 🔑 Key Environment Variables

Each application consumes configuration via local environment files (`.env`). Refer to the table below for required keys:

| Component | Key | Purpose |
| :--- | :--- | :--- |
| **`be`** | `DATABASE_URL` | PostgreSQL connection string |
| **`be`** | `SEPOLIA_RPC_URL` | Sepolia Ethereum RPC provider URL |
| **`be`** | `NAVY_PAYMENTS_ADDRESS` | Address of deployed `NavyPayments.sol` |
| **`be`** | `NAVY_VAULT_ADDRESS` | Address of deployed `NavyVaultSRCLA.sol` |
| **`be`** | `NAVY_RELAYER_PRIVATE_KEY` | Private key for payment/transfer relayer |
| **`be`** | `NAVY_KEEPER_PRIVATE_KEY` | Private key for vault rebalancing keeper |
| **`be`** | `OPENROUTER_API_KEY` | OpenRouter key powering the AI assistant |
| **`be`** | `CLOUDINARY_*` | Cloudinary API credentials for product image storage |
| **`fe`** | `NEXT_PUBLIC_API_URL` | Navy Backend API endpoint |
| **`expo-wallet`** | `EXPO_PUBLIC_PRIVY_APP_ID` | Privy App ID for mobile authentication |
| **`contract`** | `ETHERSCAN_API_KEY` | Etherscan key for contract verification |

---

## 🔒 Security & Audit

- **Vault Audit:** The `NavyVaultSRCLA` smart contracts underwent a formal security audit (`contract/audit/NavyVault-security-audit-2026-07-28.md`). All findings, including adapter isolation, zero-share protection, 2-step ownership transfers, and reentrancy guards, have been addressed.
- **EIP-7702 Notice:** Circle USDC EIP-3009 requires valid ECDSA signatures from plain EOAs (`getCode == 0x`). Signers delegated via EIP-7702 smart accounts must use standard EIP-1271 verification.

---

## 📄 License

This repository is private and proprietary. All rights reserved.
