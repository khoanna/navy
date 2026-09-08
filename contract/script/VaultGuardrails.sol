// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";

/// @title VaultGuardrails
/// @notice The on-chain guardrails the paper attributes to the immutable
///         layer, in one place, so every deploy path sets the same values.
///
/// @dev Before this library existed NO deploy script called `setAdapterRisk`
///      with a liquidity floor, `setMaxSynchronousLossBps`, `setAdminReserve`,
///      `setWithdrawalOrder` or `setDependencyGroup`. A freshly deployed vault
///      therefore ran with:
///        - `liquidityFloorBps = 0`, which makes `_deploy`'s liquidity check a
///          dead branch, so amendment P5 had no on-chain existence at all and
///          the H6 ablation removed a constraint that was never there;
///        - `maxSynchronousLossBps = 0`, so `_ensureIdle`'s allowance is
///          `mulDiv(assets, 0, 10_000) == 0` and ANY rounding loss reverts a
///          user withdrawal -- with Compound III's documented ~2-base-unit
///          supply floor, redemptions sourcing from Compound were expected to
///          revert on a default deployment;
///        - an empty withdrawal order, so paper 5.2's "deterministic order" was
///          the registry order, which `_removeAdapter` mutates by swap-and-pop;
///        - no dependency groups, so `_enforceDependencyGroupCaps` iterated an
///          empty list and 6.1's explicit 100% common-mode limits were unstated.
///
///      Every number below is a judgement call and is justified inline. All of
///      them remain admin-adjustable after deployment.
library VaultGuardrails {
    /// @notice Amendment P5's structural liquidity floor, in bps of the
    ///         adapter's post-deploy position.
    /// @dev `_deploy` requires `adapter.maxWithdrawable() >= position * bps /
    ///      10_000` AFTER crediting the deposit.
    ///
    ///      Why not 10_000 (demand the whole position be exitable): both
    ///      Moonwell and Compound report a `maxWithdrawable` that can sit a few
    ///      base units BELOW the freshly credited position -- Moonwell's
    ///      `maxWithdrawable` uses `exchangeRateStored()` while its `sync()`
    ///      uses `exchangeRateCurrent()`, and Comet floors ~2 base units on
    ///      supply. A 100% floor would turn that rounding into a permanent
    ///      revert on every deploy.
    ///
    ///      Why not lower: the floor only earns its place if it binds before a
    ///      venue is meaningfully drained. At 90% it is ~7 orders of magnitude
    ///      above any rounding artefact on a realistic position, so it can only
    ///      fire on genuine venue illiquidity -- which is exactly the state in
    ///      which 5.2's `Q^sync` cap would already be shrinking `maxWithdraw`.
    ///
    ///      Liveness note: this makes a third-party venue's transient
    ///      utilisation able to revert a DEPLOY (never a withdrawal). An
    ///      adversary who can push a venue's free cash below 90% of the vault's
    ///      position there can block further deploys to it; the allocator can
    ///      retry, and an admin can lower the floor.
    uint16 internal constant LIQUIDITY_FLOOR_BPS = 9_000;

    /// @notice Aggregate loss allowance on the user-withdrawal path, in bps of
    ///         the withdrawal.
    /// @dev Must be non-zero or any dust loss reverts the redemption. 5 bps is
    ///      ~2500x Comet's ~2-base-unit floor on a $1 withdrawal and 20x
    ///      tighter than the per-adapter `maxLossBps` (100-150) that already
    ///      bounds each individual divest.
    ///
    ///      KNOWN LIMITATION: this is proportional, so it cannot express "a few
    ///      base units". A withdrawal below ~0.004 USDC still gets an allowance
    ///      that floors to zero and can revert on dust. Expressing an absolute
    ///      dust allowance would need a new vault field; that is a design
    ///      decision, not a deploy-script value, and is deliberately not made
    ///      here.
    uint16 internal constant MAX_SYNCHRONOUS_LOSS_BPS = 5;

    /// @notice Paper 8.1's `I^floor`, the administrator's absolute
    ///         non-bypassable idle floor, in USDC base units.
    /// @dev `requiredIdle()` is `max(adminReserve, dynamicReserve,
    ///      activePlanReserve, minIdleBps * totalAssets)`. `minIdleBps` already
    ///      defaults to 50 (0.5%), which is a *proportional* floor and is
    ///      therefore trivially small while the vault is small: at $50k NAV it
    ///      reserves $250, not enough to service one ordinary redemption
    ///      without a divest round-trip.
    ///
    ///      $1,000 is roughly one retail redemption, and it stops binding as
    ///      soon as NAV passes $200,000 (where 0.5% overtakes it), so it costs
    ///      no yield at any scale the vault is meant to operate at. It is a
    ///      floor for the small-vault regime only.
    uint256 internal constant ADMIN_RESERVE_BASE = 1_000e6;

    /// @notice Paper 6.1: "Base and native USDC are accepted common-mode
    ///         dependencies for this single-chain study and therefore receive
    ///         100% limits rather than being presented as diversification."
    /// @dev These groups are deliberately non-binding (capBps 10_000 == NAV).
    ///      Their purpose is to make the common-mode exposure an explicit,
    ///      configuration-digest-covered on-chain record instead of an unstated
    ///      assumption, and to give the H5 ablation something to remove.
    bytes32 internal constant GROUP_BASE_L2 = keccak256("NAVY_DEPENDENCY_BASE_L2");
    bytes32 internal constant GROUP_NATIVE_USDC = keccak256("NAVY_DEPENDENCY_NATIVE_USDC");

    uint16 internal constant DEPENDENCY_CAP_BPS = 10_000;

    /// @notice Apply every guardrail to `vault`.
    /// @param vault    The vault to configure. The caller must hold ADMIN_ROLE.
    /// @param ordered  The registered adapters in DIVESTMENT order. Paper 5.2
    ///                 requires this order to be deterministic; the registry
    ///                 order is not, because `_removeAdapter` swap-and-pops.
    ///                 Callers pass Aave, then Compound, then Moonwell: Aave's
    ///                 aToken burn is exact, Compound carries the documented
    ///                 base-unit supply floor, and Moonwell converts through an
    ///                 exchange rate, so the venues that can shed dust are
    ///                 drained last and contribute to the aggregate loss guard
    ///                 only for the residual.
    function applyTo(NavyVaultSRCLA vault, address[] memory ordered) internal {
        // 1. Structural liquidity floor per adapter (P5), preserving the caps
        //    registerAdapter already set. Reading them back rather than
        //    restating them keeps this library from silently overwriting a
        //    per-deployment cap with a stale constant.
        for (uint256 i = 0; i < ordered.length; i++) {
            (uint16 capBps, uint256 absoluteCap, uint16 maxLossBps,,,,) = vault.adapters(ordered[i]);
            vault.setAdapterRisk(ordered[i], capBps, absoluteCap, maxLossBps, LIQUIDITY_FLOOR_BPS);
        }

        // 2. Aggregate loss allowance on the withdrawal path.
        vault.setMaxSynchronousLossBps(MAX_SYNCHRONOUS_LOSS_BPS);

        // 3. Administrator's absolute idle floor (8.1).
        vault.setAdminReserve(ADMIN_RESERVE_BASE);

        // 4. Deterministic divestment order (5.2).
        vault.setWithdrawalOrder(ordered);

        // 5. Explicit 100% common-mode dependency groups (6.1).
        vault.setDependencyGroup(GROUP_BASE_L2, DEPENDENCY_CAP_BPS, type(uint256).max, ordered);
        vault.setDependencyGroup(GROUP_NATIVE_USDC, DEPENDENCY_CAP_BPS, type(uint256).max, ordered);
    }
}
