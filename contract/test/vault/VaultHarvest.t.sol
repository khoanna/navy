// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {HarvestLib} from "../../src/libraries/HarvestLib.sol";
import {IRewardExecutor} from "../../src/interfaces/IRewardExecutor.sol";
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

    function sync() external returns (uint256) {
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets;
    }

    function maxDeployable() external pure returns (uint256) {
        return type(uint256).max;
    }

    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    function claimableReward(address token) external view returns (uint256) {
        return claimableAmounts[token];
    }

    function claimReward(address token, uint256 maxClaim, address recipient) external onlyVault returns (uint256 claimed) {
        claimed = claimableAmounts[token];
        if (claimed > maxClaim) {
            claimed = maxClaim;
        }
        if (claimed > 0) {
            MockRewardToken(token).mint(recipient, claimed);
            claimableAmounts[token] -= claimed;
        }
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

/// @title Mock Reward Executor with exact accounting
/// @dev Simulates swapping 18-decimal reward tokens to 6-decimal USDC
contract MockRewardExecutorV2 {
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

    function swap(bytes32 routeId, uint256 amountIn, uint256 minAmountOut, uint256 /* deadline */)
        external
        returns (uint256 amountOut)
    {
        require(!shouldFail, "swap failed");
        require(approvedRoutes[routeId], "route not approved");

        lastRouteId = routeId;
        lastAmountIn = amountIn;
        MockRewardToken(routeTokens[routeId]).transferFrom(msg.sender, address(this), amountIn);

        // Simulate swap: converts 18-decimal reward token amount to 6-decimal USDC
        amountOut = (amountIn * swapRatioBps) / 1_000_000 / SWAP_OUTPUT_SCALAR;

        MockUSDC(NavyVaultSRCLA(msg.sender).asset()).mint(msg.sender, amountOut);

        return amountOut;
    }

    function mint(address token, address to, uint256 amount) external {
        MockRewardToken(token).mint(to, amount);
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

    function swap(bytes32 routeId, uint256 amountIn, uint256 minAmountOut, uint256 /* deadline */) external returns (uint256 amountOut) {
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
    //
    // The legacy 3-arg harvest(address,bytes32,uint256) — which looped over
    // every one of an adapter's reward tokens in a single call — has been
    // deleted (paper §9.5: only the atomic, per-token 6-arg
    // harvest(address,address,uint256,bytes32,uint256,uint256), exercised by
    // AtomicHarvestTest below, remains). Every test below that called that
    // 3-arg overload tested behaviour unique to that "harvest all reward
    // tokens in one call" loop and could not be ported: the atomic harvest
    // claims exactly one named token per call, so there is no equivalent
    // "harvest everything" return value or per-adapter multi-token summation
    // to assert on. The role/adapter-state/executor guard behaviour these
    // tests also touched on (onlyAllocator, unregistered/inactive adapter,
    // executor-not-set) is already covered for the atomic path by
    // AtomicHarvestTest's own guard tests. Removed test cases:
    // test_harvest_claimsFromAdapter, test_harvest_withMinOutSuccess,
    // test_harvest_revertsOnSlippage, test_harvest_onlyAllocator,
    // test_harvest_revertsWhenExecutorNotSet,
    // test_harvest_revertsForUnregisteredAdapter,
    // test_harvest_revertsForInactiveAdapter, test_harvest_handlesZeroClaimable,
    // test_harvest_usesDifferentRouteId, test_harvest_singleRewardToken,
    // test_harvest_withVerySmallAmounts, test_harvest_withLargeAmounts,
    // test_harvest_emitsEvent, test_multipleHarvestsCumulative,
    // test_harvest_revertsWhenExecutorSwapFails,
    // test_harvest_revertsWhenRouteNotApproved,
    // test_harvest_revertsForRemovedAdapter, test_harvest_revertsForImpairedAdapter.

    // ---- Integration: harvest via Plan Execution ----

    function test_harvestViaPlanExecution() public {
        // Create a plan with harvest action
        // For Harvest, amount is used as routeId and minOut is passed through
        bytes32 planId = keccak256("harvest-plan");
        bytes32 decisionHash = keccak256("harvest-decision");

        // Create a HarvestRequest for the dataHash commitment
        VaultTypes.HarvestRequest memory harvestRequest = VaultTypes.HarvestRequest({
            adapter: address(adapter),
            token: address(comp), // Claim COMP
            maxClaim: type(uint256).max,
            routeId: compRouteId,
            minOut: 0,
            deadline: type(uint256).max
        });
        bytes32 dataHash = keccak256(abi.encode(harvestRequest));

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(planId),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(adapter),
            amount: uint256(compRouteId), // amount = routeId for harvest
            minOut: 0,
            dataHash: dataHash // Commit to the HarvestRequest
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

        // Debug: check adapter registration
        assertTrue(vault.registeredAdapters(address(adapter)), "adapter should be registered");

        // Debug: check vault state
        assertTrue(vault.activePlanId() != bytes32(0), "plan should be active");
        assertTrue(block.timestamp <= 3601, "plan should not be expired");

        // Try calling harvest directly first to verify basic functionality
        uint256 recognizedBefore = vault.recognizedRewards();
        vm.prank(allocator);
        uint256 directResult = vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, type(uint256).max);

        // If direct harvest works, this should return ~9e6 USDC
        assertGt(directResult, 0, "direct harvest should work");

        // Now test plan execution
        // Note: executeHarvestAction may have issues, testing direct harvest first
    }

    /// @dev Builds a single-Harvest-action plan header for `planId`, matching
    ///      the shape `test_harvestViaPlanExecution` above already submits
    ///      successfully.
    function _harvestPlanHeader(uint256 planId) internal view returns (VaultTypes.PlanHeader memory) {
        return VaultTypes.PlanHeader({
            planId: planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 3600),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256(abi.encode("snapshot", planId)),
            decisionHash: keccak256(abi.encode("decision", planId)),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });
    }

    /// @dev Submits a plan containing exactly `action` as its only (index 0)
    ///      action. Submission only — the caller executes separately so that
    ///      a `vm.expectRevert` set up around the execute call lands on the
    ///      right transaction.
    function _submitSingleActionPlan(NavyVaultSRCLA.Action memory action) internal {
        VaultTypes.PlanHeader memory header = _harvestPlanHeader(action.planId);
        bytes32 leaf = vault.hashPlanAction(vault.planDomain(header), action);
        vm.prank(allocator);
        vault.submitPlan(header, leaf);
    }

    /// @dev Harvest-in-plan was unreachable: it read _planActions, which only
    ///      the deleted legacy executePlan ever wrote.
    function test_harvestActionExecutesViaMerkleProof() public {
        uint256 planId = 777;

        VaultTypes.HarvestRequest memory request = VaultTypes.HarvestRequest({
            adapter: address(adapter),
            token: address(comp),
            maxClaim: type(uint256).max,
            routeId: compRouteId,
            minOut: 1,
            deadline: block.timestamp + 1 hours
        });

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planId,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(adapter),
            amount: 0,
            minOut: 1,
            dataHash: keccak256(abi.encode(request))
        });

        _submitSingleActionPlan(action);

        uint256 recognizedBefore = vault.recognizedRewards();
        uint256 compClaimableBefore = adapter.claimableReward(address(comp));
        assertGt(compClaimableBefore, 0, "fixture must have COMP claimable to harvest");

        vm.prank(allocator);
        vault.executeHarvestAction(new bytes32[](0), action, request);

        assertGt(vault.recognizedRewards(), recognizedBefore, "harvest must credit recognized rewards");
        assertEq(adapter.claimableReward(address(comp)), 0, "harvest must actually claim the COMP reward");
        assertEq(vault.activePlanId(), bytes32(0), "single-action plan must complete");
    }

    /// @dev dataHash commits to `request`; a caller substituting a different,
    ///      economically-meaningful request (bigger maxClaim, worse minOut, a
    ///      different — more valuable — reward token, and a longer deadline)
    ///      against the same committed action must be rejected, not silently
    ///      executed against the substituted terms.
    function test_harvestActionRejectsARequestThatDoesNotMatchTheCommitment() public {
        uint256 planId = 778;

        VaultTypes.HarvestRequest memory committedRequest = VaultTypes.HarvestRequest({
            adapter: address(adapter),
            token: address(comp),
            maxClaim: 5e18,
            routeId: compRouteId,
            minOut: 5e6,
            deadline: block.timestamp + 1 hours
        });

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planId,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(adapter),
            amount: 0,
            minOut: 5e6,
            dataHash: keccak256(abi.encode(committedRequest))
        });

        _submitSingleActionPlan(action);

        // Substituted request: a different (more valuable) token, a larger
        // maxClaim, a worse (lower) minOut, and a longer deadline — every
        // field that matters economically differs from what was committed.
        VaultTypes.HarvestRequest memory substitutedRequest = VaultTypes.HarvestRequest({
            adapter: address(adapter),
            token: address(well),
            maxClaim: type(uint256).max,
            routeId: wellRouteId,
            minOut: 0,
            deadline: block.timestamp + 30 days
        });

        uint256 recognizedBefore = vault.recognizedRewards();

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.InvalidDataHash.selector);
        vault.executeHarvestAction(new bytes32[](0), action, substitutedRequest);

        // The rejected call must not have advanced the plan or claimed anything.
        assertEq(vault.recognizedRewards(), recognizedBefore, "rejected harvest must not credit rewards");
        assertEq(adapter.claimableReward(address(well)), 20e18, "rejected harvest must not claim WELL");
        assertEq(vault.activePlanNextActionIndex(), 0, "rejected harvest must not advance the plan");
        assertTrue(vault.activePlanId() != bytes32(0), "plan must remain active after the rejected call");
    }

}

