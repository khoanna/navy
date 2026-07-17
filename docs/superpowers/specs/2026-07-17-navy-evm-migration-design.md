# Navy — EVM Migration (Solana → Ethereum Sepolia) Design Spec

**Date:** 2026-07-17
**Status:** Approved (design)
**Sub-project:** Cross-cutting migration — replaces the on-chain layer of sub-projects 2 (payments program), 3 (payment gateway), and 5 (farming agent)

---

## 0. Context

Navy is a Solana (devnet) payment ecosystem: a payment gateway + wallets across four apps (`be/`, `fe/`, `web-wallet/`, `onchain/`). Today all on-chain logic lives in the Anchor program `navy_payments` (Config/Merchant/lazy-Invoice PDAs, `pay_invoice` with a 99/1 USDC `transfer_checked` split, two-signer gasless relay, `InvoicePaid` event), and farming deposits **native SOL** into Save/Solend behind a `YieldAdapter`.

This migration **removes Solana entirely** and re-homes all on-chain logic on **Ethereum Sepolia**, using **EIP-712** for the payment authorization. The mechanism is a near-direct translation of today's design: a user scans a QR, their wallet shows a **typed invoice** (merchant, USDC amount, invoice id, expiry), and pays in **USDC**, **gasless** (Navy relays the gas). Each invoice is **payable exactly once** (on-chain replay protection), and Navy takes a **configurable fee (default 1%) to a treasury**, enforced on-chain.

The original spec already called the Solana flow an "EIP-712-style invoice payment translated to Solana." This migration makes it literal: the user signs a real EIP-712 typed message, and Circle's USDC (which natively implements **EIP-3009**) verifies it on-chain.

