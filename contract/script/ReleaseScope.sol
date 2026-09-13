// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// P37 release scope: the first mainnet vault accepts at most $1,000,000 of
// deposits (USDC base units). Yield may carry NAV past it; only new deposits
// and mints stop. Defined once so the deploy script, its verifier and their
// tests cannot drift. Not in VaultGuardrails: DeployAndFund's §11.1 tier
// vaults share those guardrails and must accept 10M.
uint256 constant MAINNET_DEPOSIT_CAP_BASE = 1_000_000e6;