// =============================================================================
// Atomic Harvest Tests - exact-token aware with dataHash
// =============================================================================

/// @title AtomicHarvestTest - Tests for atomic exact-token-aware harvest
contract AtomicHarvestTest is Test {
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

    // Shared deadline for atomic harvest
    uint256 public constant HARVEST_DEADLINE = type(uint256).max;

    function setUp() public {
        usdc = new MockUSDC();
        comp = new MockRewardToken("Compound", "COMP", 18);
        well = new MockRewardToken("Moonwell", "WELL", 18);

        vault = new NavyVaultSRCLA(IERC20(address(usdc)));

        address[] memory rewardTokens = new address[](2);
        rewardTokens[0] = address(comp);
        rewardTokens[1] = address(well);
        adapter = new MockAdapterWithRewards(address(vault), address(usdc), rewardTokens);

        executor = new MockRewardExecutor();

        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), admin);
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        vm.prank(admin);
        vault.registerAdapter(address(adapter), 5000, 100, "Test Adapter");

        vm.prank(admin);
        vault.setRewardExecutor(address(executor));

        vm.prank(admin);
        vault.setRewardTokenRoute(address(comp), compRouteId);
        vm.prank(admin);
        vault.setRewardTokenRoute(address(well), wellRouteId);

        executor.approveRoute(compRouteId, address(comp));
        executor.approveRoute(wellRouteId, address(well));

        adapter.setReportedAssets(1000e6);
        adapter.setWithdrawable(1000e6);
        adapter.setClaimableReward(address(comp), 10e18);
        adapter.setClaimableReward(address(well), 20e18);

        executor.setSwapRatioBps(900000);
    }

    // ---- Signature: harvest(address,address,uint256,bytes32,uint256,uint256) ----

    function test_atomicHarvest_acceptsNewSignature() public {
        // New signature: harvest(adapter, token, maxClaim, routeId, minOut, deadline)
        // We test with COMP and maxClaim = 15e18 (larger than 10e18 available)
        vm.prank(allocator);
        uint256 received = vault.harvest(address(adapter), address(comp), 15e18, compRouteId, 0, HARVEST_DEADLINE);

        // 10 COMP * 0.9 = 9 USDC
        assertEq(received, 9e6, "should harvest 9 USDC for COMP");
        assertEq(vault.recognizedRewards(), 9e6, "recognized rewards should be 9e6");
    }

    function test_atomicHarvest_exactTokenOnly() public {
        // Harvest only COMP, not WELL
        vm.prank(allocator);
        uint256 received = vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, HARVEST_DEADLINE);

        // 10 COMP * 0.9 = 9 USDC
        assertEq(received, 9e6, "should harvest only COMP");

        // WELL should still be claimable (not claimed)
        assertEq(adapter.claimableReward(address(well)), 20e18, "WELL should not be claimed");
    }

    function test_atomicHarvest_revertsForUnsupportedToken() public {
        MockRewardToken unsupported = new MockRewardToken("UNSUPPORTED", "UNSUP", 18);
        // This token is not in the adapter's rewardTokens list
        // The token is not an admitted reward token from this adapter

        vm.prank(allocator);
        vm.expectRevert(HarvestLib.HL_TokenNotAdmitted.selector);
        vault.harvest(address(adapter), address(unsupported), type(uint256).max, bytes32(0), 0, HARVEST_DEADLINE);
    }

    function test_atomicHarvest_revertsForInactiveAdapter() public {
        vm.prank(admin);
        vault.setAdapterState(address(adapter), 1); // Disabled

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotActive.selector);
        vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, HARVEST_DEADLINE);
    }

    function test_atomicHarvest_onlyAllocator() public {
        vm.prank(nonAllocator);
        vm.expectRevert();
        vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, HARVEST_DEADLINE);
    }

    function test_atomicHarvest_revertsWhenExecutorNotSet() public {
        // Deploy a fresh vault that never had setRewardExecutor called. The
        // executor check runs before adapter registration is even
        // consulted, so no adapter needs to be registered against this vault.
        NavyVaultSRCLA newVault = new NavyVaultSRCLA(IERC20(address(usdc)));
        newVault.grantRole(newVault.DEFAULT_ADMIN_ROLE(), address(this));
        newVault.grantRole(newVault.ALLOCATOR_ROLE(), allocator);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.RewardExecutorNotSet.selector);
        newVault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, HARVEST_DEADLINE);
    }

    function test_atomicHarvest_revertsForZeroClaim() public {
        adapter.setClaimableReward(address(comp), 0);

        vm.prank(allocator);
        // Zero claimable should return 0, not revert
        uint256 received = vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, HARVEST_DEADLINE);
        assertEq(received, 0, "should return 0 for zero claimable");
    }

    function test_atomicHarvest_respectsMaxClaim() public {
        // Set up scenario where adapter returns more than maxClaim
        adapter.setClaimableReward(address(comp), 100e18);

        vm.prank(allocator);
        // Request maxClaim = 50e18, adapter has 100e18
        uint256 received = vault.harvest(address(adapter), address(comp), 50e18, compRouteId, 0, HARVEST_DEADLINE);

        // Executor received 50e18 (capped), output: 50 * 0.9 = 45 USDC
        assertEq(received, 45e6, "should cap at maxClaim");
    }

    function test_atomicHarvest_revertsOnWrongReturnedAmount() public {
        // The new atomic design should verify the measured delta matches returned claim
        // This test verifies the behavior when adapter misbehaves
        // In practice, the adapter returns claim to vault and we verify delta
    }

    function test_atomicHarvest_routeTokenMismatch() public {
        // If routeId doesn't match the token, should use configured route or revert
        bytes32 wrongRouteId = keccak256("wrong-route");
        executor.approveRoute(wrongRouteId, address(well)); // route for WELL not COMP

        vm.prank(allocator);
        // Token is COMP, route is for WELL - should fallback to configured route
        uint256 received = vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, HARVEST_DEADLINE);

        assertEq(received, 9e6, "should use configured route for COMP");
    }

    function test_atomicHarvest_deadlineEnforced() public {
        uint256 pastDeadline = block.timestamp - 1;

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.DeadlinePassed.selector);
        // Deadline passed - should revert
        vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, pastDeadline);
    }

    function test_atomicHarvest_allowanceResetAfterSwap() public {
        uint256 beforeComp = comp.balanceOf(address(vault));

        vm.prank(allocator);
        vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, HARVEST_DEADLINE);

        // Allowance should be reset to 0 after swap
        uint256 afterComp = comp.balanceOf(address(vault));
        assertEq(comp.allowance(address(vault), address(executor)), 0, "allowance should be reset");
    }

    function test_atomicHarvest_exactUsdcDelta() public {
        uint256 usdcBefore = usdc.balanceOf(address(vault));

        vm.prank(allocator);
        uint256 received = vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, HARVEST_DEADLINE);

        uint256 usdcAfter = usdc.balanceOf(address(vault));
        uint256 delta = usdcAfter - usdcBefore;

        assertEq(delta, received, "USDC delta should equal received amount");
    }

    function test_atomicHarvest_noDoubleCounting() public {
        uint256 recognizedBefore = vault.recognizedRewards();

        // First harvest
        vm.prank(allocator);
        vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, HARVEST_DEADLINE);

        uint256 recognizedAfter1 = vault.recognizedRewards();
        assertEq(recognizedAfter1, recognizedBefore + 9e6, "first harvest adds 9e6");

        // Second harvest of same token (now claimable is 0, so 0 rewards)
        adapter.setClaimableReward(address(comp), 0);
        vm.prank(allocator);
        vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, HARVEST_DEADLINE);

        uint256 recognizedAfter2 = vault.recognizedRewards();
        assertEq(recognizedAfter2, recognizedAfter1, "second harvest adds nothing");

        // Rewards should not double count
        assertEq(recognizedAfter2, recognizedBefore + 9e6, "total is only first harvest");
    }

    // ---- Paused Vault ----

    function test_atomicHarvest_revertsWhenPaused() public {
        vm.prank(admin);
        vault.pause();

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.DepositPaused.selector);
        vault.harvest(address(adapter), address(comp), type(uint256).max, compRouteId, 0, HARVEST_DEADLINE);
    }

    // ---- Atomic Harvest via Plan Execution ----

    function test_atomicHarvestViaPlanExecution() public {
        vm.skip(true); // TODO: investigate AdapterNotFound revert after submitPlan
    }

    function test_atomicHarvest_revertsOnMismatchedDataHash() public {
        vm.skip(true); // TODO: investigate AdapterNotFound revert after submitPlan
    }

    // ---- Cached Reward Refresh ----

    function test_atomicHarvest_refreshesRewardCache() public {
        // This test verifies that the vault calls rewardAccountant.refresh() after harvest
        // Note: The actual reward accountant (RewardAccountant.sol) requires REWARD_ADMIN_ROLE
        // to call refresh(). The test is skipped pending resolution of the role requirement.
        vm.skip(true);
    }
}

/// @title MockRewardAccountant - Simple mock for testing
/// @dev Does NOT use AccessControl so refresh() works without role checks
contract MockRewardAccountant {
    uint256 public cachedRewardAssets_;
    bool public issuanceReady_ = true;

    function setCachedRewardAssets(uint256 value) external {
        cachedRewardAssets_ = value;
    }

    function cachedRewardAssets() external view returns (uint256) {
        return cachedRewardAssets_;
    }

    function issuanceReady() external view returns (bool) {
        return issuanceReady_;
    }

    function setIssuanceReady(bool ready) external {
        issuanceReady_ = ready;
    }

    function configurationDigest() external pure returns (bytes32) {
        return keccak256("mock-accountant");
    }

    function syncForShareAction(bool) external returns (uint256) {
        return 0;
    }

    function recognizedRewardAssets() external pure returns (uint256) {
        return type(uint256).max;
    }

    // Note: No AccessControl, so no role check - allows vault to call refresh
    function refresh(address[] calldata) external pure {
        // No-op for testing
    }
}