### Decisions locked during brainstorming
- **Authorization model = user authorizes, backend relays.** The user signs USDC's EIP-712 `ReceiveWithAuthorization` (EIP-3009); the backend **relayer** submits the transaction on-chain and pays gas. This is the exact mirror of today's two-signer gasless flow (user authorizes the debit, relayer pays the fee), now as EIP-712 + a contract call instead of a co-signed Solana tx.
- **Target chain = Ethereum Sepolia.** Circle-issued USDC at `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (`FiatTokenV2_2`, implements EIP-3009 `receiveWithAuthorization`). This is the devnet replacement.
- **Contracts = Foundry**, in a new top-level **`/home/khoa/Desktop/DATN/contract/`** project. The Anchor `onchain/` workspace is deleted.
- **Farming = Aave v3 on Sepolia.** The subwallet custody model (Navy-generated key, AES-256-GCM envelope encryption behind the `Cipher` interface, transient decrypt → deny-by-default `PolicyValidator` → sign → wipe) is preserved; only the chain primitives change. Farming asset is Aave's Sepolia faucet-USDC, distinct from the Circle payment USDC — the same accepted devnet seam as today's "payments in USDC / farming in native SOL."
- **Wallet + merchant apps unify on Privy EVM embedded wallets.** web-wallet uses Privy `useSignTypedData`; merchant fe replaces `@solana/wallet-adapter` + plain-text message with Privy + an EIP-712 payout authorization.
- **Full replacement, no multi-chain abstraction for payments** (YAGNI). Solana code is removed, not hidden behind a switch. The one adapter that earns its keep — farming's `YieldAdapter` — already exists and stays.
- **Devnet only.** A money-moving contract requires a professional audit before mainnet (hard gate, §9). Key-custody, gas-sponsorship, and real-USDC gates carry over from `docs/PRODUCTION.md`.

### Verified technical sources
- Circle USDC on Sepolia (`0x1c7D…7238`) is `FiatTokenV2_2` and exposes `receiveWithAuthorization(from,to,value,validAfter,validBefore,nonce,v,r,s)` with the EIP-712 domain `{name:"USDC", version:"2", chainId:11155111, verifyingContract:<usdc>}`. **Verify the on-chain `name()`/`version()` at implementation time** (Circle has shipped both `"USD Coin"` and `"USDC"` as the token name across versions) and read the domain fields from the deployed contract rather than hard-coding them.
- `receiveWithAuthorization` requires `msg.sender == to`, so only the `NavyPayments` contract can redeem an authorization addressed to it (front-run-safe). `transferWithAuthorization` does **not** have this guard and must not be used here.
- Aave v3 has a Sepolia testnet market with a faucet; `Pool.supply(asset,amount,onBehalfOf,referralCode)` and `Pool.withdraw(asset,amount,to)` are the deposit/redeem entry points; aTokens rebase 1:1 with the underlying.

---

## 1. Scope & boundaries

**In scope:**
- New Foundry project `contract/` with `NavyPayments.sol` (payments), tests (unit + fuzz/invariant + Sepolia-fork), and deploy/admin scripts.
- `be/` on-chain layer swap: `@solana/web3.js`/`@coral-xyz/anchor` → **ethers v6** + the Foundry-generated ABI; rewritten `RelayerService`, `ChainWatcherService`, farming signing/policy/adapter.
- Payment endpoints re-shaped to EIP-712: `GET /v1/orders/:id/payment-authorization`, `POST /v1/orders/:id/submit`.
- Prisma migration renaming Solana-shaped columns; the order state machine, durable single-use nonce, atomic `markPaid`, and HMAC `WebhookDelivery` are preserved.
- `web-wallet/` and `fe/` migrated to Privy EVM embedded wallets + EIP-712 signing.
- Farming re-homed on Aave v3 Sepolia behind the existing `YieldAdapter` interface.
- Updated `docs/PRODUCTION.md` risks/gates.

**Out of scope:**
- Multi-chain / cross-chain support (Solana is removed, not kept alongside).
- Mainnet deployment, audit, KMS/HSM, ERC-4337 paymaster (all recorded as gates in §9).
- Any change to the auth/JWT model, admin TOTP, merchant onboarding order, or the catalog/invoice line-item logic (all chain-agnostic and untouched).
- The Expo wallet (`expo-wallet/`) — this spec covers `web-wallet/`; the Expo port follows the same mapping in a later pass.

---

## 2. Architecture & components

```
web-wallet (user, Privy EVM)              Nest backend (Navy relayer EOA)
   │  scans QR (typed invoice)               │  builds EIP-712 ReceiveWithAuthorization
   │  useSignTypedData → 65-byte sig         │  recovers signer, submits payInvoice(), pays gas
   ▼                                         ▼
            ┌─────────────────────────────────────────────┐
            │        NavyPayments.sol (Sepolia)            │
            │  owner · treasury · feeBps · relayers[]      │
            │  merchants[bytes16] · invoicePaid[bytes32]   │
            │  payInvoice: receiveWithAuthorization →      │
            │              split USDC → emit InvoicePaid   │
            └─────────────────────────────────────────────┘
              │ USDC.receiveWithAuthorization (pull amount)
              │ USDC.transfer(payout, amount-fee)
              │ USDC.transfer(treasury, fee)
              ▼
       merchant.payout (EVM addr)   ·   treasury (EVM addr)
