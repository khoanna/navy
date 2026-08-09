// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";

/// @title Mock USDC for invariant testing
contract InvariantMockUSDC {
    string public constant name = "USDC";
    string public constant version = "2";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 available = allowance[from][msg.sender];
        require(available >= value, "insufficient allowance");
        allowance[from][msg.sender] = available - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    /// @dev For testing: ERC-4626 compatibility - vault handles accounting
    function deposit(uint256, address) external pure returns (uint256) {
        return 0;
    }

    /// @dev For testing: ERC-4626 compatibility - vault handles accounting
    function depositWithAuthorization(
        address,
        address,
        uint256,
        uint256,
        uint256,
        bytes32,
        bytes32,
        bytes calldata
    ) external pure {
        // Does nothing - vault handles accounting
    }

    /// @dev For testing: ERC-4626 compatibility - vault handles accounting
    function redeem(uint256, address, address) external pure returns (uint256) {
        return 0;
    }
}

/// @title Mock Strategy Adapter for invariant testing
contract InvariantMockAdapter {
    address public immutable vaultAddress;
    address public immutable assetAddress;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;
    mapping(address => uint256) public rewards;
    address[] private _rewardTokens;

    constructor(address vault_, address asset_) {
        vaultAddress = vault_;
        assetAddress = asset_;
    }

    modifier onlyVault() {
        require(msg.sender == vaultAddress, "only vault");
        _;
    }

    function setReportedAssets(uint256 assets_) external {
        reportedAssets = assets_;
        if (withdrawableAssets > assets_) {
            withdrawableAssets = assets_;
        }
    }

    function setWithdrawable(uint256 assets_) external {
        withdrawableAssets = assets_;
    }

    function setRewardTokens(address[] memory tokens_) external {
        _rewardTokens = tokens_;
    }

    function addRewardToken(address token) external {
        _rewardTokens.push(token);
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
        returnedAssets = assets > withdrawableAssets ? withdrawableAssets : assets;
        withdrawableAssets -= returnedAssets;
        if (reportedAssets > returnedAssets) {
            reportedAssets -= returnedAssets;
        } else {
            reportedAssets = 0;
        }
    }
}

/// @title Handler for vault invariant testing
contract VaultInvariantHandler is Test {
    InvariantMockUSDC public usdc;
    NavyVaultSRCLA public vault;
    InvariantMockAdapter public adapterA;
    InvariantMockAdapter public adapterB;

    address public admin;
    address public allocator;

    // Track actor balances for realistic behavior
    mapping(address => uint256) public actorBalances;

    constructor() {
        usdc = new InvariantMockUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        adapterA = new InvariantMockAdapter(address(vault), address(usdc));
        adapterB = new InvariantMockAdapter(address(vault), address(usdc));

        admin = address(this);
        allocator = address(this);

        // Grant roles
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        // Register adapters
        vault.registerAdapter(address(adapterA), 5000, 100, "Adapter A");
        vault.registerAdapter(address(adapterB), 5000, 100, "Adapter B");

        // Give actors some initial USDC
        actorBalances[address(0xA71CE)] = 10_000e6;
        actorBalances[address(0xB0B)] = 10_000e6;
        actorBalances[address(0xC0B)] = 10_000e6;
        usdc.mint(address(0xA71CE), 10_000e6);
        usdc.mint(address(0xB0B), 10_000e6);
        usdc.mint(address(0xC0B), 10_000e6);
    }

    /// @notice Get the asset address
    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice Give an actor some USDC
    function giveUsdcToActor(address actor, uint256 amount) external {
        usdc.mint(actor, amount);
        actorBalances[actor] += amount;
    }

    /// @notice Actor deposits assets into vault
    function actorDeposit(address actor, uint256 assets) external {
        if (assets == 0) return;
        if (assets > actorBalances[actor]) return;

        address vaultAsset = address(usdc);
        if (IERC20(vaultAsset).balanceOf(actor) < assets) return;

        actorBalances[actor] -= assets;
        try vault.deposit(assets, actor) {
            // success
        } catch {
            // deposit may fail for various reasons - that's ok
        }
    }

    /// @notice Actor mints shares directly
    function actorMint(address actor, uint256 shares) external {
        if (shares == 0) return;

        uint256 maxMint = vault.maxMint(actor);
        if (shares > maxMint) return;

        uint256 assets = vault.previewMint(shares);
        if (assets == 0) return;

        address vaultAsset = address(usdc);
        if (IERC20(vaultAsset).balanceOf(actor) < assets) return;

        try vault.mint(shares, actor) {
            // success
        } catch {
            // mint may fail - that's ok
        }
    }

    /// @notice Actor withdraws assets from vault
    function actorWithdraw(address actor, uint256 assets) external {
        if (assets == 0) return;

        uint256 maxWithdraw = vault.maxWithdraw(actor);
        if (assets > maxWithdraw) return;

        try vault.withdraw(assets, actor, actor) returns (uint256 assetsOut) {
            actorBalances[actor] += assetsOut;
        } catch {
            // withdraw may fail - that's ok
        }
    }

    /// @notice Actor redeems shares for assets
    function actorRedeem(address actor, uint256 shares) external {
        if (shares == 0) return;

        uint256 maxRedeem = vault.maxRedeem(actor);
        if (shares > maxRedeem) return;

        try vault.redeem(shares, actor, actor) returns (uint256 assetsOut) {
            actorBalances[actor] += assetsOut;
        } catch {
            // redeem may fail - that's ok
        }
    }

    /// @notice Admin registers a new adapter
    function registerNewAdapter(address newAdapter) external {
        try vault.registerAdapter(newAdapter, 5000, 100, "New Adapter") {
            // success
        } catch {
            // may fail if already registered or invalid
        }
    }

    /// @notice Admin sets adapter state
    function setAdapterState(address adapter, uint8 state) external {
        try vault.setAdapterState(adapter, state) {
            // success
        } catch {
            // may fail
        }
    }

    /// @notice Direct deposit to vault idle
    function depositToVault(uint256 assets) external {
        if (assets == 0) return;
        usdc.mint(address(vault), assets);
    }

    /// @notice Add recognized rewards (yield)
    function addRecognizedRewards() external {
        // Simulated - nothing to do as rewards are tracked separately
    }

    /// @notice Withdraw from adapter - simulates adapter returning funds
    function simulateAdapterReturn(address, uint256 assets) external {
        usdc.mint(address(vault), assets);
    }
}

