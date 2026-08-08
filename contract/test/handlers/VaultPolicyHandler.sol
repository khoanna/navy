// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {NavyVault} from "../../src/NavyVault.sol";
import {IStrategyAdapter} from "../../src/interfaces/IStrategyAdapter.sol";

contract PolicyBaseUsdc is ERC20 {
    constructor() ERC20("Base USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract NavyVaultPolicyHarness is NavyVault {
    constructor(IERC20 asset_, address owner_, address allocator_) NavyVault(asset_, owner_, allocator_) {}

    function setActivePlanReserveForTest(uint256 reserve_) external {
        activePlanReserve = reserve_;
    }
}

contract PolicyStrategyAdapter is IStrategyAdapter {
    using SafeERC20 for IERC20;

    address public immutable vaultAddress;
    address public immutable assetAddress;
    bytes32 public configuration;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;
    uint16 public withdrawLossBps;
    uint256 public withdrawLossBase;

    error NotVault();

    constructor(address vault_, address asset_, bytes32 configuration_) {
        vaultAddress = vault_;
        assetAddress = asset_;
        configuration = configuration_;
    }

    modifier onlyVault() {
        if (msg.sender != vaultAddress) revert NotVault();
        _;
    }

    function setConfigurationDigest(bytes32 configuration_) external {
        configuration = configuration_;
    }

    function setReportedAssets(uint256 assets_) external {
        reportedAssets = assets_;
        if (withdrawableAssets > assets_) {
            withdrawableAssets = assets_;
        }
    }

    function setMaxWithdrawable(uint256 assets_) external {
        withdrawableAssets = assets_;
    }

    function setWithdrawLoss(uint16 bps, uint256 baseLoss) external {
        withdrawLossBps = bps;
        withdrawLossBase = baseLoss;
    }

    function vault() external view returns (address) {
        return vaultAddress;
    }

    function asset() external view returns (address) {
        return assetAddress;
    }

    function configurationDigest() external view returns (bytes32) {
        return configuration;
    }

    function totalAssets() external view returns (uint256) {
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets;
    }

    function deposit(uint256 assets) external onlyVault returns (uint256 credited) {
        reportedAssets += assets;
        withdrawableAssets += assets;
        return assets;
    }

    function withdraw(uint256 assets) external onlyVault returns (uint256 returnedAssets) {
        uint256 availableAssets = Math.min(assets, withdrawableAssets);
        uint256 percentLoss = Math.mulDiv(availableAssets, withdrawLossBps, 10_000);
        uint256 totalLoss = percentLoss + withdrawLossBase;
        if (totalLoss > availableAssets) totalLoss = availableAssets;

        returnedAssets = availableAssets - totalLoss;
        withdrawableAssets -= availableAssets;
        if (reportedAssets > availableAssets) {
            reportedAssets -= availableAssets;
        } else {
            reportedAssets = 0;
        }

        IERC20(assetAddress).safeTransfer(vaultAddress, returnedAssets);
    }
}

contract VaultPolicyHandler is Test {
    using SafeERC20 for IERC20;

    bytes32 public constant PROTOCOL_GROUP = keccak256("protocol-group");
    bytes32 public constant COMMON_MODE_GROUP = keccak256("base-usdc-common-mode");

    PolicyBaseUsdc public immutable usdc;
    NavyVaultPolicyHarness public immutable vault;
    PolicyStrategyAdapter public immutable adapterA;
    PolicyStrategyAdapter public immutable adapterB;

    address public immutable admin;
    address public immutable allocator;
    address public immutable actor;

    constructor(
        PolicyBaseUsdc usdc_,
        NavyVaultPolicyHarness vault_,
        PolicyStrategyAdapter adapterA_,
        PolicyStrategyAdapter adapterB_,
        address admin_,
        address allocator_,
        address actor_
    ) {
        usdc = usdc_;
        vault = vault_;
        adapterA = adapterA_;
        adapterB = adapterB_;
        admin = admin_;
        allocator = allocator_;
        actor = actor_;
    }

    function deposit(uint96 amount) external {
        uint256 boundedAmount = bound(uint256(amount), 1e6, 250_000e6);
        usdc.mint(actor, boundedAmount);
        vm.startPrank(actor);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(boundedAmount, actor);
        vm.stopPrank();
    }

    function setAdminIdleFloor(uint96 floor) external {
        vm.prank(admin);
        vault.setAdminIdleFloor(bound(uint256(floor), 0, 250_000e6));
    }

    function setPlanReserve(uint96 reserve) external {
        vault.setActivePlanReserveForTest(bound(uint256(reserve), 0, 250_000e6));
    }

    function setAdapterALimits(uint16 capBps, uint96 absoluteCap) external {
        _setAdapterLimits(adapterA, capBps, absoluteCap);
    }

    function setAdapterBLimits(uint16 capBps, uint96 absoluteCap) external {
        _setAdapterLimits(adapterB, capBps, absoluteCap);
    }

    function setDependencyLimit(uint16 capBps, uint96 absoluteCap) external {
        uint256 nav = vault.totalAssets();
        uint256 exposure = vault.dependencyExposure(PROTOCOL_GROUP);
        uint256 requiredBps = nav == 0 ? 0 : Math.ceilDiv(exposure * 10_000, nav);
        uint16 boundedBps = uint16(bound(uint256(capBps), requiredBps, 10_000));
        uint256 boundedAbsoluteCap = bound(uint256(absoluteCap), exposure, 250_000e6);

        vm.prank(admin);
        vault.setDependencyCap(PROTOCOL_GROUP, boundedBps, boundedAbsoluteCap);
    }

    function setAdapterAExposure(uint96 desiredAssets) external {
        _setAdapterExposure(adapterA, desiredAssets, vault.strategyAssets(address(adapterB)));
    }

    function setAdapterBExposure(uint96 desiredAssets) external {
        _setAdapterExposure(adapterB, desiredAssets, vault.strategyAssets(address(adapterA)));
    }

    function redeem(uint16 shareBps) external {
        if (vault.dependencyExposure(PROTOCOL_GROUP) != 0) return;

        uint256 shareBalance = vault.balanceOf(actor);
        if (shareBalance == 0) return;

        uint256 shares = Math.mulDiv(shareBalance, bound(uint256(shareBps), 1, 10_000), 10_000);
        if (shares == 0) shares = 1;

        vm.prank(actor);
        vault.redeem(shares, actor, actor);
    }

    function _setAdapterLimits(PolicyStrategyAdapter adapter, uint16 capBps, uint96 absoluteCap) internal {
        uint256 nav = vault.totalAssets();
        uint256 currentAssets = vault.strategyAssets(address(adapter));
        uint256 requiredBps = nav == 0 ? 0 : Math.ceilDiv(currentAssets * 10_000, nav);
        uint16 boundedBps = uint16(bound(uint256(capBps), requiredBps, 10_000));
        uint256 boundedAbsoluteCap = bound(uint256(absoluteCap), currentAssets, 250_000e6);

        vm.prank(admin);
        vault.setAdapterLimits(address(adapter), boundedBps, boundedAbsoluteCap, 0, type(uint256).max);
    }

    function _setAdapterExposure(PolicyStrategyAdapter adapter, uint96 desiredAssets, uint256 otherExposure) internal {
        uint256 nav = vault.totalAssets();
        if (nav == 0) return;

        uint256 maxAdapterExposure = vault.effectiveAdapterCap(address(adapter));
        uint256 maxDependencyExposure = vault.dependencyCap(PROTOCOL_GROUP);
        uint256 groupHeadroom = maxDependencyExposure > otherExposure ? maxDependencyExposure - otherExposure : 0;
        uint256 boundedDesired = bound(uint256(desiredAssets), 0, Math.min(maxAdapterExposure, groupHeadroom));
        uint256 currentAssets = vault.strategyAssets(address(adapter));

        if (boundedDesired > currentAssets) {
            uint256 increase = boundedDesired - currentAssets;
            uint256 idle = usdc.balanceOf(address(vault));
            if (idle < increase) {
                usdc.mint(address(vault), increase - idle);
            }
            vm.prank(address(vault));
            usdc.transfer(address(adapter), increase);
        } else if (currentAssets > boundedDesired) {
            vm.prank(address(adapter));
            usdc.transfer(address(vault), currentAssets - boundedDesired);
        }

        adapter.setReportedAssets(boundedDesired);
        adapter.setMaxWithdrawable(boundedDesired);
    }
}
