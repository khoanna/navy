// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";

/// @title Mock USDC for gas testing
contract GasTestUSDC {
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

    function forceApprove(address spender, uint256 value) external {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 available = allowance[from][msg.sender];
        if (available != type(uint256).max) {
            require(available >= value, "insufficient allowance");
            allowance[from][msg.sender] = available - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

/// @title Mock Strategy Adapter for gas testing
contract GasTestAdapter {
    address public immutable vaultAddress;
    address public immutable assetAddress;
    bytes32 public configuration;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;
    uint256 public maxDeploy = type(uint256).max;
    mapping(address => uint256) public rewards;
    address[] private _rewardTokens = new address[](0);

    constructor(address vault_, address asset_, bytes32 config_) {
        vaultAddress = vault_;
        assetAddress = asset_;
        configuration = config_;
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

    function setMaxDeploy(uint256 max_) external {
        maxDeploy = max_;
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

    function sync() external view returns (uint256) {
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets;
    }

    function maxDeployable() external view returns (uint256) {
        return maxDeploy;
    }

    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    function claimableReward(address) external view returns (uint256) {
        return 0;
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
        GasTestUSDC(assetAddress).transfer(vaultAddress, returnedAssets);
    }
}

/// @title Base contract for gas tests with shared setup
contract VaultGasTestBase is Test {
    GasTestUSDC public usdc;
    NavyVaultSRCLA public vault;
    GasTestAdapter[] public adapters;

    address public admin;
    address public allocator;
    address public user;

    function setUpBase(uint8 adapterCount) internal {
        usdc = new GasTestUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));

        admin = address(0xA11CE);
        allocator = address(0xB0B5);
        user = address(0xC0FFEE);

        // Grant roles using DEFAULT_ADMIN_ROLE (which is the admin of both ADMIN_ROLE and ALLOCATOR_ROLE)
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        // Register adapters
        for (uint8 i = 0; i < adapterCount; i++) {
            GasTestAdapter adapter = new GasTestAdapter(
                address(vault),
                address(usdc),
                keccak256(abi.encode("adapter", i))
            );
            adapters.push(adapter);

            vm.prank(admin);
            vault.registerAdapter(address(adapter), 5000, 100, string(abi.encode("Adapter", i)));
        }

        // Fund vault with initial liquidity
        usdc.mint(address(vault), 10_000_000_000 * (10 ** 6)); // 10,000 USDC
    }

    function dealUserUSDC(uint256 amount) internal {
        usdc.mint(user, amount);
        vm.prank(user);
        usdc.approve(address(vault), amount);
    }

    function setupUserShares(uint256 depositAmount) internal returns (uint256 shares) {
        dealUserUSDC(depositAmount);
        vm.prank(user);
        shares = vault.deposit(depositAmount, user);
    }

    function executeDeployPlan(uint8 adapterIndex, uint256 amount) internal {
        address adapter = address(adapters[adapterIndex]);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256(abi.encode("deploy", block.timestamp, adapterIndex))),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: adapter,
            amount: amount,
            minOut: 0,
            dataHash: bytes32(0)
        });

        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: action.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("snapshot"),
            decisionHash: keccak256("decision"),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });

        vm.startPrank(allocator);
        vault.submitPlan(header, vault.hashPlanAction(vault.planDomain(header), action));
        vault.executeNextActionWithProof(new bytes32[](0), action);
        vm.stopPrank();
    }

    function executeDivestPlan(uint8 adapterIndex, uint256 amount) internal {
        address adapter = address(adapters[adapterIndex]);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256(abi.encode("divest", block.timestamp, adapterIndex))),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: adapter,
            amount: amount,
            minOut: 0,
            dataHash: bytes32(0)
        });

        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: action.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("snapshot"),
            decisionHash: keccak256("decision"),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });

        vm.startPrank(allocator);
        vault.submitPlan(header, vault.hashPlanAction(vault.planDomain(header), action));
        vault.executeNextActionWithProof(new bytes32[](0), action);
        vm.stopPrank();
    }
}