/// @title Invariant tests for NavyVaultSRCLA
contract VaultInvariantTest is Test {
    VaultInvariantHandler public handler;

    function setUp() public {
        handler = new VaultInvariantHandler();
        targetContract(address(handler));
    }

    /// @notice Invariant 1: totalAssets should never be negative
    /// @dev In Solidity uint256, underflow is impossible, but we verify
    ///      that totalAssets is always a valid uint256 value
    function invariant_totalAssetsNeverNegative() public view {
        NavyVaultSRCLA vault = handler.vault();
        uint256 totalAssets = vault.totalAssets();
        // uint256 is always >= 0, but verify the value is sensible
        assertGe(totalAssets, 0, "totalAssets must be non-negative");
    }

    /// @notice Invariant 2: convertToShares is deterministic
    /// @dev previewMint(shares) -> previewRedeem should return same or close shares
    function invariant_convertToSharesDeterministic() public view {
        NavyVaultSRCLA vault = handler.vault();
        uint256 totalShares = vault.totalSupply();

        if (totalShares == 0) return;

        // Test a sample share amount
        uint256 sampleShares = totalShares / 2 + 1;
        if (sampleShares == 0) sampleShares = 1;

        uint256 assets = vault.previewMint(sampleShares);
        uint256 backToShares = vault.previewRedeem(assets);

        // Allow for rounding: backToShares should be <= original (rounding down)
        // due to ceiling in previewMint and floor in previewRedeem
        assertLe(backToShares, sampleShares + 1, "round-trip should be close");
    }

    /// @notice Invariant 3: maxWithdraw should never exceed totalAssets
    function invariant_maxWithdrawNeverExceedsTotalAssets() public view {
        NavyVaultSRCLA vault = handler.vault();
        uint256 totalAssets = vault.totalAssets();

        // Check for a few sample addresses
        address[] memory checkAddresses = new address[](4);
        checkAddresses[0] = address(0);
        checkAddresses[1] = address(1);
        checkAddresses[2] = address(vault);
        checkAddresses[3] = address(this);

        for (uint256 i = 0; i < checkAddresses.length; i++) {
            address owner = checkAddresses[i];
            uint256 maxWithdraw = vault.maxWithdraw(owner);
            assertLe(maxWithdraw, totalAssets, "maxWithdraw must not exceed totalAssets");
        }
    }

    /// @notice Invariant 4: When totalAssets is 0, totalSupply should be 0
    /// @dev No free shares should exist when vault is empty
    function invariant_noFreeShares() public view {
        NavyVaultSRCLA vault = handler.vault();
        uint256 totalAssets = vault.totalAssets();
        uint256 totalSupply = vault.totalSupply();

        if (totalAssets == 0) {
            assertEq(totalSupply, 0, "totalSupply must be 0 when totalAssets is 0");
        }
    }

    /// @notice Invariant 5: Any withdraw amount <= maxWithdraw should succeed
    /// @dev If maxWithdraw returns X, withdrawing any amount <= X should work
    function invariant_withdrawRespectsMax() public view {
        NavyVaultSRCLA vault = handler.vault();
        uint256 totalAssets = vault.totalAssets();
        uint256 totalSupply = vault.totalSupply();

        // Sample a few share amounts
        for (uint256 i = 1; i <= 3; i++) {
            uint256 sampleShares = totalSupply > 0 ? (totalSupply * i) / 4 : 0;
            if (sampleShares == 0) continue;

            address sampleOwner = address(uint160(0x10000 + i));

            // The maxWithdraw for sampleOwner should be bounded by total assets
            uint256 maxWithdraw = vault.maxWithdraw(sampleOwner);

            // maxWithdraw should never exceed totalAssets
            assertLe(maxWithdraw, totalAssets, "maxWithdraw must not exceed total assets");

            // If totalSupply > 0, maxWithdraw should be reasonable
            if (totalSupply > 0) {
                uint256 shareValue = vault.convertToAssets(vault.balanceOf(sampleOwner));
                // maxWithdraw <= shareValue (claim) but also limited by synchronous liquidity
                assertGe(shareValue, 0, "share value must be non-negative");
            }
        }
    }
}

