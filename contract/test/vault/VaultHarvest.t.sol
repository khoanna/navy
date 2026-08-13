// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {IRewardExecutor} from "../../src/interfaces/IRewardExecutor.sol";
import {IVaultEvents} from "../../src/interfaces/IVaultEvents.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";

/// @title Mock USDC for testing (6 decimals like real USDC)
contract MockUSDC {
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

/// @title Mock Reward Token (COMP, WELL, etc.)
contract MockRewardToken {
    string public name;
    string public symbol;
    uint8 public decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

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

/// @title Mock Strategy Adapter with reward tokens
contract MockAdapterWithRewards {
    address public immutable vaultAddress;
    address public immutable assetAddress;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;

    address[] private _rewardTokens;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public claimableAmounts;

    constructor(address vault_, address asset_, address[] memory rewardTokenList) {
        vaultAddress = vault_;
        assetAddress = asset_;
        _rewardTokens = rewardTokenList;
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

    function setClaimableReward(address token, uint256 amount) external {
        claimableAmounts[token] = amount;
        if (amount > 0) MockRewardToken(token).mint(vaultAddress, amount);
    }

    function addRewardToken(address token) external {
        _rewardTokens.push(token);
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

    function sync() external view returns (uint256) {
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets;
    }

    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    function claimableReward(address token) external view returns (uint256) {
        return claimableAmounts[token];
    }

    function configurationDigest() external view returns (bytes32) {
        return keccak256(abi.encode(vaultAddress, assetAddress, block.chainid));
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

/// @title Mock Reward Executor
/// @dev Simulates swapping 18-decimal reward tokens to 6-decimal USDC
contract MockRewardExecutor {
    bool public shouldFail;
    bytes32 public lastRouteId;
    uint256 public lastAmountIn;
    // SWAP_OUTPUT_SCALAR: 1e12 (converts 18-decimal token amounts to 6-decimal USDC)
    uint256 private constant SWAP_OUTPUT_SCALAR = 1e12;

    mapping(bytes32 => bool) public approvedRoutes;
    mapping(bytes32 => address) public routeTokens;
    mapping(address => uint256) public balanceOf;

    // Configurable swap ratio for testing (e.g., 900000 for 0.9)
    uint256 public swapRatioBps = 900000; // 90% output

    function setSwapRatioBps(uint256 ratioBps) external {
        swapRatioBps = ratioBps;
    }

    function setShouldFail(bool fail) external {
        shouldFail = fail;
    }

    function approveRoute(bytes32 routeId, address token) external {
        approvedRoutes[routeId] = true;
        routeTokens[routeId] = token;
    }

    function revokeRoute(bytes32 routeId) external {
        approvedRoutes[routeId] = false;
    }

    function isRouteApproved(bytes32 routeId) external view returns (bool) {
        return approvedRoutes[routeId];
    }

    function swap(bytes32 routeId, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut) {
        require(!shouldFail, "swap failed");
        require(approvedRoutes[routeId], "route not approved");

        lastRouteId = routeId;
        lastAmountIn = amountIn;
        MockRewardToken(routeTokens[routeId]).transferFrom(msg.sender, address(this), amountIn);

        // Simulate swap: converts 18-decimal reward token amount to 6-decimal USDC
        // e.g., 10e18 COMP * 0.9 / 1e12 = 9e6 USDC
        amountOut = (amountIn * swapRatioBps) / 1_000_000 / SWAP_OUTPUT_SCALAR;

        MockUSDC(NavyVaultSRCLA(msg.sender).asset()).mint(msg.sender, amountOut);

        // Note: We don't revert on slippage here - let the vault handle that check
        // This allows testing the vault's SlippageExceeded error

        return amountOut;
    }

    function mint(address token, address to, uint256 amount) external {
        MockRewardToken(token).mint(to, amount);
    }
}

/// @title VaultHarvestTest - Comprehensive tests for harvest integration
contract VaultHarvestTest is Test {
    MockUSDC public usdc;
    MockRewardToken public comp;
    MockRewardToken public well;

    NavyVaultSRCLA public vault;
    MockAdapterWithRewards public adapter;
    MockRewardExecutor public executor;

    address public admin = address(0xA11CE);
    address public allocator = address(0xA110CA7E);
    address public nonAllocator = address(0xB0B);

    bytes32 public compRouteId = keccak256("comp-route");
    bytes32 public wellRouteId = keccak256("well-route");

    function setUp() public {
        // Deploy mocks
        usdc = new MockUSDC();
        comp = new MockRewardToken("Compound", "COMP", 18);
        well = new MockRewardToken("Moonwell", "WELL", 18);

        // Deploy vault
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));

        // Deploy adapter with reward tokens (only COMP and WELL for most tests)
        address[] memory rewardTokens = new address[](2);
        rewardTokens[0] = address(comp);
        rewardTokens[1] = address(well);
        adapter = new MockAdapterWithRewards(address(vault), address(usdc), rewardTokens);

        // Deploy executor
        executor = new MockRewardExecutor();

        // Grant roles
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), admin);
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        // Register adapter
        vm.prank(admin);
        vault.registerAdapter(address(adapter), 5000, 100, "Test Adapter");

        // Setup executor in vault
        vm.prank(admin);
        vault.setRewardExecutor(address(executor));

        // Setup routes
        vm.prank(admin);
        vault.setRewardTokenRoute(address(comp), compRouteId);
        vm.prank(admin);
        vault.setRewardTokenRoute(address(well), wellRouteId);

        // Approve routes in executor
        executor.approveRoute(compRouteId, address(comp));
        executor.approveRoute(wellRouteId, address(well));

        // Set up adapter with assets and rewards
        adapter.setReportedAssets(1000e6);
        adapter.setWithdrawable(1000e6);
        adapter.setClaimableReward(address(comp), 10e18); // 10 COMP
        adapter.setClaimableReward(address(well), 20e18); // 20 WELL
    }

    // ---- State Variable Tests ----

    function test_rewardExecutorIsSet() public {
        assertEq(vault.rewardExecutor(), address(executor), "rewardExecutor should be set");
    }

    function test_rewardTokenRoutesAreSet() public {
        assertEq(vault.rewardTokenRoutes(address(comp)), compRouteId, "COMP route should be set");
        assertEq(vault.rewardTokenRoutes(address(well)), wellRouteId, "WELL route should be set");
    }

    // ---- setRewardExecutor Tests ----

    function test_setRewardExecutor_setsNewExecutor() public {
        address newExecutor = makeAddr("newExecutor");
        vm.prank(admin);
        vault.setRewardExecutor(newExecutor);

        assertEq(vault.rewardExecutor(), newExecutor, "rewardExecutor should be updated");
    }

    function test_setRewardExecutor_revertsForZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(NavyVaultSRCLA.ZeroAddress.selector);
        vault.setRewardExecutor(address(0));
    }

    function test_setRewardExecutor_onlyAdmin() public {
        vm.prank(nonAllocator);
        vm.expectRevert();
        vault.setRewardExecutor(makeAddr("anotherExecutor"));
    }

    // ---- setRewardTokenRoute Tests ----

    function test_setRewardTokenRoute_setsRoute() public {
        bytes32 newRouteId = keccak256("new-route");
        vm.prank(admin);
        vault.setRewardTokenRoute(address(comp), newRouteId);

        assertEq(vault.rewardTokenRoutes(address(comp)), newRouteId, "route should be updated");
    }

    function test_setRewardTokenRoute_revertsForZeroToken() public {
        vm.prank(admin);
        vm.expectRevert(NavyVaultSRCLA.ZeroAddress.selector);
        vault.setRewardTokenRoute(address(0), compRouteId);
    }

    function test_setRewardTokenRoute_revertsForZeroRouteId() public {
        vm.prank(admin);
        vm.expectRevert(NavyVaultSRCLA.InvalidRewardRoute.selector);
        vault.setRewardTokenRoute(address(comp), bytes32(0));
    }

    function test_setRewardTokenRoute_onlyAdmin() public {
        vm.prank(nonAllocator);
        vm.expectRevert();
        vault.setRewardTokenRoute(address(comp), compRouteId);
    }

    // ---- harvest Tests ----

    function test_harvest_claimsFromAdapter() public {
        // Set swap ratio: 90% output (e.g., 10 COMP -> 9 USDC)
        executor.setSwapRatioBps(900000); // 900000 bps = 90%

        uint256 recognizedBefore = vault.recognizedRewards();

        vm.prank(allocator);
        uint256 totalUsdc = vault.harvest(address(adapter), compRouteId, 0);

        // 10 COMP * 0.9 = 9 USDC + 20 WELL * 0.9 = 18 USDC = 27 USDC total
        assertEq(totalUsdc, 27e6, "should harvest correct total USDC");
        assertEq(vault.recognizedRewards(), recognizedBefore + 27e6, "recognized rewards should increase");
    }

    function test_harvest_withMinOutSuccess() public {
        // Set swap ratio: 90% output
        executor.setSwapRatioBps(900000);

        // The minOut is checked per-token by the vault after the swap returns
        // We need minOut to be less than or equal to the smallest individual swap output
        // COMP: 10e18 * 0.9 / 1e12 = 9e6, WELL: 20e18 * 0.9 / 1e12 = 18e6
        // Using minOut of 5e6 (less than 9e6 for first token)
        vm.prank(allocator);
        uint256 totalUsdc = vault.harvest(address(adapter), compRouteId, 5e6);

        // 10 COMP * 0.9 = 9 USDC + 20 WELL * 0.9 = 18 USDC = 27 USDC
        assertEq(totalUsdc, 27e6, "should succeed when above minOut");
    }

    function test_harvest_revertsOnSlippage() public {
        // Set swap ratio: 40% output (very low)
        executor.setSwapRatioBps(400000); // 40% instead of 90%

        // 10 COMP * 0.4 = 4e6 USDC (below 5e6 minOut)
        // The first token (COMP) will revert in the mock
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.SlippageExceeded.selector);
        vault.harvest(address(adapter), compRouteId, 5e6);
    }

    function test_harvest_onlyAllocator() public {
        vm.prank(nonAllocator);
        vm.expectRevert();
        vault.harvest(address(adapter), compRouteId, 0);
    }

    function test_harvest_revertsWhenExecutorNotSet() public {
        // Deploy new vault without executor
        NavyVaultSRCLA newVault = new NavyVaultSRCLA(IERC20(address(usdc)));
        newVault.grantRole(newVault.DEFAULT_ADMIN_ROLE(), address(this));
        newVault.grantRole(newVault.ADMIN_ROLE(), admin);
        newVault.grantRole(newVault.ALLOCATOR_ROLE(), allocator);

        // Register a simple adapter with the new vault
        address[] memory simpleTokens = new address[](1);
        simpleTokens[0] = address(comp);
        MockAdapterWithRewards simpleAdapter =
            new MockAdapterWithRewards(address(newVault), address(usdc), simpleTokens);

        vm.prank(admin);
        newVault.registerAdapter(address(simpleAdapter), 5000, 100, "Simple Adapter");

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.RewardExecutorNotSet.selector);
        newVault.harvest(address(simpleAdapter), compRouteId, 0);
    }

    function test_harvest_revertsForUnregisteredAdapter() public {
        MockRewardToken newComp = new MockRewardToken("NewCOMP", "NCOMP", 18);
        address[] memory newRewardTokens = new address[](1);
        newRewardTokens[0] = address(newComp);
        MockAdapterWithRewards newAdapter = new MockAdapterWithRewards(address(vault), address(usdc), newRewardTokens);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotFound.selector);
        vault.harvest(address(newAdapter), compRouteId, 0);
    }

    function test_harvest_revertsForInactiveAdapter() public {
        vm.prank(admin);
        vault.setAdapterState(address(adapter), 1); // Set to Disabled

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotActive.selector);
        vault.harvest(address(adapter), compRouteId, 0);
    }

    function test_harvest_handlesZeroClaimable() public {
        // Set all claimable to 0
        adapter.setClaimableReward(address(comp), 0);
        adapter.setClaimableReward(address(well), 0);

        vm.prank(allocator);
        uint256 totalUsdc = vault.harvest(address(adapter), compRouteId, 0);

        assertEq(totalUsdc, 0, "should return 0 when no rewards");
    }

    function test_harvest_usesDifferentRouteId() public {
        // Test that a different routeId parameter can be used
        // Set up a new route for a different token
        bytes32 differentRouteId = keccak256("different-route");
        executor.approveRoute(differentRouteId, address(well));
        vm.prank(admin);
        vault.setRewardTokenRoute(address(well), differentRouteId);

        // Set swap ratio
        executor.setSwapRatioBps(900000);

        vm.prank(allocator);
        uint256 totalUsdc = vault.harvest(address(adapter), differentRouteId, 0);

        // 10 COMP * 0.9 = 9 USDC + 20 WELL * 0.9 = 18 USDC = 27 USDC
        assertEq(totalUsdc, 27e6, "should work with different routeId");
    }

    function test_harvest_singleRewardToken() public {
        // Create adapter with single reward token
        address[] memory singleToken = new address[](1);
        singleToken[0] = address(comp);
        MockAdapterWithRewards singleAdapter = new MockAdapterWithRewards(address(vault), address(usdc), singleToken);
        singleAdapter.setReportedAssets(500e6);
        singleAdapter.setWithdrawable(500e6);
        singleAdapter.setClaimableReward(address(comp), 100e18);

        vm.prank(admin);
        vault.registerAdapter(address(singleAdapter), 5000, 100, "Single Token Adapter");

        executor.setSwapRatioBps(900000); // 100 COMP * 0.9 = 90 USDC

        uint256 recognizedBefore = vault.recognizedRewards();
        vm.prank(allocator);
        uint256 totalUsdc = vault.harvest(address(singleAdapter), compRouteId, 0);

        assertEq(totalUsdc, 90e6, "should harvest 90 USDC for 100 COMP at 90% ratio");
        assertEq(vault.recognizedRewards(), recognizedBefore + 90e6, "rewards should be recognized");
    }

    // ---- Integration: harvest via Plan Execution ----

    function test_harvestViaPlanExecution() public {
        // Create a plan with harvest action
        // For Harvest, amount is used as routeId and minOut is passed through
        bytes32 planId = keccak256("harvest-plan");
        bytes32 decisionHash = keccak256("harvest-decision");

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(planId),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(adapter),
            amount: uint256(compRouteId), // amount = routeId for harvest
            minOut: 0
        });

        // Set swap ratio
        executor.setSwapRatioBps(900000);

        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: uint256(planId),
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 3600),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("snapshot"),
            decisionHash: decisionHash,
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });
        bytes32 leaf = vault.hashPlanAction(vault.planDomain(header), action);

        vm.prank(allocator);
        vault.submitPlan(header, leaf);

        // Execute the harvest action via plan execution
        uint256 recognizedBefore = vault.recognizedRewards();
        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), action);

        // Plan should complete
        assertEq(vault.getActivePlanPlanId(), bytes32(0), "plan should be completed");

        // Verify recognized rewards increased (27e6 USDC from swaps)
        assertGt(vault.recognizedRewards(), recognizedBefore, "rewards should be recognized");
    }

    // ---- Edge Cases ----

    function test_harvest_withVerySmallAmounts() public {
        // Set tiny claimable amounts
        adapter.setClaimableReward(address(comp), 1); // 1 wei of COMP
        adapter.setClaimableReward(address(well), 0);

        executor.setSwapRatioBps(900000);

        vm.prank(allocator);
        uint256 totalUsdc = vault.harvest(address(adapter), compRouteId, 0);

        // 1 wei COMP * 0.9 = rounds to 0
        assertEq(totalUsdc, 0, "tiny amounts should work");
    }

    function test_harvest_withLargeAmounts() public {
        // Set large claimable amounts
        adapter.setClaimableReward(address(comp), 10000e18); // 10000 COMP
        adapter.setClaimableReward(address(well), 20000e18); // 20000 WELL

        executor.setSwapRatioBps(900000);

        uint256 recognizedBefore = vault.recognizedRewards();
        vm.prank(allocator);
        uint256 totalUsdc = vault.harvest(address(adapter), compRouteId, 0);

        // 10000 * 0.9 = 9000 + 20000 * 0.9 = 18000 = 27000 USDC
        assertEq(totalUsdc, 27000e6, "large amounts should work");
        assertEq(vault.recognizedRewards(), recognizedBefore + 27000e6, "rewards should be added");
    }

    function test_harvest_emitsEvent() public {
        executor.setSwapRatioBps(900000);

        vm.prank(allocator);
        vm.expectEmit();
        emit IVaultEvents.Harvested(address(adapter), 27e6);
        vault.harvest(address(adapter), compRouteId, 0);
    }

    function test_multipleHarvestsCumulative() public {
        executor.setSwapRatioBps(900000);

        uint256 firstTotal = 27e6;

        // First harvest
        vm.prank(allocator);
        uint256 total1 = vault.harvest(address(adapter), compRouteId, 0);
        assertEq(total1, firstTotal, "first harvest should return correct amount");

        // Reset claimable rewards
        adapter.setClaimableReward(address(comp), 5e18);
        adapter.setClaimableReward(address(well), 10e18);

        // Second harvest: 5 * 0.9 = 4.5 + 10 * 0.9 = 9 = 13.5 USDC
        vm.prank(allocator);
        uint256 total2 = vault.harvest(address(adapter), compRouteId, 0);
        assertEq(total2, 135e5, "second harvest should return correct amount");

        // Total recognized should be cumulative
        assertEq(vault.recognizedRewards(), (firstTotal + total2), "recognized rewards should accumulate");
    }

    // ---- Error Handling ----

    function test_harvest_revertsWhenExecutorSwapFails() public {
        executor.setShouldFail(true);

        vm.prank(allocator);
        vm.expectRevert("swap failed");
        vault.harvest(address(adapter), compRouteId, 0);
    }

    function test_harvest_revertsWhenRouteNotApproved() public {
        // Revoke the route
        executor.revokeRoute(compRouteId);

        vm.prank(allocator);
        vm.expectRevert("route not approved");
        vault.harvest(address(adapter), compRouteId, 0);
    }

    // ---- Adapter State Changes ----

    function test_harvest_revertsForRemovedAdapter() public {
        // First, make adapter empty
        adapter.setReportedAssets(0);
        adapter.setWithdrawable(0);

        vm.prank(admin);
        vault.setAdapterState(address(adapter), 3); // Removed

        // Adapter is still registered but state is not Active
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotActive.selector);
        vault.harvest(address(adapter), compRouteId, 0);
    }

    function test_harvest_revertsForImpairedAdapter() public {
        vm.prank(admin);
        vault.setAdapterState(address(adapter), 2); // Impaired

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotActive.selector);
        vault.harvest(address(adapter), compRouteId, 0);
    }
}
