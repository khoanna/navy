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

    function syncRewardAccountantForTest(bool issuingShares) external {
        _syncRewardAccountant(issuingShares);
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

    address[] private _rewardTokens;
    mapping(address => uint256) public rewards;

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

    function setRewardTokens(address[] memory tokens_) external {
        _rewardTokens = tokens_;
    }

    function setClaimableReward(address token, uint256 amount) external {
        rewards[token] = amount;
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

    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    function claimableReward(address token) external view returns (uint256) {
        return rewards[token];
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
        uint16 boundedBps = uint16(bound(uint256(capBps), 0, 12_000));
        uint256 boundedAbsoluteCap = bound(uint256(absoluteCap), 0, 250_000e6);

        vm.prank(admin);
        uint256 nav = vault.totalAssets();
        uint256 exposure = vault.dependencyExposure(PROTOCOL_GROUP);
        uint256 effectiveCap =
            boundedBps > 10_000 ? 0 : Math.min(Math.mulDiv(nav, boundedBps, 10_000), boundedAbsoluteCap);
        if (boundedBps > 10_000) {
            vm.expectRevert(NavyVault.InvalidDependencyCap.selector);
            vault.setDependencyCap(PROTOCOL_GROUP, boundedBps, boundedAbsoluteCap);
        } else if (exposure > effectiveCap) {
            vm.expectRevert(NavyVault.DependencyCapExceeded.selector);
            vault.setDependencyCap(PROTOCOL_GROUP, boundedBps, boundedAbsoluteCap);
        } else {
            vault.setDependencyCap(PROTOCOL_GROUP, boundedBps, boundedAbsoluteCap);
        }
    }

    function setAdapterAExposure(uint96 desiredAssets) external {
        _setAdapterExposure(adapterA, desiredAssets);
    }

    function setAdapterBExposure(uint96 desiredAssets) external {
        _setAdapterExposure(adapterB, desiredAssets);
    }

    function redeem(uint16 shareBps) external {
        uint256 shareBalance = vault.balanceOf(actor);
        if (shareBalance == 0) return;

        uint256 shares = Math.mulDiv(shareBalance, bound(uint256(shareBps), 1, 10_000), 10_000);
        if (shares == 0) shares = 1;
        uint256 assets = vault.previewRedeem(shares);
        _normalizeExposureForProjectedNav(assets);

        vm.prank(actor);
        vault.redeem(shares, actor, actor);
    }

    function _setAdapterLimits(PolicyStrategyAdapter adapter, uint16 capBps, uint96 absoluteCap) internal {
        uint16 boundedBps = uint16(bound(uint256(capBps), 0, 12_000));
        uint256 boundedAbsoluteCap = bound(uint256(absoluteCap), 0, 250_000e6);

        vm.prank(admin);
        uint256 nav = vault.totalAssets();
        uint256 currentAssets = vault.strategyAssets(address(adapter));
        uint256 effectiveCap =
            boundedBps > 10_000 ? 0 : Math.min(Math.mulDiv(nav, boundedBps, 10_000), boundedAbsoluteCap);
        if (boundedBps > 10_000) {
            vm.expectRevert(NavyVault.InvalidAdapterStatus.selector);
            vault.setAdapterLimits(address(adapter), boundedBps, boundedAbsoluteCap, 0, type(uint256).max);
        } else if (currentAssets > effectiveCap) {
            vm.expectRevert(NavyVault.AdapterCapExceeded.selector);
            vault.setAdapterLimits(address(adapter), boundedBps, boundedAbsoluteCap, 0, type(uint256).max);
        } else {
            vault.setAdapterLimits(address(adapter), boundedBps, boundedAbsoluteCap, 0, type(uint256).max);
        }
    }

    function _setAdapterExposure(PolicyStrategyAdapter adapter, uint96 desiredAssets) internal {
        uint256 nav = vault.totalAssets();
        if (nav == 0) return;

        uint256 boundedDesired = bound(uint256(desiredAssets), 0, 250_000e6);
        bytes4 expectedRevert = _expectedProjectedRevert(adapter, boundedDesired);
        if (expectedRevert != bytes4(0)) {
            vm.expectRevert(expectedRevert);
            vault.validateProjectedDeployment(address(adapter), boundedDesired);
            return;
        }

        vault.validateProjectedDeployment(address(adapter), boundedDesired);
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

    function _normalizeExposureForProjectedNav(uint256 assetsOut) internal {
        uint256 nav = vault.totalAssets();
        uint256 projectedNav = assetsOut >= nav ? 0 : nav - assetsOut;

        uint256 adapterAAssets = vault.strategyAssets(address(adapterA));
        uint256 adapterBAssets = vault.strategyAssets(address(adapterB));

        uint256 adapterACap = _adapterCapForNav(address(adapterA), projectedNav);
        uint256 adapterBCap = _adapterCapForNav(address(adapterB), projectedNav);

        if (adapterAAssets > adapterACap) {
            adapterAAssets = adapterACap;
            _applyAdapterExposure(adapterA, adapterAAssets);
        }
        if (adapterBAssets > adapterBCap) {
            adapterBAssets = adapterBCap;
            _applyAdapterExposure(adapterB, adapterBAssets);
        }

        uint256 dependencyCap_ = _dependencyCapForNav(PROTOCOL_GROUP, projectedNav);
        uint256 dependencyExposure_ = adapterAAssets + adapterBAssets;
        if (dependencyExposure_ > dependencyCap_) {
            uint256 excess = dependencyExposure_ - dependencyCap_;
            uint256 reduceB = Math.min(adapterBAssets, excess);
            adapterBAssets -= reduceB;
            excess -= reduceB;
            if (reduceB != 0) _applyAdapterExposure(adapterB, adapterBAssets);
            if (excess != 0) {
                adapterAAssets -= excess;
                _applyAdapterExposure(adapterA, adapterAAssets);
            }
        }
    }

    function _applyAdapterExposure(PolicyStrategyAdapter adapter, uint256 desiredAssets) internal {
        uint256 currentAssets = vault.strategyAssets(address(adapter));

        if (desiredAssets > currentAssets) {
            uint256 increase = desiredAssets - currentAssets;
            uint256 idle = usdc.balanceOf(address(vault));
            if (idle < increase) {
                usdc.mint(address(vault), increase - idle);
            }
            vm.prank(address(vault));
            usdc.transfer(address(adapter), increase);
        } else if (currentAssets > desiredAssets) {
            vm.prank(address(adapter));
            usdc.transfer(address(vault), currentAssets - desiredAssets);
        }

        adapter.setReportedAssets(desiredAssets);
        adapter.setMaxWithdrawable(desiredAssets);
    }

    function _expectedProjectedRevert(PolicyStrategyAdapter adapter, uint256 projectedAssets)
        internal
        view
        returns (bytes4)
    {
        (, uint16 capBps, uint256 absoluteCap,,) = vault.adapterConfig(address(adapter));
        uint256 nav = vault.totalAssets();
        uint256 adapterCap = Math.min(Math.mulDiv(nav, capBps, 10_000), absoluteCap);
        if (projectedAssets > adapterCap) {
            return NavyVault.AdapterCapExceeded.selector;
        }

        bytes32[] memory dependencyIds = vault.adapterDependencies(address(adapter));
        uint256 currentAssets = vault.strategyAssets(address(adapter));
        for (uint256 i; i < dependencyIds.length; ++i) {
            bytes32 dependencyId = dependencyIds[i];
            uint256 dependencyHeadroom = _dependencyHeadroom(dependencyId, currentAssets);
            if (projectedAssets > dependencyHeadroom) {
                return NavyVault.DependencyCapExceeded.selector;
            }
        }

        return bytes4(0);
    }

    function _dependencyHeadroom(bytes32 dependencyId, uint256 currentAssets) internal view returns (uint256) {
        uint256 exposure = vault.dependencyExposure(dependencyId);
        uint256 cap = vault.dependencyCap(dependencyId);
        uint256 otherExposure = exposure > currentAssets ? exposure - currentAssets : 0;
        if (cap <= otherExposure) return 0;
        return cap - otherExposure;
    }

    function _adapterCapForNav(address adapter, uint256 nav) internal view returns (uint256) {
        (, uint16 capBps, uint256 absoluteCap,,) = vault.adapterConfig(adapter);
        return Math.min(Math.mulDiv(nav, capBps, 10_000), absoluteCap);
    }

    function _dependencyCapForNav(bytes32 dependencyId, uint256 nav) internal view returns (uint256) {
        (uint16 capBps, uint256 absoluteCap, bool configured) = vault.dependencyConfig(dependencyId);
        if (!configured) return type(uint256).max;
        return Math.min(Math.mulDiv(nav, capBps, 10_000), absoluteCap);
    }
}