```

Repos touched: new `contract/` (Foundry); `be/` (on-chain module + gateway + farming); `web-wallet/` and `fe/` (Privy EVM). Deleted: `onchain/` (Anchor), `be/src/onchain/*.json` (IDL) and the `@solana/*` / `@coral-xyz/anchor` dependency tree in `be/`, plus `@solana/wallet-adapter-*` in `fe/`.

---

## 3. The `NavyPayments.sol` contract

A direct mirror of `navy_payments`, using EIP-3009 to pull funds with a single user signature.

### 3.1 State
```solidity
address public owner;                          // Navy admin/backend owner key — admin ops
address public treasury;                       // fee sink (plain EVM address, not an ATA)
IEIP3009 public usdc;                          // Circle Sepolia USDC (receiveWithAuthorization)
uint16  public feeBps;                         // default 100 (1%); MAX_FEE_BPS = 1000
mapping(address => bool) public relayers;      // owner-managed allowlist of submitters

struct Merchant { address payout; bool active; bool exists; }
mapping(bytes16 => Merchant) public merchants; // key = merchantId (16 bytes from DB uuid, unchanged)
mapping(bytes32 => bool) public invoicePaid;   // key = keccak256(merchantId, invoiceId) — pay-once guard

uint256 public constant MIN_INVOICE_AMOUNT = 10_000; // 0.01 USDC (6 decimals), unchanged
```

### 3.2 `payInvoice` — the core
```solidity
function payInvoice(
    bytes16 merchantId, bytes16 invoiceId, uint256 amount,
    uint256 validAfter, uint256 validBefore, address payer,
    uint8 v, bytes32 r, bytes32 s
) external onlyRelayer {
    bytes32 key = keccak256(abi.encodePacked(merchantId, invoiceId));
    require(!invoicePaid[key], "already paid");
    Merchant memory m = merchants[merchantId];
    require(m.exists && m.active, "merchant inactive");
    require(amount >= MIN_INVOICE_AMOUNT, "amount too small");

    invoicePaid[key] = true;                         // effects before interactions (reentrancy-safe)
    // nonce == key binds the user's signature to THIS merchant + invoice + amount + expiry:
    usdc.receiveWithAuthorization(payer, address(this), amount, validAfter, validBefore, key, v, r, s);

    uint256 fee = (amount * feeBps) / 10000;         // floors, same as Solana
    usdc.transfer(m.payout, amount - fee);
    if (fee > 0) usdc.transfer(treasury, fee);
    emit InvoicePaid(merchantId, invoiceId, payer, amount, fee, block.timestamp);
}
```

**Why it is tight (the invariants carried over from Anchor):**
- **Full binding despite USDC's minimal struct.** The user signs USDC's `ReceiveWithAuthorization{from,to,value,validAfter,validBefore,nonce}`. Because the contract passes `nonce = keccak256(merchantId, invoiceId)` and `value = amount`, `to = address(this)`, a wrong `merchantId`/`invoiceId`/`amount`/`payer`/`expiry` makes USDC's own EIP-712 verification revert. Merchant, invoice, amount, payer, and expiry are all cryptographically bound.
- **Replay is doubly enforced** — USDC's `authorizationState[from][nonce]` *and* our `invoicePaid[key]`. This is the EVM equivalent of the lazy Invoice PDA's "existence = nonce."
- **`receiveWithAuthorization` (not `transferWithAuthorization`)** is mandatory: its `msg.sender == to` guard means only this contract can redeem an authorization addressed to it, so a front-runner cannot divert the pull.
- **Fee math** is `(amount * feeBps) / 10000`, flooring — identical semantics to the Solana `checked_mul/checked_div`; Solidity 0.8 reverts on overflow.
- **Expiry** = `validBefore` (checked inside USDC); the contract needn't re-check, though it may for a clearer revert.

### 3.3 Admin functions (`onlyOwner`)
`setConfig(feeBps, treasury)` · `registerMerchant(merchantId, payout)` · `setMerchantActive(merchantId, active)` · `setMerchantPayout(merchantId, payout)` · `setRelayer(addr, allowed)`. These are what the backend calls on admin-approve, mirroring today's admin → on-chain registration. `feeBps <= MAX_FEE_BPS` enforced. `merchantId` is the stable 16-byte id derived from the merchant DB uuid — unchanged from today.

### 3.4 Events
```solidity
event InvoicePaid(bytes16 indexed merchantId, bytes16 indexed invoiceId,
                  address indexed payer, uint256 amount, uint256 fee, uint256 paidAt);
event MerchantRegistered(bytes16 indexed merchantId, address payout);
event MerchantPayoutSet(bytes16 indexed merchantId, address payout);
event MerchantActiveSet(bytes16 indexed merchantId, bool active);
event ConfigSet(uint16 feeBps, address treasury);
```
`InvoicePaid` carries everything the settlement watcher needs; no per-invoice storage struct is kept (the event is the record — cheaper than an on-chain struct, and the lazy Invoice PDA's payer/amount/fee/paidAt fields all live in the event).

### 3.5 Relayer gating
`payInvoice` is `onlyRelayer` (owner-managed allowlist) for operational control, mirroring "Navy relayer submits." **Documented future option:** because the user's signature fully constrains the outcome (destination, amount, fee all derive from on-chain merchant state + the signed authorization), the function is safe to make permissionless later without changing the trust model.

---

## 4. Payment flow (wallet + gateway)

1. **`GET /v1/orders/:id/payment-authorization`** (Navy user JWT; was `payment-tx`). Preconditions unchanged: order exists, status `awaiting_payment`, not expired, `req.user.walletAddress` is a valid EVM address. Returns the **EIP-712 typed data** to sign:
   - `domain` = the USDC contract's domain (read from chain / config).
   - `types` = the EIP-3009 `ReceiveWithAuthorization` type.
   - `message` = `{ from: payer, to: NavyPaymentsAddress, value: amount, validAfter: now, validBefore: order.expiresAt (unix), nonce: keccak256(merchantId, invoiceId) }`.
   Backend persists the EIP-712 digest as `issuedTxHash` + `issuedTxExpiresAt` (durable nonce — unchanged pattern), plus `invoice: { merchant, amount, reference, expiresAt }` for display.
2. **web-wallet** signs it with Privy EVM `useSignTypedData(typedData)` → a 65-byte signature (split to `v/r/s` server-side).
3. **`POST /v1/orders/:id/submit`** `{ signature }` (Navy user JWT, rate-limited). Backend recovers the signer from the stored digest, asserts `signer == req.user.walletAddress`, then atomically consumes `issuedTxConsumedAt` (the same `updateMany … where issuedTxConsumedAt = null` CAS). On success the **relayer wallet** sends `payInvoice(merchantId, invoiceId, amount, validAfter, validBefore, payer, v, r, s)` and pays gas. Response `{ txHash, status }`.
4. **Settlement stays on-chain (source of truth).** From the receipt (fast path) and a polling sweep over `confirming` orders (slow path), `ChainWatcherService` decodes the **`InvoicePaid` log** (ethers `contract.interface.parseLog` / `queryFilter` by the `keccak256(merchantId,invoiceId)`-derived topic), reconciles `payer/amount/fee`, runs the same atomic `markPaid` (`updateMany … where status != 'paid'`), and fires the same HMAC webhook. `payer` is now a checksummed EVM address; the webhook payload shape is otherwise identical (`{orderId, reference, amount, fee, payer, txSignature→txHash, status, paidAt}`).

The gasless two-signer property holds exactly: the user's signature authorizes the precise debit; the relayer pays gas.

---

## 5. Backend on-chain layer

- **`NAVY_ONCHAIN` injectable** becomes `{ provider: JsonRpcProvider, payments: ethers.Contract, relayer: ethers.Wallet, usdc: string, usdcDomain, treasury: string, paymentsAddress: string }`. ABI loaded from `contract/out/NavyPayments.sol/NavyPayments.json` (copied into `be/src/onchain/` at build, replacing the IDL-copy step in `nest-cli.json`).
- **`RelayerService`**: `buildAuthorization(order, merchantId, payer)` returns the typed data + persists the digest; `verifyAndSubmit(orderId, signature)` recovers the signer, CAS-consumes the nonce, sends `payInvoice`, returns `{ txHash, err }`. The `@solana/web3.js` balance pre-check becomes `provider.getBalance(relayer.address) >= NAVY_RELAYER_MIN_WEI` (503 if under).
- **`ChainWatcherService`**: `confirmOrder` fetches `getTransactionReceipt(txHash)`; `receipt == null` → retry; `receipt.status == 0` → `failed` (no webhook); else parse `InvoicePaid` and `markPaid`. `sweepConfirming`/`expireStale` cron intervals unchanged.
- **`merchantIdFromUuid`** unchanged (16 bytes → `bytes16`). PDA-derivation helpers deleted.
- **Config**: new envs `SEPOLIA_RPC_URL`, `NAVY_PAYMENTS_ADDRESS`, `NAVY_USDC_ADDRESS`, `NAVY_RELAYER_PRIVATE_KEY`, `NAVY_TREASURY_ADDRESS`, `NAVY_OWNER_PRIVATE_KEY` (admin ops), `NAVY_RELAYER_MIN_WEI`; drop `NAVY_PROGRAM_ID`, `NAVY_USDC_MINT` (Solana), relayer/treasury keypair files.

### 5.1 Prisma migration
- `Order`: `txSignature` → `txHash`; `payer` now holds an EVM address (type unchanged, `String?`); `onchainInvoiceId` stays (16-byte hex). `issuedTxHash/issuedTxExpiresAt/issuedTxConsumedAt` reused as-is (now the EIP-712 digest).
- `Merchant.payoutAddress` now an EVM address (type unchanged).
- `FarmingSubwallet`: `pubkey` now an EVM address; `encryptedPrivkey/dataKeyWrapped` unchanged (seal a secp256k1 key instead of ed25519); `principalLamports` → `principalBase`, `currentValueLamports` → `currentValueBase` (USDC 6-decimals). `policyJson` shape updated (§6).
- Money stays `BigInt` in Prisma, serialized to string at the controller boundary (unchanged rule).

---

## 6. Farming (subwallet, signing, policy, Aave)

The security spine is unchanged; only chain primitives change.

- **Subwallet key**: `ethers.Wallet.createRandom()` → secp256k1. The 32-byte private key is sealed by the **same `Cipher`** (AES-256-GCM envelope) — the interface is untouched, exactly the "one-class swap" the farming spec anticipated. `SubwalletService.provision` returns `{ id, address }`.
- **`SigningService`**: decrypt transiently → `PolicyValidator.check` → `new ethers.Wallet(pk).signTransaction(tx)` → wipe the key buffer in `finally`. Same isolation + audit records (`subwallet.sign` / `subwallet.sign.denied`).
- **`deriveTxSummary` (rewritten for EVM)**: decodes calldata instead of Solana instructions, returning `{ to, selector, kind, args }` per call. Recognizes ERC-20 `approve(spender,amount)` / `transfer(to,amount)` and Aave `Pool.supply(asset,amount,onBehalfOf,referral)` / `Pool.withdraw(asset,amount,to)`. `IxKind` → `erc20-approve | erc20-transfer | aave-supply | aave-withdraw | unknown`. Unknown selector → `unknown` (rejected).
- **`PolicyValidator` (same deny-by-default logic, EVM allowlists)**: `allowedProgramIds` → **allowed contract addresses** `[USDC, AavePool, aUSDC]`; `allowedDestinations` → for `approve` the spender must equal `AavePool`; for `transfer`/`withdraw` the recipient must be in `{subwallet, AavePool, ownerMainWallet}`. Any off-allowlist contract/target or unknown selector → reject + audit. `DelegatedPolicyValidator` still bounds auto-funding to a single transfer-to-subwallet within amount limits.
- **`AaveYieldAdapter` (implements `YieldAdapter`)**:
  - `buildDeposit(subwallet, amount)` → `approve(AavePool, amount)` then `Pool.supply(USDC, amount, subwallet, 0)` (two txs; `supplyWithPermit` single-tx noted as an optimization if the faucet USDC supports permit).
  - `buildWithdraw(subwallet, ownerMainWallet, amount|'all')` → `Pool.withdraw(USDC, amount, ownerMainWallet)`; Aave sends the redeemed USDC straight to `to`, satisfying the owner-payout destination natively (no appended transfer, unlike the Solana WSOL-unwrap trick). `'all'` uses `type(uint256).max`.
  - `getPosition(subwallet)` → `aUSDC.balanceOf(subwallet)` (rebasing 1:1 = current value); principal tracked in DB (v1, no on-chain cost basis), same as today.
  - `policyAllowlist(subwallet, ownerMainWallet)` → `{ contracts: [USDC, AavePool, aUSDC], destinations: [subwallet, AavePool, ownerMainWallet] }`.
- **Farming gas (the one genuine EVM wrinkle).** On Solana, fee-payer and instruction-authority are separate signers in one tx, so gas could be relayed. On EVM `msg.sender` *is* the gas payer, and `Pool.supply` pulls the subwallet's own USDC, so the subwallet must be the sender. **Decision:** the backend tops up each subwallet with a small **Sepolia-ETH gas float** from the relayer (a documented devnet accommodation that mirrors today's "subwallet holds native SOL"). The `SigningService` signs; the subwallet is the sender. **Mainnet gate:** ERC-4337 paymaster / account abstraction so the subwallet never needs a native-gas balance.
- **Delegated auto-funding** maps directly: the user's Privy **EVM** embedded wallet, delegated (`PRIVY_AUTHORIZATION_KEY`), signs a USDC transfer into the subwallet, bounded by `DelegatedPolicyValidator`.
- **Farming asset** = Aave Sepolia faucet-USDC, distinct from the Circle payment USDC — the documented seam paralleling today's payments-USDC / farming-SOL split. Users acquire farming-USDC from the Aave faucet (devnet).

---

## 7. Frontends

- **web-wallet** (Privy EVM):
  - `PrivyProvider` config `embeddedWallets.ethereum.createOnLogin: 'users-without-wallets'` plus the on-demand `createWallet()` fallback (same lifecycle lesson as the Solana port — provision for users who authenticated before the config existed, else `address` stays undefined).
  - Pay flow: `getPaymentAuthorization(orderId, token)` → `useSignTypedData(typedData)` → `submitSignature(orderId, sig, token)`. The old base64-tx deserialization is gone.
  - Balances: ethers `usdc.balanceOf(address)` + `provider.getBalance(address)` (ETH gas display). Farming client fields `*Base` (USDC 6-dec); `formatUsdc` replaces `formatSol`. Identity helpers (`short`, `avatarColors`) switch from base58 to checksummed hex.
  - The Buffer/crypto polyfill caveat is lighter on EVM (ethers/viem are browser-native), but keep the `next build` runtime gate.
- **merchant fe** (Privy EVM): payout authorization becomes an **EIP-712** typed struct `NavyPayoutAuthorization{ merchantId, payout, nonce, issuedAt }` under a Navy domain, signed via `useSignTypedData` — an upgrade from today's plain-text `signMessage`. Merchant payout stored as an EVM address; backend verifies the EIP-712 signature (replacing `buildPayoutMessage` + bs58 signature). Merchant onboarding order (signup → payout challenge → set payout → admin approve → API key) is unchanged.
- **admin fe**: admin approve → backend `owner` wallet calls `registerMerchant`/`setMerchantActive` on-chain (admin needs no wallet, same as today). Order/payment tables are chain-agnostic; explorer links point to **Etherscan Sepolia**.

---

## 8. Testing strategy

- **Contracts (Foundry, `forge test`)**: unit + **fuzz/invariant** coverage of the exact invariants the Anchor suite held — 99/1 fee split with flooring, pay-once replay (both `authorizationState` and `invoicePaid`), expiry via `validBefore`, `MIN_INVOICE_AMOUNT`, rejection of wrong-merchant/wrong-amount/wrong-payer signatures, inactive/unknown merchant, `onlyOwner`/`onlyRelayer` gating. A fork test against Sepolia exercises the real Circle USDC `receiveWithAuthorization` end-to-end.
- **Backend (jest, `src/lib`-style plain-TS units)**: EIP-712 digest construction, signature recovery + payer assertion, `InvoicePaid` log decode, nonce/CAS logic, fee reconciliation fallback. Env-gated integration (`NAVY_E2E=1`) against a live Sepolia relayer + deployed contract (mirrors today's gated e2e). `NAVY_FARM_E2E=1` covers the Aave deposit/withdraw path.
- **Frontends**: `pnpm exec tsc --noEmit` + `pnpm build` gates (unchanged); plain-TS `src/lib` units for pay-authorization building, EIP-712 typed-data assembly, and farming math.

---

## 9. Rollout & deferred (mainnet gates)

**Rollout order:**
1. `contract/` — write + test `NavyPayments`, deploy to Sepolia, fund the relayer EOA, register the treasury/config.
2. `be/` — on-chain module swap (ethers + ABI), gateway endpoints, farming (Aave adapter + EVM policy/signing), Prisma migration.
3. `web-wallet/` + `fe/` — Privy EVM, EIP-712 signing.
4. e2e smoke: create order → sign authorization → relay `payInvoice` → `InvoicePaid` → webhook; farming deposit → position → withdraw.

**Accepted devnet risks (carried/updated from `docs/PRODUCTION.md`):** env-var `SUBWALLET_MASTER_KEY`; single relayer/owner key; in-memory/per-process rate caps; `policyJson` not runtime schema-validated; broad `PRIVY_AUTHORIZATION_KEY` blast radius (bounded by `DelegatedPolicyValidator`); **subwallet native-ETH gas float**; farming on Aave faucet-USDC ≠ payment USDC.

**Hard mainnet gates:** professional audit of `NavyPayments` before mainnet; move relayer/owner/subwallet/Privy keys to KMS/HSM with separation + rotation; ERC-4337 paymaster so subwallets need no native gas; owner → multisig/timelock; real USDC unifying payments + farming; distributed rate-limits + relayer spend cap (Redis); webhook re-delivery worker; metrics/alerting (relayer balance, webhook failures, farming reverts); KYC/AML + custody review. The `Cipher` and `YieldAdapter` seams keep the key-custody and protocol swaps one-class changes.

### Deferred future options
- **Permissionless `payInvoice`** (drop `onlyRelayer`) — safe because the signature fully constrains the outcome; enables third-party relayers.
- **`supplyWithPermit`** single-tx farming deposit.
- **Expo wallet** EVM port (same mapping as web-wallet).
- **On-chain merchant-signed invoices** (the Approach-B trustless model from the original payments spec) — still the more trustless future direction.
