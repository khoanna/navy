// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyVault} from "../src/NavyVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockYieldAdapter} from "./mocks/MockYieldAdapter.sol";
import {LossyMockYieldAdapter} from "./mocks/LossyMockYieldAdapter.sol";
import {RevertingMockYieldAdapter} from "./mocks/RevertingMockYieldAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract NavyVaultTest is Test {
    NavyVault vault;
    MockUSDC usdc;
    MockYieldAdapter adapterA;
    MockYieldAdapter adapterB;

    address owner = address(0x0111);
    address relayer = address(0x0333);
    address allocator = address(0x0A11);
    address alice = address(0xA11CE);

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(owner);
        vault = new NavyVault(IERC20(address(usdc)), owner);
        vm.startPrank(owner);
        vault.setRelayer(relayer, true);
        vault.setAllocator(allocator, true);
        adapterA = new MockYieldAdapter(address(vault), address(usdc), 3e16); // 3% APR
        adapterB = new MockYieldAdapter(address(vault), address(usdc), 5e16); // 5% APR
        vault.addAdapter(address(adapterA), 5000, 10000); // target 50%, cap 100%
        vault.addAdapter(address(adapterB), 5000, 10000);
        vault.setParams(1000, 50); // minIdleBps 10%, maxLossBps 0.5%
        vm.stopPrank();
    }

    function test_constructor_metadata() public view {
        assertEq(vault.name(), "Navy Vault USDC");
        assertEq(vault.symbol(), "navUSDC");
        assertEq(vault.owner(), owner);
        assertEq(vault.asset(), address(usdc));
    }

    function test_addAdapter_registersAndTracks() public view {
        assertEq(vault.adapterCount(), 2);
        (bool exists, uint16 targetBps, uint16 capBps) = vault.adapterInfo(address(adapterA));
        assertTrue(exists);
        assertEq(targetBps, 5000);
        assertEq(capBps, 10000);
    }

    function test_addAdapter_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.addAdapter(address(0xdead), 5000, 10000);
    }

    function test_removeAdapter_requiresEmpty() public {
        vm.prank(owner);
        vault.removeAdapter(address(adapterA));
        assertEq(vault.adapterCount(), 1);
    }

    // Mirrors the EIP-3009 signing helper in NavyPayments.t.sol.
    function _signReceive(
        uint256 pk,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function test_depositWithAuthorization_mintsShares() public {
        uint256 pk = 0xBEEF;
        address user = vm.addr(pk);
        usdc.mint(user, 100e6);

        bytes32 nonce = keccak256("deposit-1");
        (uint8 v, bytes32 r, bytes32 s) =
            _signReceive(pk, user, address(vault), 100e6, 0, block.timestamp + 1 hours, nonce);

        vm.prank(relayer);
        uint256 shares = vault.depositWithAuthorization(user, 100e6, 0, block.timestamp + 1 hours, nonce, v, r, s);

        assertEq(vault.balanceOf(user), shares);
        assertEq(vault.totalAssets(), 100e6);
        assertEq(usdc.balanceOf(address(vault)), 100e6);
        // First deposit: assets convert 1:1 to shares (scaled by the decimals offset).
        assertEq(vault.convertToAssets(shares), 100e6);
    }

    function test_depositWithAuthorization_onlyRelayer() public {
        bytes32 nonce = keccak256("deposit-2");
        vm.prank(alice);
        vm.expectRevert(NavyVault.NotRelayer.selector);
        vault.depositWithAuthorization(alice, 1e6, 0, block.timestamp + 1 hours, nonce, 27, bytes32(0), bytes32(0));
    }

    function _depositAs(uint256 pk, uint256 amount, bytes32 nonce) internal {
        address user = vm.addr(pk);
        usdc.mint(user, amount);
        (uint8 v, bytes32 r, bytes32 s) =
            _signReceive(pk, user, address(vault), amount, 0, block.timestamp + 1 hours, nonce);
        vm.prank(relayer);
        vault.depositWithAuthorization(user, amount, 0, block.timestamp + 1 hours, nonce, v, r, s);
    }

    function test_deployToAdapter_movesIdleAndRespectsBuffer() public {
        _depositAs(0xBEEF, 100e6, keccak256("d1"));
        // minIdleBps 10% of 100e6 == 10e6 must stay idle → at most 90e6 deployable.
        vm.prank(allocator);
        vault.deployToAdapter(address(adapterA), 90e6);
        assertEq(adapterA.totalAssets(), 90e6);
        assertEq(usdc.balanceOf(address(vault)), 10e6);
        assertEq(vault.totalAssets(), 100e6); // unchanged by moving idle→adapter
    }

    function test_deployToAdapter_revertsOnBufferBreach() public {
        _depositAs(0xBEEF, 100e6, keccak256("d2"));
        vm.prank(allocator);
        vm.expectRevert(NavyVault.IdleBufferBreached.selector);
        vault.deployToAdapter(address(adapterA), 95e6); // would leave only 5e6 < 10e6 buffer
    }

    function test_deployToAdapter_revertsOnCap() public {
        _depositAs(0xBEEF, 100e6, keccak256("d3"));
        vm.prank(owner);
        vault.setTargets(address(adapterA), 5000, 5000); // cap 50%
        vm.prank(allocator);
        vm.expectRevert(NavyVault.CapExceeded.selector);
        vault.deployToAdapter(address(adapterA), 60e6); // 60% > 50% cap
    }

    function test_deployToAdapter_onlyAllocator() public {
        _depositAs(0xBEEF, 100e6, keccak256("d4"));
        vm.prank(alice);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.deployToAdapter(address(adapterA), 10e6);
    }

    function test_reallocate_movesBetweenAdapters() public {
        _depositAs(0xBEEF, 100e6, keccak256("d5"));
        vm.startPrank(allocator);
        vault.deployToAdapter(address(adapterA), 80e6);
        vault.reallocate(address(adapterA), address(adapterB), 50e6);
        vm.stopPrank();
        assertEq(adapterA.totalAssets(), 30e6);
        assertEq(adapterB.totalAssets(), 50e6);
        assertEq(vault.totalAssets(), 100e6);
    }

    function test_withdrawFromAdapter_onlyAllocator() public {
        vm.prank(alice);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.withdrawFromAdapter(address(adapterA), 1e6);
    }

    function test_withdrawFromAdapter_unknownAdapter() public {
        vm.prank(allocator);
        vm.expectRevert(NavyVault.UnknownAdapter.selector);
        vault.withdrawFromAdapter(address(0xdead), 1e6);
    }

    function test_withdrawFromAdapter_revertsOnExcessiveLoss() public {
        // Register a lossy adapter that withholds 1e6 per withdraw; maxLossBps is 50 (0.5%).
        LossyMockYieldAdapter lossy = new LossyMockYieldAdapter(address(vault), address(usdc), 1e6);
        vm.prank(owner);
        vault.addAdapter(address(lossy), 0, 10000);

        _depositAs(0xBEEF, 100e6, keccak256("loss1"));
        vm.startPrank(allocator);
        vault.deployToAdapter(address(lossy), 50e6);
        // Withdraw 10e6 but only 9e6 arrives → 1e6 shortfall == 10% >> 0.5% cap → revert.
        vm.expectRevert(NavyVault.LossTooHigh.selector);
        vault.withdrawFromAdapter(address(lossy), 10e6);
        vm.stopPrank();
    }

    function test_redeem_pullsFromAdaptersWhenIdleInsufficient() public {
        uint256 pk = 0xBEEF;
        address user = vm.addr(pk);
        _depositAs(pk, 100e6, keccak256("r1"));
        // Deploy 90e6 so idle is only 10e6.
        vm.prank(allocator);
        vault.deployToAdapter(address(adapterA), 90e6);

        uint256 shares = vault.balanceOf(user);
        // User redeems everything; vault must pull ~90e6 back from the adapter.
        vm.prank(user);
        uint256 assets = vault.redeem(shares, user, user);

        assertEq(assets, 100e6);
        assertEq(usdc.balanceOf(user), 100e6);
        assertEq(vault.balanceOf(user), 0);
    }

    function test_redeem_partialLeavesRemainderInvested() public {
        uint256 pk = 0xBEEF;
        address user = vm.addr(pk);
        _depositAs(pk, 100e6, keccak256("r2"));
        vm.prank(allocator);
        vault.deployToAdapter(address(adapterA), 90e6);

        uint256 half = vault.balanceOf(user) / 2;
        vm.prank(user);
        vault.redeem(half, user, user);

        assertApproxEqAbs(usdc.balanceOf(user), 50e6, 1);
        assertApproxEqAbs(vault.totalAssets(), 50e6, 1);
    }

    function test_redeem_revertsWhenAdapterPullExceedsMaxLoss() public {
        // Lossy adapter withholds 5e6 per withdraw; maxLossBps is 50 (0.5%).
        LossyMockYieldAdapter lossy = new LossyMockYieldAdapter(address(vault), address(usdc), 5e6);
        vm.prank(owner);
        vault.addAdapter(address(lossy), 0, 10000);

        uint256 pk = 0xBEEF;
        address user = vm.addr(pk);
        _depositAs(pk, 100e6, keccak256("rl1"));
        // Deploy 90e6 into the lossy adapter so a full redeem must pull from it and trip LossTooHigh.
        vm.prank(allocator);
        vault.deployToAdapter(address(lossy), 90e6);

        uint256 shares = vault.balanceOf(user);
        vm.prank(user);
        vm.expectRevert(NavyVault.LossTooHigh.selector);
        vault.redeem(shares, user, user);
    }

    // --- audit hardening: adapter-revert isolation ---

    function test_totalAssets_survivesRevertingAdapter() public {
        RevertingMockYieldAdapter bad = new RevertingMockYieldAdapter(address(usdc));
        vm.prank(owner);
        vault.addAdapter(address(bad), 0, 10000);

        _depositAs(0xBEEF, 100e6, keccak256("rev-ta"));
        // The reverting adapter contributes 0; totalAssets is the healthy (idle) sum.
        assertEq(vault.totalAssets(), 100e6);
    }

    function test_deposit_notBrickedByRevertingAdapter() public {
        RevertingMockYieldAdapter bad = new RevertingMockYieldAdapter(address(usdc));
        vm.prank(owner);
        vault.addAdapter(address(bad), 0, 10000);

        // depositWithAuthorization prices via previewDeposit → totalAssets; must not brick.
        _depositAs(0xBEEF, 100e6, keccak256("rev-dep"));
        address user = vm.addr(0xBEEF);
        assertGt(vault.balanceOf(user), 0);
        assertEq(vault.totalAssets(), 100e6);
    }

    function test_forceRemoveAdapter_removesRevertingAdapter() public {
        RevertingMockYieldAdapter bad = new RevertingMockYieldAdapter(address(usdc));
        vm.prank(owner);
        vault.addAdapter(address(bad), 0, 10000);
        assertEq(vault.adapterCount(), 3);

        // Normal removeAdapter reverts because the emptiness check reverts → AdapterNotEmpty.
        vm.prank(owner);
        vm.expectRevert(NavyVault.AdapterNotEmpty.selector);
        vault.removeAdapter(address(bad));

        // Force-remove succeeds unconditionally.
        vm.prank(owner);
        vault.forceRemoveAdapter(address(bad));
        assertEq(vault.adapterCount(), 2);
        (bool exists,,) = vault.adapterInfo(address(bad));
        assertFalse(exists);
    }

    function test_addAdapter_capEnforced() public {
        // setUp already added 2 adapters; add until MAX_ADAPTERS (10), then expect revert.
        vm.startPrank(owner);
        uint256 current = vault.adapterCount();
        for (uint256 i = current; i < vault.MAX_ADAPTERS(); ++i) {
            MockYieldAdapter a = new MockYieldAdapter(address(vault), address(usdc), 0);
            vault.addAdapter(address(a), 0, 10000);
        }
        assertEq(vault.adapterCount(), vault.MAX_ADAPTERS());

        MockYieldAdapter overflow = new MockYieldAdapter(address(vault), address(usdc), 0);
        vm.expectRevert(NavyVault.TooManyAdapters.selector);
        vault.addAdapter(address(overflow), 0, 10000);
        vm.stopPrank();
    }

    function test_withdrawFromAdapter_toleratesDust() public {
        // maxLossBps=0 → only the absolute LOSS_DUST (10) tolerance applies.
        vm.prank(owner);
        vault.setParams(0, 0);

        // Adapter withholding 2 units (<= 10 dust) → withdraw succeeds.
        LossyMockYieldAdapter dusty = new LossyMockYieldAdapter(address(vault), address(usdc), 2);
        vm.prank(owner);
        vault.addAdapter(address(dusty), 0, 10000);

        _depositAs(0xBEEF, 100e6, keccak256("dust1"));
        vm.startPrank(allocator);
        vault.deployToAdapter(address(dusty), 50e6);
        vault.withdrawFromAdapter(address(dusty), 10e6); // 2 shortfall <= 10 dust → ok
        vm.stopPrank();

        // Adapter withholding 100 units (> 10 dust) → still reverts LossTooHigh.
        LossyMockYieldAdapter lossy = new LossyMockYieldAdapter(address(vault), address(usdc), 100);
        vm.prank(owner);
        vault.addAdapter(address(lossy), 0, 10000);
        vm.startPrank(allocator);
        vault.deployToAdapter(address(lossy), 40e6);
        vm.expectRevert(NavyVault.LossTooHigh.selector);
        vault.withdrawFromAdapter(address(lossy), 10e6);
        vm.stopPrank();
    }

    // --- audit hardening batch B ---

    function test_depositWithAuthorization_revertsOnZeroShares() public {
        // Donate 2 USDC directly into the EMPTY vault so a tiny signed deposit prices to 0 shares.
        uint256 D = 2_000_000; // 2 USDC
        usdc.mint(address(this), D);
        usdc.transfer(address(vault), D);

        uint256 pk = 0xBEEF;
        address user = vm.addr(pk);
        usdc.mint(user, 1); // 1 base unit
        bytes32 nonce = keccak256("zero-share");
        // previewDeposit(1) with 2_000_001 backing and no shares outstanding rounds to 0.
        assertEq(vault.previewDeposit(1), 0);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(pk, user, address(vault), 1, 0, block.timestamp + 1 hours, nonce);
        vm.prank(relayer);
        vm.expectRevert(NavyVault.ZeroShares.selector);
        vault.depositWithAuthorization(user, 1, 0, block.timestamp + 1 hours, nonce, v, r, s);
    }

    function test_transferOwnership_twoStep() public {
        vm.prank(owner);
        vault.transferOwnership(alice);
        assertEq(vault.pendingOwner(), alice);
        assertEq(vault.owner(), owner); // unchanged until accepted

        vm.prank(alice);
        vault.acceptOwnership();
        assertEq(vault.owner(), alice);
        assertEq(vault.pendingOwner(), address(0));
    }

    function test_acceptOwnership_onlyPending() public {
        vm.prank(owner);
        vault.transferOwnership(alice);

        address bob = address(0xB0B);
        vm.prank(bob);
        vm.expectRevert(NavyVault.NotPendingOwner.selector);
        vault.acceptOwnership();
    }

    function test_setPaused_blocksDepositAndDeploy_allowsRedeem() public {
        // A user deposits BEFORE pausing.
        uint256 pk = 0xBEEF;
        address user = vm.addr(pk);
        _depositAs(pk, 100e6, keccak256("pause-dep"));

        // setPaused is onlyOwner.
        vm.prank(alice);
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.setPaused(true);

        vm.prank(owner);
        vault.setPaused(true);

        // New deposit blocked.
        {
            usdc.mint(user, 10e6);
            bytes32 nonce = keccak256("pause-dep-2");
            (uint8 v, bytes32 r, bytes32 s) =
                _signReceive(pk, user, address(vault), 10e6, 0, block.timestamp + 1 hours, nonce);
            vm.prank(relayer);
            vm.expectRevert(NavyVault.EnforcedPause.selector);
            vault.depositWithAuthorization(user, 10e6, 0, block.timestamp + 1 hours, nonce, v, r, s);
        }

        // Deploying idle into an adapter blocked.
        vm.prank(allocator);
        vm.expectRevert(NavyVault.EnforcedPause.selector);
        vault.deployToAdapter(address(adapterA), 10e6);

        // Exit remains open: the earlier depositor can still redeem.
        uint256 shares = vault.balanceOf(user);
        vm.prank(user);
        uint256 assets = vault.redeem(shares, user, user);
        assertEq(assets, 100e6);
        assertEq(vault.balanceOf(user), 0);
    }

    function test_reallocate_stillWorks_afterReentrancyGuard() public {
        _depositAs(0xBEEF, 100e6, keccak256("realloc-b"));
        vm.startPrank(allocator);
        vault.deployToAdapter(address(adapterA), 80e6);
        vault.reallocate(address(adapterA), address(adapterB), 50e6);
        vm.stopPrank();
        assertEq(adapterA.totalAssets(), 30e6);
        assertEq(adapterB.totalAssets(), 50e6);
        assertEq(vault.totalAssets(), 100e6);
    }
}