// ========================================
// Tests for 0 Adapters
// ========================================

contract VaultGasTest0Adapters is VaultGasTestBase {
    function setUp() public {
        setUpBase(0);
    }

    function test_gas_deposit_0adapters() public {
        dealUserUSDC(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        usdc.approve(address(vault), 1000e6);
        vm.prank(user);
        vault.deposit(1000e6, user);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (deposit, 0 adapters)", gasUsed);
        assertLt(gasUsed, 250_000, "deposit gas should be under budget");
    }

    function test_gas_mint_0adapters() public {
        uint256 assetsNeeded = vault.previewMint(1000e6);
        dealUserUSDC(assetsNeeded + 100);

        uint256 gasStart = gasleft();
        vm.prank(user);
        usdc.approve(address(vault), assetsNeeded);
        vm.prank(user);
        vault.mint(1000e6, user);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (mint, 0 adapters)", gasUsed);
        assertLt(gasUsed, 250_000, "mint gas should be under budget");
    }

    function test_gas_withdraw_0adapters() public {
        uint256 shares = setupUserShares(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        uint256 assets = vault.maxWithdraw(user);
        if (assets > 0) {
            vault.withdraw(assets, user, user);
        }
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (withdraw, 0 adapters)", gasUsed);
        assertLt(gasUsed, 350_000, "withdraw gas should be under budget");
    }

    function test_gas_redeem_0adapters() public {
        uint256 shares = setupUserShares(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        if (shares > 0) {
            vault.redeem(shares, user, user);
        }
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (redeem, 0 adapters)", gasUsed);
        assertLt(gasUsed, 350_000, "redeem gas should be under budget");
    }
}

// ========================================
// Tests for 1 Adapter
// ========================================

contract VaultGasTest1Adapter is VaultGasTestBase {
    function setUp() public {
        setUpBase(1);
    }

    function test_gas_deposit_1adapter() public {
        dealUserUSDC(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        usdc.approve(address(vault), 1000e6);
        vm.prank(user);
        vault.deposit(1000e6, user);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (deposit, 1 adapter)", gasUsed);
        assertLt(gasUsed, 270_000, "deposit gas should be under budget");
    }

    function test_gas_mint_1adapter() public {
        uint256 assetsNeeded = vault.previewMint(1000e6);
        dealUserUSDC(assetsNeeded + 100);

        uint256 gasStart = gasleft();
        vm.prank(user);
        usdc.approve(address(vault), assetsNeeded);
        vm.prank(user);
        vault.mint(1000e6, user);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (mint, 1 adapter)", gasUsed);
        assertLt(gasUsed, 270_000, "mint gas should be under budget");
    }

    function test_gas_withdraw_1adapter() public {
        setupUserShares(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        uint256 assets = vault.maxWithdraw(user);
        if (assets > 0) {
            vault.withdraw(assets, user, user);
        }
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (withdraw, 1 adapter)", gasUsed);
        assertLt(gasUsed, 370_000, "withdraw gas should be under budget");
    }

    function test_gas_redeem_1adapter() public {
        uint256 shares = setupUserShares(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        if (shares > 0) {
            vault.redeem(shares, user, user);
        }
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (redeem, 1 adapter)", gasUsed);
        assertLt(gasUsed, 370_000, "redeem gas should be under budget");
    }

    function test_gas_planDeploy_1adapter() public {
        uint256 gasStart = gasleft();
        executeDeployPlan(0, 500e6);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (plan deploy, 1 adapter)", gasUsed);
        assertLt(gasUsed, 500_000, "plan deploy gas should be under budget");
    }

    function test_gas_planDivest_1adapter() public {
        // First deploy
        executeDeployPlan(0, 500e6);

        uint256 gasStart = gasleft();
        executeDivestPlan(0, 500e6);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (plan divest, 1 adapter)", gasUsed);
        assertLt(gasUsed, 400_000, "plan divest gas should be under budget");
    }
}

// ========================================
// Tests for 3 Adapters
// ========================================

contract VaultGasTest3Adapters is VaultGasTestBase {
    function setUp() public {
        setUpBase(3);
    }

    function test_gas_deposit_3adapters() public {
        dealUserUSDC(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        usdc.approve(address(vault), 1000e6);
        vm.prank(user);
        vault.deposit(1000e6, user);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (deposit, 3 adapters)", gasUsed);
        assertLt(gasUsed, 300_000, "deposit gas should be under budget");
    }

    function test_gas_mint_3adapters() public {
        uint256 assetsNeeded = vault.previewMint(1000e6);
        dealUserUSDC(assetsNeeded + 100);

        uint256 gasStart = gasleft();
        vm.prank(user);
        usdc.approve(address(vault), assetsNeeded);
        vm.prank(user);
        vault.mint(1000e6, user);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (mint, 3 adapters)", gasUsed);
        assertLt(gasUsed, 300_000, "mint gas should be under budget");
    }

    function test_gas_withdraw_3adapters() public {
        setupUserShares(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        uint256 assets = vault.maxWithdraw(user);
        if (assets > 0) {
            vault.withdraw(assets, user, user);
        }
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (withdraw, 3 adapters)", gasUsed);
        assertLt(gasUsed, 400_000, "withdraw gas should be under budget");
    }

    function test_gas_redeem_3adapters() public {
        uint256 shares = setupUserShares(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        if (shares > 0) {
            vault.redeem(shares, user, user);
        }
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (redeem, 3 adapters)", gasUsed);
        assertLt(gasUsed, 400_000, "redeem gas should be under budget");
    }

    function test_gas_planDeploy_3adapters() public {
        uint256 gasStart = gasleft();
        executeDeployPlan(1, 500e6);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (plan deploy, 3 adapters)", gasUsed);
        assertLt(gasUsed, 550_000, "plan deploy gas should be under budget");
    }

    function test_gas_planDivest_3adapters() public {
        // Deploy to all 3 adapters
        executeDeployPlan(0, 200e6);
        executeDeployPlan(1, 200e6);
        executeDeployPlan(2, 200e6);

        uint256 gasStart = gasleft();
        executeDivestPlan(1, 200e6);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (plan divest, 3 adapters)", gasUsed);
        assertLt(gasUsed, 430_000, "plan divest gas should be under budget");
    }

    function test_gas_emergencyExit_3adapters() public {
        // Deploy to adapter
        executeDeployPlan(0, 500e6);

        uint256 gasStart = gasleft();
        vm.prank(admin);
        vault.emergencyExit(address(adapters[0]));
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (emergency exit, 3 adapters)", gasUsed);
        assertLt(gasUsed, 430_000, "emergency exit gas should be under budget");
    }
}

// ========================================
// Tests for 16 Adapters (MAX)
// ========================================

contract VaultGasTest16Adapters is VaultGasTestBase {
    function setUp() public {
        setUpBase(16);
    }

    function test_gas_deposit_16adapters() public {
        dealUserUSDC(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        usdc.approve(address(vault), 1000e6);
        vm.prank(user);
        vault.deposit(1000e6, user);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (deposit, 16 adapters)", gasUsed);
        assertLt(gasUsed, 400_000, "deposit gas should be under budget");
    }

    function test_gas_mint_16adapters() public {
        uint256 assetsNeeded = vault.previewMint(1000e6);
        dealUserUSDC(assetsNeeded + 100);

        uint256 gasStart = gasleft();
        vm.prank(user);
        usdc.approve(address(vault), assetsNeeded);
        vm.prank(user);
        vault.mint(1000e6, user);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (mint, 16 adapters)", gasUsed);
        assertLt(gasUsed, 400_000, "mint gas should be under budget");
    }

    function test_gas_withdraw_16adapters() public {
        setupUserShares(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        uint256 assets = vault.maxWithdraw(user);
        if (assets > 0) {
            vault.withdraw(assets, user, user);
        }
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (withdraw, 16 adapters)", gasUsed);
        assertLt(gasUsed, 550_000, "withdraw gas should be under budget");
    }

    function test_gas_redeem_16adapters() public {
        uint256 shares = setupUserShares(1000e6);

        uint256 gasStart = gasleft();
        vm.prank(user);
        if (shares > 0) {
            vault.redeem(shares, user, user);
        }
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (redeem, 16 adapters)", gasUsed);
        assertLt(gasUsed, 550_000, "redeem gas should be under budget");
    }

    function test_gas_planDeploy_16adapters() public {
        uint256 gasStart = gasleft();
        executeDeployPlan(8, 500e6);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (plan deploy, 16 adapters)", gasUsed);
        assertLt(gasUsed, 900_000, "plan deploy gas should be under budget");
    }

    function test_gas_planDivest_16adapters() public {
        // Deploy to middle adapter
        executeDeployPlan(8, 500e6);

        uint256 gasStart = gasleft();
        executeDivestPlan(8, 500e6);
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (plan divest, 16 adapters)", gasUsed);
        assertLt(gasUsed, 550_000, "plan divest gas should be under budget");
    }

    function test_gas_emergencyExit_16adapters() public {
        // Deploy to adapter
        executeDeployPlan(8, 500e6);

        uint256 gasStart = gasleft();
        vm.prank(admin);
        vault.emergencyExit(address(adapters[8]));
        uint256 gasUsed = gasStart - gasleft();

        emit log_named_uint("Gas used (emergency exit, 16 adapters)", gasUsed);
        assertLt(gasUsed, 550_000, "emergency exit gas should be under budget");
    }
}

// ========================================
// Snapshot tests - run with forge snapshot
// ========================================

contract VaultGasSnapshotTest is VaultGasTestBase {
    function setUp() public {
        usdc = new GasTestUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));

        admin = address(0xA11CE);
        allocator = address(0xB0B5);
        user = address(0xC0FFEE);

        GasTestAdapter adapter = new GasTestAdapter(address(vault), address(usdc), keccak256("adapter"));
        adapters.push(adapter);

        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        vm.prank(admin);
        vault.registerAdapter(address(adapter), 5000, 100, "Test Adapter");

        usdc.mint(user, 1_000_000_000 * (10 ** 6));
        usdc.mint(address(vault), 10_000_000_000 * (10 ** 6));
    }

    function testGas_deposit() public {
        usdc.mint(user, 1000e6);
        vm.prank(user);
        usdc.approve(address(vault), 1000e6);
        vm.prank(user);
        vault.deposit(1000e6, user);
    }

    function testGas_mint() public {
        uint256 assets = vault.previewMint(1000e6);
        usdc.mint(user, assets + 100);
        vm.prank(user);
        usdc.approve(address(vault), assets + 100);
        vm.prank(user);
        vault.mint(1000e6, user);
    }

    function testGas_withdraw() public {
        usdc.mint(user, 1000e6);
        vm.prank(user);
        usdc.approve(address(vault), 1000e6);
        vm.prank(user);
        vault.deposit(1000e6, user);

        vm.prank(user);
        uint256 maxAssets = vault.maxWithdraw(user);
        if (maxAssets > 0) {
            vault.withdraw(maxAssets, user, user);
        }
    }

    function testGas_redeem() public {
        usdc.mint(user, 1000e6);
        vm.prank(user);
        usdc.approve(address(vault), 1000e6);
        vm.prank(user);
        uint256 shares = vault.deposit(1000e6, user);

        vm.prank(user);
        vault.redeem(shares, user, user);
    }

    function testGas_planDeploy() public {
        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("deploy-plan")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapters[0]),
            amount: 500e6,
            minOut: 500e6,
            dataHash: bytes32(0)
        });

        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: action.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("snapshot"),
            decisionHash: keccak256("decision"),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });

        vm.startPrank(allocator);
        vault.submitPlan(header, vault.hashPlanAction(vault.planDomain(header), action));
        vault.executeNextActionWithProof(new bytes32[](0), action);
        vm.stopPrank();
    }

    function testGas_planDivest() public {
        // First deploy
        {
            NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
                planId: uint256(keccak256("deploy-plan")),
                index: 0,
                kind: NavyVaultSRCLA.ActionKind.Deploy,
                adapter: address(adapters[0]),
                amount: 500e6,
                minOut: 500e6,
                dataHash: bytes32(0)
            });

            VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
                planId: action.planId,
                policyVersion: 1,
                createdAt: uint64(block.timestamp),
                expiresAt: uint64(block.timestamp + 1 hours),
                actionCount: 1,
                snapshotBlockNumber: block.number,
                snapshotHash: keccak256("snapshot"),
                decisionHash: keccak256("decision"),
                configurationDigest: vault.currentConfigurationDigest(),
                reserve: 0,
                minFinalAssets: 0,
                maxRecognizedLoss: type(uint256).max,
                turnoverLimit: type(uint256).max
            });

            vm.startPrank(allocator);
            vault.submitPlan(header, vault.hashPlanAction(vault.planDomain(header), action));
            vault.executeNextActionWithProof(new bytes32[](0), action);
            vm.stopPrank();
        }

        // Then divest
        {
            NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
                planId: uint256(keccak256("divest-plan")),
                index: 0,
                kind: NavyVaultSRCLA.ActionKind.Divest,
                adapter: address(adapters[0]),
                amount: 500e6,
                minOut: 500e6,
                dataHash: bytes32(0)
            });

            VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
                planId: action.planId,
                policyVersion: 1,
                createdAt: uint64(block.timestamp),
                expiresAt: uint64(block.timestamp + 1 hours),
                actionCount: 1,
                snapshotBlockNumber: block.number,
                snapshotHash: keccak256("snapshot"),
                decisionHash: keccak256("decision"),
                configurationDigest: vault.currentConfigurationDigest(),
                reserve: 0,
                minFinalAssets: 0,
                maxRecognizedLoss: type(uint256).max,
                turnoverLimit: type(uint256).max
            });

            vm.startPrank(allocator);
            vault.submitPlan(header, vault.hashPlanAction(vault.planDomain(header), action));
            vault.executeNextActionWithProof(new bytes32[](0), action);
            vm.stopPrank();
        }
    }

    function testGas_emergencyExit() public {
        // First deploy
        {
            NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
                planId: uint256(keccak256("deploy-plan")),
                index: 0,
                kind: NavyVaultSRCLA.ActionKind.Deploy,
                adapter: address(adapters[0]),
                amount: 500e6,
                minOut: 500e6,
                dataHash: bytes32(0)
            });

            VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
                planId: action.planId,
                policyVersion: 1,
                createdAt: uint64(block.timestamp),
                expiresAt: uint64(block.timestamp + 1 hours),
                actionCount: 1,
                snapshotBlockNumber: block.number,
                snapshotHash: keccak256("snapshot"),
                decisionHash: keccak256("decision"),
                configurationDigest: vault.currentConfigurationDigest(),
                reserve: 0,
                minFinalAssets: 0,
                maxRecognizedLoss: type(uint256).max,
                turnoverLimit: type(uint256).max
            });

            vm.startPrank(allocator);
            vault.submitPlan(header, vault.hashPlanAction(vault.planDomain(header), action));
            vault.executeNextActionWithProof(new bytes32[](0), action);
            vm.stopPrank();
        }

        vm.prank(admin);
        vault.emergencyExit(address(adapters[0]));
    }
}