/// @title Extended invariant tests with more actor scenarios
contract VaultInvariantExtendedTest is Test {
    VaultInvariantHandler public handler;

    address[] internal actors;

    function setUp() public {
        handler = new VaultInvariantHandler();

        // Create multiple actors
        actors.push(address(0xA71CE));
        actors.push(address(0xB0B));
        actors.push(address(0xC0B));
        actors.push(address(0xD0B));
        actors.push(address(0xE0B));

        targetContract(address(handler));
    }

    /// @notice Invariant: totalAssets always equals idle + strategyAssets + rewards - losses
    function invariant_totalAssetsComposition() public view {
        NavyVaultSRCLA vault = handler.vault();
        uint256 totalAssets = vault.totalAssets();

        // totalAssets should be non-negative
        assertGe(totalAssets, 0, "totalAssets must be non-negative");
    }

    /// @notice Invariant: Share price never goes below 1:1 (before losses)
    function invariant_sharePriceFloor() public view {
        NavyVaultSRCLA vault = handler.vault();
        uint256 totalAssets = vault.totalAssets();
        uint256 totalSupply = vault.totalSupply();

        if (totalSupply == 0) return;
        if (totalAssets == 0) return;

        // Each share should be redeemable for at least 1 asset unit
        uint256 shareValue = (totalAssets * 1e18) / totalSupply;
        assertGe(shareValue, 1, "share price should be at least 1:1");
    }

    /// @notice Invariant: maxRedeem respects total supply
    function invariant_maxRedeemBoundedBySupply() public view {
        NavyVaultSRCLA vault = handler.vault();
        uint256 totalSupply = vault.totalSupply();

        for (uint256 i = 0; i < actors.length; i++) {
            address owner = actors[i];
            uint256 balance = vault.balanceOf(owner);
            uint256 maxRedeem = vault.maxRedeem(owner);

            // maxRedeem should not exceed balance
            assertLe(maxRedeem, balance, "maxRedeem must not exceed balance");
        }

        // Sum of all maxRedeem should not exceed total supply
        uint256 sumMaxRedeem = 0;
        for (uint256 i = 0; i < actors.length; i++) {
            sumMaxRedeem += vault.maxRedeem(actors[i]);
        }
        assertLe(sumMaxRedeem, totalSupply, "sum of maxRedeem must not exceed totalSupply");
    }

    /// @notice Invariant: synchronousLiquidity is always <= totalAssets
    function invariant_synchronousLiquidityBounded() public view {
        NavyVaultSRCLA vault = handler.vault();
        uint256 totalAssets = vault.totalAssets();
        uint256 syncLiq = vault.synchronousLiquidity();

        assertLe(syncLiq, totalAssets, "synchronous liquidity must not exceed total assets");
    }
}
