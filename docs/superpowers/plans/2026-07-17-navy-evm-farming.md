# Farming → EVM (Aave v3 Sepolia) — Migration Brief

Finishes "no more Solana": migrate `be/src/farming` + `be/src/wallet` from Solana/Solend to EVM/Aave, delete the Solana `OnchainModule`, and remove `@solana/*` + `@solendprotocol/solend-sdk` + `@coral-xyz/anchor`. The payments path is already fully EVM (`be/src/evm`, `NAVY_EVM`).

## Verified addresses (Aave v3 Sepolia, checked on-chain)
- **Aave Pool**: `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`
- **Aave test USDC** (6 dec, farming asset — NOT the Circle payment USDC): `0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8`
- **aToken aEthUSDC**: `0x16dA4541aD1807f4443d92D26044C1147406EB80`

## Locked decisions
- **Subwallet key = secp256k1** (`ethers.Wallet.createRandom()`), sealed by the existing chain-agnostic `Cipher` (AES-256-GCM envelope) — unchanged interface. `FarmingSubwallet.pubkey` stores the **EVM address**.
- **No Prisma migration.** Keep column names as-is (`pubkey`, `principalLamports`, `currentValueLamports`, `policyJson`); they now hold an EVM address + USDC base units (6 dec). Values change, types don't. Document the reinterpretation in comments.
- **Policy model preserved (deny-by-default, authoritative from the tx).** Keep `SubwalletPolicy` field names `{ allowedProgramIds, allowedDestinations }` — `allowedProgramIds` now holds **allowed contract addresses** (`[USDC, AavePool, aToken]`), `allowedDestinations` holds **allowed recipients** (`[subwallet, AavePool, ownerMainWallet]`). Compare addresses case-insensitively (checksummed hex).
- **`deriveTxSummary` decodes EVM calldata** (not Solana instructions): each call → `{ to, selector, kind, spender?, recipient?, amount? }`. `IxKind = 'erc20-approve' | 'erc20-transfer' | 'aave-supply' | 'aave-withdraw' | 'unknown'`.
- **Gas:** the subwallet sends its own Aave txs (msg.sender must own the USDC), so it needs a small **Sepolia-ETH gas float** (backend tops it up from the relayer). Documented devnet accommodation; mainnet gate = ERC-4337 paymaster.
- **Provider:** farming uses the existing `NAVY_EVM` (ethers `JsonRpcProvider` + relayer/owner). Subwallet actions use a `new ethers.Wallet(pk, NAVY_EVM.provider)`.

## Policy rules (EVM)
For every decoded call:
1. `to` (contract) must be in `allowedProgramIds` (contract allowlist) — else reject.
2. `erc20-approve`: `spender` must equal the Aave Pool (an allowed destination) — else reject.
3. `erc20-transfer` / `aave-withdraw`: `recipient`/`to` must be in `allowedDestinations` (subwallet, Pool, ownerMainWallet) — else reject.
4. `aave-supply`: `onBehalfOf` must equal the subwallet — else reject.
5. `unknown` selector → reject + audit.
The subwallet itself is always an implicit allowed destination (defense-in-depth), same as today.

## Aave adapter (`YieldAdapter` EVM impl)
- `buildDeposit(subwallet, amountBase)` → `[ USDC.approve(Pool, amount), Pool.supply(USDC, amount, subwallet, 0) ]` (two calldata txs).
- `buildWithdraw(subwallet, ownerMainWallet, amount|'all')` → `Pool.withdraw(USDC, amount|MaxUint256, ownerMainWallet)` (Aave sends redeemed USDC straight to `to`).
- `getPosition(subwallet)` → `aToken.balanceOf(subwallet)` (rebases 1:1 = current value); principal tracked in DB.
- `policyAllowlist(subwallet, ownerMainWallet)` → `{ programIds:[USDC,Pool,aToken], destinations:[subwallet,Pool,ownerMainWallet] }`.

## Wiring / cleanup (final task)
- Farming + wallet + `health` + `delegated-funding` switch from `NAVY_ONCHAIN` → `NAVY_EVM`. `health` RPC check → `provider.getBlockNumber()`.
- Delete `src/onchain/onchain.module.ts` + `src/onchain/navy_payments.json` (no consumers left once farming migrates; payments + admin-merchants already use `NAVY_EVM`).
- `privy.service.ts`: Privy Solana delegated signing → EVM (verify `@privy-io/server-auth` / installed types).
- Remove deps from `be/package.json`: `@solana/web3.js`, `@solana/spl-token`, `@coral-xyz/anchor`, `@solendprotocol/solend-sdk`, `bs58` (if unused), the `pnpm.overrides` web3.js pin, and the `pnpm.onlyBuiltDependencies` solana entries. Clean the `rpc-websockets`/`uuid` `moduleNameMapper` in `jest.config.js` if no longer needed.
- **Gate:** `pnpm exec tsc --noEmit -p tsconfig.json` exit 0, `pnpm test` all green, `pnpm build` succeeds.

## Tests
Backend `*.spec.ts` with real `ethers.Interface` to encode calldata for `deriveTxSummary`/policy tests; mock the provider/contract for adapter + service tests; sign with a real `ethers.Wallet` where signatures matter. Preserve every existing farming security test's intent (deny off-allowlist program/destination, dangerous ops, unknown ops).
