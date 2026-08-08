// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVault} from "../src/NavyVault.sol";
import {VaultTypes} from "../src/libraries/VaultTypes.sol";
import {MockRewardAccountant} from "./mocks/MockRewardAccountant.sol";
import {MockStrategyAdapter} from "./mocks/MockStrategyAdapter.sol";

contract MockBaseUsdc is ERC20 {
    constructor() ERC20("Base USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BaseNavyVaultTest is Test {
    MockBaseUsdc usdc;
    NavyVault vault;
    MockStrategyAdapter adapter;
    MockRewardAccountant rewardAccountant;

    address admin = address(0xA11CE);
    address allocator = address(0xA110CA7E);
    address alice = address(0xA71CE);
    address bob = address(0xB0B);

    function setUp() public {
        usdc = new MockBaseUsdc();
        vault = new NavyVault(IERC20(address(usdc)), admin, allocator);
        adapter = new MockStrategyAdapter(address(vault), address(usdc), keccak256("adapter-config"));
        rewardAccountant = new MockRewardAccountant();
    }

    function test_constructor_setsImmutableAssetAndRoles() public view {
        assertEq(vault.asset(), address(usdc));
        assertEq(vault.owner(), admin);
        assertEq(vault.allocator(), allocator);
        assertEq(vault.decimals(), 12);
    }

    function test_addAdapter_rejectsZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(NavyVault.ZeroAddress.selector);
        vault.addAdapter(address(0));
    }

    function test_addAdapter_rejectsMismatchedAsset() public {
        MockBaseUsdc otherUsdc = new MockBaseUsdc();
        MockStrategyAdapter wrongAsset =
            new MockStrategyAdapter(address(vault), address(otherUsdc), keccak256("wrong-asset"));

        vm.prank(admin);
        vm.expectRevert(NavyVault.InvalidAdapterAsset.selector);
        vault.addAdapter(address(wrongAsset));
    }

    function test_addAdapter_rejectsMismatchedVault() public {
        MockStrategyAdapter wrongVault =
            new MockStrategyAdapter(address(0xDEAD), address(usdc), keccak256("wrong-vault"));

        vm.prank(admin);
        vm.expectRevert(NavyVault.InvalidAdapterVault.selector);
        vault.addAdapter(address(wrongVault));
    }

    function test_addAdapter_rejectsZeroConfigurationDigest() public {
        MockStrategyAdapter zeroDigest = new MockStrategyAdapter(address(vault), address(usdc), bytes32(0));

        vm.prank(admin);
        vm.expectRevert(NavyVault.InvalidAdapterConfiguration.selector);
        vault.addAdapter(address(zeroDigest));
    }

    function test_addAdapter_rejectsDuplicateAdapter() public {
        _admitAdapter();

        vm.prank(admin);
        vm.expectRevert(NavyVault.AdapterExists.selector);
        vault.addAdapter(address(adapter));
    }

    function test_legacyRelayerSurface_isAbsent() public {
        vm.prank(admin);
        (bool ok,) = address(vault).call(abi.encodeWithSignature("setRelayer(address,bool)", alice, true));
        assertFalse(ok);
    }

    function test_legacyAllocatorCompatibilitySurface_isAbsent() public {
        vm.prank(admin);
        (bool ok,) = address(vault).call(abi.encodeWithSignature("setAllocator(address,bool)", bob, true));
        assertFalse(ok);
    }

    function test_legacyAdapterOverload_isAbsent() public {
        vm.prank(admin);
        (bool ok,) = address(vault)
            .call(abi.encodeWithSignature("addAdapter(address,uint16,uint16)", address(adapter), 5_000, 10_000));
        assertFalse(ok);
    }

    function test_twoStepOwnershipTransfer() public {
        vm.prank(admin);
        vault.transferOwnership(bob);

        assertEq(vault.pendingOwner(), bob);

        vm.prank(alice);
        vm.expectRevert(NavyVault.NotPendingOwner.selector);
        vault.acceptOwnership();

        vm.prank(bob);
        vault.acceptOwnership();

        assertEq(vault.owner(), bob);
        assertEq(vault.pendingOwner(), address(0));
    }

    function test_setAllocator_rotatesAllocator() public {
        vm.prank(admin);
        vault.setAllocator(bob);

        assertEq(vault.allocator(), bob);
    }

    function test_totalAssets_includesIdleStrategiesRewardsAndLoss() public {
        _admitAdapter();
        vm.prank(admin);
        vault.setRewardAccountant(address(rewardAccountant));

        usdc.mint(address(vault), 60_000e6);
        adapter.setReportedAssets(40_000e6);
        rewardAccountant.setRecognized(500e6);

        vm.prank(admin);
        vault.recordImpairment(address(adapter), 1_000e6);

        assertEq(vault.totalAssets(), 99_500e6);
    }

    function test_disabledAdapterRemainsInNav() public {
        _admitAdapter();
        adapter.setReportedAssets(40_000e6);

        vm.prank(admin);
        vault.setAdapterStatus(address(adapter), VaultTypes.AdapterStatus.Disabled);

        assertEq(vault.strategyAssets(address(adapter)), 40_000e6);
        assertEq(uint8(vault.adapterStatus(address(adapter))), uint8(VaultTypes.AdapterStatus.Disabled));
    }

    function test_removedAdapterRequiresZeroAccountedAndLiveAssets() public {
        _admitAdapter();
        adapter.setReportedAssets(40_000e6);

        vm.startPrank(admin);
        vault.setAdapterStatus(address(adapter), VaultTypes.AdapterStatus.Disabled);
        vault.setAdapterStatus(address(adapter), VaultTypes.AdapterStatus.Impaired);
        vm.expectRevert(NavyVault.AdapterNotEmpty.selector);
        vault.setAdapterStatus(address(adapter), VaultTypes.AdapterStatus.Removed);
        vm.stopPrank();

        assertEq(vault.configuredAdapters().length, 1);
        assertEq(uint8(vault.adapterStatus(address(adapter))), uint8(VaultTypes.AdapterStatus.Impaired));

        adapter.setReportedAssets(0);

        vm.prank(admin);
        vault.setAdapterStatus(address(adapter), VaultTypes.AdapterStatus.Removed);

        assertEq(vault.configuredAdapters().length, 0);
    }

    function test_revertingAdapterRead_cannotBypassRemovalSafety() public {
        _admitAdapter();
        adapter.setReportedAssets(40_000e6);

        vm.prank(admin);
        vault.setAdapterStatus(address(adapter), VaultTypes.AdapterStatus.Disabled);

        adapter.setRevertAssetReads(true);

        vm.prank(admin);
        vm.expectRevert(NavyVault.AdapterNotEmpty.selector);
        vault.setAdapterStatus(address(adapter), VaultTypes.AdapterStatus.Removed);
    }

    function test_recordImpairment_rejectsAmountsAboveRecognizedStrategyAssets() public {
        _admitAdapter();
        adapter.setReportedAssets(40_000e6);

        vm.prank(admin);
        vm.expectRevert(NavyVault.ImpairmentExceedsAssets.selector);
        vault.recordImpairment(address(adapter), 40_001e6);
    }

    function test_setRewardAccountant_replacesRecognizedValueSource() public {
        _admitAdapter();

        MockRewardAccountant replacement = new MockRewardAccountant();
        rewardAccountant.setRecognized(100e6);
        replacement.setRecognized(400e6);

        vm.startPrank(admin);
        vault.setRewardAccountant(address(rewardAccountant));
        assertEq(vault.totalAssets(), 100e6);
        vault.setRewardAccountant(address(replacement));
        vm.stopPrank();

        assertEq(vault.totalAssets(), 400e6);
    }

    function test_virtualShareOffset_preventsDonationInflationFromMintingZeroShares() public {
        usdc.mint(alice, 2e6);
        usdc.mint(bob, 1_000_001e6);

        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(alice);
        uint256 firstShares = vault.deposit(1e6, alice);

        vm.prank(bob);
        usdc.transfer(address(vault), 1_000_000e6);

        vm.prank(bob);
        uint256 secondShares = vault.deposit(1e6, bob);

        assertGt(firstShares, 0);
        assertGt(secondShares, 0);
    }

    function test_revertingAdapterRead_closesMaxDepositAndMaxMint() public {
        _admitAdapter();
        adapter.setRevertAssetReads(true);

        assertEq(vault.maxDeposit(alice), 0);
        assertEq(vault.maxMint(alice), 0);
    }

    function test_revertingRewardAccountantRead_closesMaxDepositAndMaxMint() public {
        vm.prank(admin);
        vault.setRewardAccountant(address(rewardAccountant));
        rewardAccountant.setRevertRecognizedRead(true);

        assertEq(vault.maxDeposit(alice), 0);
        assertEq(vault.maxMint(alice), 0);
    }

    function _admitAdapter() internal {
        vm.prank(admin);
        vault.addAdapter(address(adapter));
    }
}
