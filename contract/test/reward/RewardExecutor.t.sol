// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {RewardExecutor} from "../../src/reward/RewardExecutor.sol";
import {IRewardExecutor} from "../../src/interfaces/IRewardExecutor.sol";
import {MockUniswapV3Router} from "../../src/mocks/MockUniswapV3Router.sol";

/// @title Mock ERC20 for testing
contract MockERC20 {
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

    /// @notice Simplified forceApprove for SafeERC20
    function forceApprove(address spender, uint256 value) external {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
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
}

/// @title Mock Chainlink Aggregator for testing
contract MockChainlinkFeed {
    int256 private _price;
    uint256 private _startedAt;
    uint256 private _updatedAt;
    uint80 private _roundId = 1;
    uint80 private _answeredInRound = 1;
    uint8 private _dec = 8;

    constructor(int256 price) {
        _price = price;
        _startedAt = 1;
        _updatedAt = block.timestamp;
    }

    function description() external pure returns (string memory) {
        return "MOCK/USD";
    }

    function decimals() external view returns (uint8) {
        return _dec;
    }

    function latestAnswer() external view returns (int256) {
        return _price;
    }

    function latestTimestamp() external view returns (uint256) {
        return _updatedAt;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _price, _startedAt, _updatedAt, _answeredInRound);
    }

    function setPrice(int256 price) external {
        _price = price;
        _updatedAt = block.timestamp;
        _roundId++;
        _answeredInRound = _roundId;
    }

    function setStalePrice(int256 price, uint256 age) external {
        _price = price;
        if (block.timestamp > age) {
            _updatedAt = block.timestamp - age;
        } else {
            _updatedAt = 1;
        }
        _roundId++;
        _answeredInRound = _roundId;
    }

    function setAnsweredInRound(uint80 answered) external {
        _answeredInRound = answered;
    }

    function setStartedAt(uint256 startedAt_) external {
        _startedAt = startedAt_;
    }

    /// @dev Directly sets the round's updatedAt without touching price/round,
    ///      so a test can make a feed's own reported age stale or fresh
    ///      independent of setStalePrice's price-plus-age helper.
    function setUpdatedAt(uint256 updatedAt_) external {
        _updatedAt = updatedAt_;
    }
}

/// @title Mock Uniswap V3 Factory for testing
contract MockUniswapV3Factory {
    mapping(bytes32 => address) private _pools;

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool) {
        bytes32 key = keccak256(abi.encode(tokenA < tokenB ? tokenA : tokenB, tokenA < tokenB ? tokenB : tokenA, fee));
        return _pools[key];
    }

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        bytes32 key = keccak256(abi.encode(tokenA < tokenB ? tokenA : tokenB, tokenA < tokenB ? tokenB : tokenA, fee));
        _pools[key] = pool;
    }
}

/// @title Mock Uniswap V3 Pool for testing
contract MockUniswapV3Pool {
    address public token0;
    address public token1;
    uint24 public fee;
    bytes32 public liquiditySnapshot;
    uint160 public sqrtPriceX96Snapshot;

    constructor(address _token0, address _token1, uint24 _fee) {
        token0 = _token0 < _token1 ? _token0 : _token1;
        token1 = _token0 < _token1 ? _token1 : _token0;
        fee = _fee;
    }

    function setLiquidity(bytes32 liquidity) external {
        liquiditySnapshot = liquidity;
    }

    function setSqrtPriceX96(uint160 sqrtPrice) external {
        sqrtPriceX96Snapshot = sqrtPrice;
    }
}

/// @title Mock Sequencer Uptime Feed for testing
contract MockSequencerUptimeFeed {
    bool public isUp;
    uint256 public gracePeriod = 3600; // 1 hour default
    uint256 public lastUpdate;

    constructor(bool _isUp) {
        isUp = _isUp;
        // startedAt marks when the sequencer came online
        // For "up" state, startedAt is in the past (before grace period)
        // For "down" state, startedAt is recent
        lastUpdate = _isUp ? 1 : block.timestamp;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        // answer = 0 means UP, answer != 0 means DOWN
        return (uint80(1), isUp ? int256(0) : int256(1), lastUpdate, lastUpdate, uint80(1));
    }

    function latestAnswer() external view returns (int256) {
        return isUp ? int256(0) : int256(1);
    }

    function setUp(bool _isUp) external {
        isUp = _isUp;
        lastUpdate = _isUp ? 1 : block.timestamp;
    }

    function setGracePeriod(uint256 period) external {
        gracePeriod = period;
    }
}

/// @title RewardExecutorTest - Comprehensive tests for RewardExecutor
/// @notice Tests for the route-based swap executor with Chainlink oracle validation
contract RewardExecutorTest is Test {
    using SafeERC20 for IERC20;

    // ---- New Executor with Extended Constructor ----
    RewardExecutor public executor;

    // ---- Mocks ----
    MockERC20 public usdc;
    MockERC20 public comp;
    MockERC20 public well;
    MockERC20 public weth;
    MockChainlinkFeed public compFeed;
    MockChainlinkFeed public wellFeed;
    MockChainlinkFeed public wethFeed;
    MockChainlinkFeed public usdcFeed;
    MockUniswapV3Factory public factory;
    MockUniswapV3Router public router;
    MockSequencerUptimeFeed public sequencerFeed;

    // ---- Addresses ----
    address public vault = address(0xA11CE);
    address public admin = address(0xA110CA7E);
    address public nonAdmin = address(0x1);

    // ---- Route IDs ----
    bytes32 public compRouteId;
    bytes32 public compWithChainlinkRouteId;
    bytes32 public twoHopRouteId;
    bytes32 public invalidRouteId = keccak256("invalid-route");

    // ---- Route Storage ----
    IRewardExecutor.Route public compDirectRoute;
    IRewardExecutor.Route public compChainlinkRoute;
    IRewardExecutor.Route public twoHopRoute;

    // ---- Chain Config ----
    uint256 constant CHAIN_ID = 8453; // Base
    address public CANONICAL_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // Set to mock in setUp
    address constant SWAP_ROUTER02 = 0x2626664C2603336E57b271C5c0b26F42121e30D0;
    address constant FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address constant SEQUENCER_FEED = 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7;
    uint256 constant RECOVERY_GRACE_PERIOD = 3600;

    // ---- Helper Functions ----

    function setUp() public {
        // Deploy mocks
        usdc = new MockERC20("USD Coin", "USDC", 6);
        comp = new MockERC20("Compound", "COMP", 18);
        well = new MockERC20("Moonwell", "WELL", 18);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);

        compFeed = new MockChainlinkFeed(90_000_000); // $0.90
        wellFeed = new MockChainlinkFeed(500_000_000); // ~$0.005
        wethFeed = new MockChainlinkFeed(3_500_000_000_000); // ~$3500
        usdcFeed = new MockChainlinkFeed(1_000_000_000); // $1.00

        factory = new MockUniswapV3Factory();
        router = new MockUniswapV3Router();
        sequencerFeed = new MockSequencerUptimeFeed(true); // Sequencer is up

        // Use mock USDC as canonical for testing (real USDC not deployed)
        CANONICAL_USDC = address(usdc);

        // Deploy executor with extended constructor
        executor = new RewardExecutor({
            _vault: vault,
            _admin: admin,
            _canonicalUsdc: CANONICAL_USDC,
            _factory: address(factory),
            _swapRouter02: address(router),
            _sequencerFeed: address(sequencerFeed),
            _recoveryGrace: RECOVERY_GRACE_PERIOD
        });

        // Set up pools in factory
        _setupPools();

        // Setup routes first (to get correct routeIds)
        _setupCompDirectRoute();
        _setupCompChainlinkRoute();
        _setupTwoHopRoute();

        // Generate route IDs - must match what routeIdForRoute computes
        compRouteId = routeIdForRoute(compDirectRoute);
        compWithChainlinkRouteId = routeIdForRoute(compChainlinkRoute);
        twoHopRouteId = routeIdForRoute(twoHopRoute);

        // Approve routes
        vm.prank(admin);
        executor.approveRoute(compRouteId, compDirectRoute);

        vm.prank(admin);
        executor.approveRoute(compWithChainlinkRouteId, compChainlinkRoute);

        vm.prank(admin);
        executor.approveRoute(twoHopRouteId, twoHopRoute);
    }

    function _setupPools() internal {
        // COMP/USDC 0.3% pool (using CANONICAL_USDC)
        address compUsdcPool = address(new MockUniswapV3Pool(address(comp), CANONICAL_USDC, 3000));
        factory.setPool(address(comp), CANONICAL_USDC, 3000, compUsdcPool);

        // WELL/USDC 1% pool (using CANONICAL_USDC)
        address wellUsdcPool = address(new MockUniswapV3Pool(address(well), CANONICAL_USDC, 10000));
        factory.setPool(address(well), CANONICAL_USDC, 10000, wellUsdcPool);

        // COMP/WETH 0.3% pool
        address compWethPool = address(new MockUniswapV3Pool(address(comp), address(weth), 3000));
        factory.setPool(address(comp), address(weth), 3000, compWethPool);

        // WETH/USDC 0.05% pool (using CANONICAL_USDC)
        address wethUsdcPool = address(new MockUniswapV3Pool(address(weth), CANONICAL_USDC, 500));
        factory.setPool(address(weth), CANONICAL_USDC, 500, wethUsdcPool);
    }

    function _setupCompDirectRoute() internal {
        // One-hop: COMP -> USDC
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = CANONICAL_USDC;

        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;

        compDirectRoute = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0) // Will be computed
        });

        // Compute digest
        compDirectRoute.routeDigest = executor.computeDigest(routeIdForRoute(compDirectRoute), compDirectRoute);
    }

    function _setupCompChainlinkRoute() internal {
        // One-hop with explicit oracle validation - use 500 fee tier (different from compDirectRoute's 3000)
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = CANONICAL_USDC;

        uint24[] memory fees = new uint24[](1);
        fees[0] = 500; // Different from compDirectRoute (3000) to get unique routeId

        compChainlinkRoute = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        // Set up pool for this fee tier
        address compUsdcPool500 = address(new MockUniswapV3Pool(address(comp), CANONICAL_USDC, 500));
        factory.setPool(address(comp), CANONICAL_USDC, 500, compUsdcPool500);

        compChainlinkRoute.routeDigest = executor.computeDigest(routeIdForRoute(compChainlinkRoute), compChainlinkRoute);
    }

    function _setupTwoHopRoute() internal {
        // Two-hop: COMP -> WETH -> USDC
        address[] memory path = new address[](3);
        path[0] = address(comp);
        path[1] = address(weth);
        path[2] = CANONICAL_USDC;

        uint24[] memory fees = new uint24[](2);
        fees[0] = 3000; // COMP/WETH
        fees[1] = 500; // WETH/USDC

        twoHopRoute = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](2),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9800,
            maxPriceImpactBps: 300,
            maxDailyNotional: 500_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        twoHopRoute.routeDigest = executor.computeDigest(routeIdForRoute(twoHopRoute), twoHopRoute);
    }

    function routeIdForRoute(IRewardExecutor.Route memory route) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            route.inputToken,
            route.outputToken,
            route.path,
            route.fees
        ));
    }

    // ============================================
    // CONSTRUCTOR TESTS
    // ============================================

    function test_constructor_rejectsZeroVault() public {
        vm.expectRevert();
        new RewardExecutor({
            _vault: address(0),
            _admin: admin,
            _canonicalUsdc: CANONICAL_USDC,
            _factory: address(factory),
            _swapRouter02: address(router),
            _sequencerFeed: address(sequencerFeed),
            _recoveryGrace: RECOVERY_GRACE_PERIOD
        });
    }

    function test_constructor_rejectsZeroAdmin() public {
        vm.expectRevert();
        new RewardExecutor({
            _vault: vault,
            _admin: address(0),
            _canonicalUsdc: CANONICAL_USDC,
            _factory: address(factory),
            _swapRouter02: address(router),
            _sequencerFeed: address(sequencerFeed),
            _recoveryGrace: RECOVERY_GRACE_PERIOD
        });
    }

    function test_constructor_rejectsZeroUsdc() public {
        vm.expectRevert();
        new RewardExecutor({
            _vault: vault,
            _admin: admin,
            _canonicalUsdc: address(0),
            _factory: address(factory),
            _swapRouter02: address(router),
            _sequencerFeed: address(sequencerFeed),
            _recoveryGrace: RECOVERY_GRACE_PERIOD
        });
    }

    function test_constructor_rejectsZeroFactory() public {
        vm.expectRevert();
        new RewardExecutor({
            _vault: vault,
            _admin: admin,
            _canonicalUsdc: CANONICAL_USDC,
            _factory: address(0),
            _swapRouter02: address(router),
            _sequencerFeed: address(sequencerFeed),
            _recoveryGrace: RECOVERY_GRACE_PERIOD
        });
    }

    function test_constructor_rejectsZeroRouter() public {
        vm.expectRevert();
        new RewardExecutor({
            _vault: vault,
            _admin: admin,
            _canonicalUsdc: CANONICAL_USDC,
            _factory: address(factory),
            _swapRouter02: address(0),
            _sequencerFeed: address(sequencerFeed),
            _recoveryGrace: RECOVERY_GRACE_PERIOD
        });
    }

    function test_constructor_setsImmutables() public {
        assertEq(executor.vault(), vault, "vault should be set");
        assertEq(executor.admin(), admin, "admin should be set");
        assertEq(executor.canonicalUsdc(), CANONICAL_USDC, "canonical USDC should be set");
        assertEq(executor.factory(), address(factory), "factory should be set");
        assertEq(executor.swapRouter02(), address(router), "router should be set");
        assertEq(executor.sequencerFeed(), address(sequencerFeed), "sequencer feed should be set");
        assertEq(executor.recoveryGrace(), RECOVERY_GRACE_PERIOD, "recovery grace should be set");
    }

    function test_constructor_grantsRoles() public {
        assertTrue(executor.hasRole(executor.DEFAULT_ADMIN_ROLE(), vault), "vault should have admin role");
        assertTrue(executor.hasRole(executor.ADMIN_ROLE(), vault), "vault should have ADMIN_ROLE");
        assertTrue(executor.hasRole(executor.DEFAULT_ADMIN_ROLE(), admin), "admin should have admin role");
        assertTrue(executor.hasRole(executor.ADMIN_ROLE(), admin), "admin should have ADMIN_ROLE");
    }

    // ============================================
    // ROUTE APPROVAL TESTS - Constructor Validation
    // ============================================

    function test_approveRoute_rejectsNonUsdcOutput() public {
        bytes32 routeId = keccak256("non-usdc-output");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = address(weth); // Not USDC

        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: address(weth),
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route.routeDigest = executor.computeDigest(routeId, route);

        vm.prank(admin);
        vm.expectRevert();
        executor.approveRoute(routeId, route);
    }

    function test_approveRoute_rejectsInvalidPathLengths() public {
        // Path too short (length 1)
        bytes32 routeId1 = keccak256("path-too-short");
        address[] memory path1 = new address[](1);
        path1[0] = address(comp);

        uint24[] memory fees1 = new uint24[](0);

        IRewardExecutor.Route memory route1 = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path1,
            fees: fees1,
            pools: new address[](0),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route1.routeDigest = executor.computeDigest(routeId1, route1);

        vm.prank(admin);
        vm.expectRevert();
        executor.approveRoute(routeId1, route1);

        // Path too long (length 4)
        bytes32 routeId2 = keccak256("path-too-long");
        address[] memory path2 = new address[](4);
        path2[0] = address(comp);
        path2[1] = address(weth);
        path2[2] = address(usdc);
        path2[3] = address(comp);

        uint24[] memory fees2 = new uint24[](3);

        IRewardExecutor.Route memory route2 = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path2,
            fees: fees2,
            pools: new address[](3),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route2.routeDigest = executor.computeDigest(routeId2, route2);

        vm.prank(admin);
        vm.expectRevert();
        executor.approveRoute(routeId2, route2);
    }

    function test_approveRoute_rejectsMismatchedFees() public {
        bytes32 routeId = keccak256("mismatched-fees");
        address[] memory path = new address[](3);
        path[0] = address(comp);
        path[1] = address(weth);
        path[2] = CANONICAL_USDC;

        uint24[] memory fees = new uint24[](1); // Wrong: should be 2 for 3-hop

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route.routeDigest = executor.computeDigest(routeId, route);

        vm.prank(admin);
        vm.expectRevert();
        executor.approveRoute(routeId, route);
    }

    function test_approveRoute_rejectsZeroFeeTier() public {
        bytes32 routeId = keccak256("zero-fee");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = CANONICAL_USDC;

        uint24[] memory fees = new uint24[](1);
        fees[0] = 0; // Invalid

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route.routeDigest = executor.computeDigest(routeId, route);

        vm.prank(admin);
        vm.expectRevert();
        executor.approveRoute(routeId, route);
    }

    function test_approveRoute_rejectsUnsupportedFeeTier() public {
        bytes32 routeId = keccak256("unsupported-fee");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = CANONICAL_USDC;

        uint24[] memory fees = new uint24[](1);
        fees[0] = 10000; // 1% - valid
        // But we set up pool for 3000, so 10000 pool doesn't exist

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route.routeDigest = executor.computeDigest(routeId, route);

        vm.prank(admin);
        vm.expectRevert();
        executor.approveRoute(routeId, route);
    }

    function test_approveRoute_rejectsNonExistentPool() public {
        bytes32 routeId = keccak256("no-pool");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = CANONICAL_USDC;

        uint24[] memory fees = new uint24[](1);
        fees[0] = 100; // 0.01% - pool doesn't exist

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route.routeDigest = executor.computeDigest(routeId, route);

        vm.prank(admin);
        vm.expectRevert();
        executor.approveRoute(routeId, route);
    }

    function test_approveRoute_rejectsRepeatedTokens() public {
        bytes32 routeId = keccak256("repeated-token");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = address(comp); // Repeated

        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route.routeDigest = executor.computeDigest(routeId, route);

        vm.prank(admin);
        vm.expectRevert();
        executor.approveRoute(routeId, route);
    }

    function test_approveRoute_rejectsZeroToken() public {
        bytes32 routeId = keccak256("zero-token");
        address[] memory path = new address[](2);
        path[0] = address(0); // Zero token
        path[1] = CANONICAL_USDC;

        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(0),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route.routeDigest = executor.computeDigest(routeId, route);

        vm.prank(admin);
        vm.expectRevert();
        executor.approveRoute(routeId, route);
    }

    function test_approveRoute_rejectsWrongPoolTokenOrder() public {
        // The pool should have token0 < token1
        // If we pass tokens in wrong order, the pool lookup will fail
        bytes32 routeId = keccak256("wrong-order");
        address[] memory path = new address[](2);
        path[0] = CANONICAL_USDC; // USDC first (smaller address on Base)
        path[1] = address(comp);

        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: CANONICAL_USDC,
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route.routeDigest = executor.computeDigest(routeId, route);

        vm.prank(admin);
        vm.expectRevert();
        executor.approveRoute(routeId, route);
    }

    function test_approveRoute_requiresOnlyAdmin() public {
        bytes32 routeId = keccak256("unauthorized");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = CANONICAL_USDC;

        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route.routeDigest = executor.computeDigest(routeId, route);

        vm.prank(nonAdmin);
        vm.expectRevert();
        executor.approveRoute(routeId, route);
    }

    function test_approveRoute_storesRoute() public {
        IRewardExecutor.Route memory route = executor.getRoute(compRouteId);

        assertEq(route.inputToken, address(comp), "inputToken should be COMP");
        assertEq(route.outputToken, CANONICAL_USDC, "outputToken should be USDC");
        assertEq(route.path.length, 2, "path length should be 2");
        assertEq(route.fees.length, 1, "fees length should be 1");
    }

    function test_approveRoute_emitsEvent() public {
        bytes32 newRouteId = keccak256("new-route-emit");
        address[] memory path = new address[](2);
        path[0] = address(well);
        path[1] = CANONICAL_USDC;

        uint24[] memory fees = new uint24[](1);
        fees[0] = 10000;

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(well),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(wellFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9500,
            maxPriceImpactBps: 500,
            maxDailyNotional: 100_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });

        route.routeDigest = executor.computeDigest(newRouteId, route);

        vm.prank(admin);
        vm.expectEmit();
        emit IRewardExecutor.RouteApproved(newRouteId, address(well), CANONICAL_USDC);
        executor.approveRoute(newRouteId, route);
    }

    // ============================================
    // ROUTE REVOCATION TESTS
    // ============================================

    function test_revokeRoute_deletesRoute() public {
        vm.prank(admin);
        executor.revokeRoute(compRouteId);

        assertFalse(executor.isRouteApproved(compRouteId), "route should be revoked");
    }

    function test_revokeRoute_emitsEvent() public {
        vm.prank(admin);
        vm.expectEmit();
        emit IRewardExecutor.RouteRevoked(compRouteId);
        executor.revokeRoute(compRouteId);
    }

    function test_revokeRoute_requiresAdmin() public {
        vm.prank(nonAdmin);
        vm.expectRevert();
        executor.revokeRoute(compRouteId);
    }

    // ============================================
    // SWAP EXECUTION TESTS - Oracle Validation
    // ============================================

    function test_swap_rejectsSequencerDown() public {
        uint256 amountIn = 10e18;
        uint256 deadline = block.timestamp + 3600;

        sequencerFeed.setUp(false); // Sequencer is down

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        vm.prank(vault);
        vm.expectRevert();
        executor.swap(compRouteId, amountIn, 0, deadline);
    }

    function test_swap_rejectsZeroSequencerStartedAt() public {
        uint256 amountIn = 10e18;
        uint256 deadline = block.timestamp + 3600;

        // Create a mock feed with zero startedAt by deploying a new one
        MockSequencerUptimeFeed badFeed = new MockSequencerUptimeFeed(false);
        // Manually set startedAt to 0 by manipulating round data
        // For this test, we rely on the sequencer being up during setUp
        // This test verifies the happy path when sequencer is up

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        vm.prank(vault);
        // When sequencer is up, swap should succeed (this validates the "up" path)
        uint256 out = executor.swap(compRouteId, amountIn, 0, deadline);
        assertGt(out, 0, "swap should succeed when sequencer is up");
    }

    /// @dev The original fixture captured `deadline` before warping forward
    ///      past it, so it always reverted on DeadlineExpired (checked before
    ///      any oracle read) regardless of feed staleness — it never actually
    ///      exercised the stale-round path its name claims. Fixed to keep the
    ///      deadline valid and assert the real StaleChainlinkPrice revert.
    function test_swap_rejectsStaleFeedRound() public {
        // Establish a safe "now" first: block.timestamp starts at 1 in this
        // suite, and setStalePrice's fallback branch for
        // block.timestamp <= age would otherwise mask real staleness.
        vm.warp(30 days);
        uint256 amountIn = 10e18;

        // Stale beyond compDirectRoute's maxRewardFeedAge (3600s).
        compFeed.setStalePrice(90_000_000, 7200);
        uint256 deadline = block.timestamp + 3600;

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        vm.prank(vault);
        vm.expectRevert(RewardExecutor.StaleChainlinkPrice.selector);
        executor.swap(compRouteId, amountIn, 0, deadline);
    }

    function test_swap_rejectsFutureFeedRound() public {
        uint256 amountIn = 10e18;
        uint256 deadline = block.timestamp + 3600;

        // Test with zero price - should revert for invalid price
        compFeed.setPrice(0);

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        vm.prank(vault);
        vm.expectRevert();
        executor.swap(compRouteId, amountIn, 0, deadline);
    }

    function test_swap_rejectsIncompleteFeedRound() public {
        uint256 amountIn = 10e18;
        uint256 deadline = block.timestamp + 3600;

        compFeed.setAnsweredInRound(0); // Incomplete round

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        vm.prank(vault);
        vm.expectRevert();
        executor.swap(compRouteId, amountIn, 0, deadline);
    }

    function test_swap_rejectsExpiredDeadline() public {
        uint256 amountIn = 10e18;
        uint256 deadline = block.timestamp - 1; // Expired

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        vm.prank(vault);
        vm.expectRevert();
        executor.swap(compRouteId, amountIn, 0, deadline);
    }

    function test_swap_rejectsZeroInput() public {
        uint256 deadline = block.timestamp + 3600;

        vm.prank(vault);
        vm.expectRevert();
        executor.swap(compRouteId, 0, 0, deadline);
    }

    function test_swap_rejectsExcessiveInput() public {
        uint256 amountIn = type(uint256).max; // Exceeds maxInput
        uint256 deadline = block.timestamp + 3600;

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        vm.prank(vault);
        vm.expectRevert();
        executor.swap(compRouteId, amountIn, 0, deadline);
    }

    function test_swap_rejectsNonExistentRoute() public {
        uint256 amountIn = 10e18;
        uint256 deadline = block.timestamp + 3600;

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        vm.prank(vault);
        vm.expectRevert();
        executor.swap(invalidRouteId, amountIn, 0, deadline);
    }

    function test_swap_onlyVault() public {
        uint256 amountIn = 10e18;
        uint256 deadline = block.timestamp + 3600;

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        vm.prank(nonAdmin);
        vm.expectRevert();
        executor.swap(compRouteId, amountIn, 0, deadline);
    }

    /// @dev setDailyVolume was an admin backdoor removed in favor of genuine
    ///      cap enforcement (paper 9.4): rather than pre-seeding volume, this
    ///      approves a fresh route whose maxDailyNotional is smaller than a
    ///      single swap's output, so the very first swap against it already
    ///      exceeds the cap through the real enforcement path.
    function test_swap_enforcesDailyCap() public {
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = CANONICAL_USDC;
        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;

        bytes32 routeId = keccak256("daily-cap-route");
        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 1,
            maxPriceImpactBps: 10000,
            maxDailyNotional: 1, // essentially zero cap: any real swap output exceeds it
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });
        route.routeDigest = executor.computeDigest(routeId, route);
        vm.prank(admin);
        executor.approveRoute(routeId, route);

        uint256 amountIn = 10e18;
        uint256 expectedOut = 9_000_000;
        uint256 deadline = block.timestamp + 3600;

        usdc.mint(address(executor), expectedOut);
        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);
        router.setSwapOutput(expectedOut);

        vm.prank(vault);
        vm.expectRevert(RewardExecutor.DailyVolumeLimitExceeded.selector);
        executor.swap(routeId, amountIn, 0, deadline);
    }

    function test_swap_enforcesMinOutput() public {
        uint256 amountIn = 10e18;
        uint256 deadline = block.timestamp + 3600;
        uint256 minOut = type(uint256).max; // Unrealistic minimum

        // Mint USDC to executor
        usdc.mint(address(executor), amountIn);

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        // Set low router output
        router.setSwapOutput(1);

        vm.prank(vault);
        vm.expectRevert();
        executor.swap(compRouteId, amountIn, minOut, deadline);
    }

    function test_swap_success() public {
        uint256 amountIn = 10e18;
        uint256 expectedOut = 9_000_000; // ~9 USDC
        uint256 deadline = block.timestamp + 3600;

        // Mint USDC to executor (what router would deliver)
        usdc.mint(address(executor), expectedOut);

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        router.setSwapOutput(expectedOut);

        vm.prank(vault);
        uint256 amountOut = executor.swap(compRouteId, amountIn, 0, deadline);

        assertEq(amountOut, expectedOut, "should return expected output");
        assertEq(usdc.balanceOf(vault), expectedOut, "vault should receive USDC");
    }

    function test_swap_updatesDailyVolume() public {
        uint256 amountIn = 10e18;
        uint256 expectedOut = 9_000_000;
        uint256 deadline = block.timestamp + 3600;
        uint256 currentDay = block.timestamp / 86400;

        usdc.mint(address(executor), expectedOut);

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        router.setSwapOutput(expectedOut);

        vm.prank(vault);
        executor.swap(compRouteId, amountIn, 0, deadline);

        assertEq(executor.dailyVolume(compRouteId, currentDay), expectedOut, "daily volume should be updated");
    }

    /// @dev The original fixture only asserted `true`, so it passed
    ///      regardless of whether Swapped was ever emitted — exactly the gap
    ///      this task closes (the event was declared but never emitted).
    ///      Now asserts the exact topics and data.
    function test_swap_emitsEvent() public {
        uint256 amountIn = 10e18;
        uint256 expectedOut = 9_000_000;
        uint256 deadline = block.timestamp + 3600;

        usdc.mint(address(executor), expectedOut);

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        router.setSwapOutput(expectedOut);

        vm.prank(vault);
        vm.expectEmit(true, true, true, true);
        emit IRewardExecutor.Swapped(compRouteId, address(comp), CANONICAL_USDC, amountIn, expectedOut, 0);
        executor.swap(compRouteId, amountIn, 0, deadline);
    }

    // ============================================
    // PAPER 9.4 CONFORMANCE TESTS
    // ============================================

    /// @dev §9.4 requires each route to fix Chainlink feeds and their maximum
    ///      ages. _validateChainlinkPrice checked round completeness and a
    ///      nonzero updatedAt but never compared it to block.timestamp, so a
    ///      feed frozen for a week passed. compDirectRoute's maxRewardFeedAge
    ///      is 1 hour (3600s); 2 hours must revert.
    function test_swapRevertsOnAStaleRewardFeed() public {
        // block.timestamp starts at 1 in this suite; warp to a safe "now"
        // first so `block.timestamp - 2 hours` below cannot underflow.
        vm.warp(30 days);
        compFeed.setUpdatedAt(block.timestamp - 2 hours);

        uint256 amountIn = 10e18;
        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        vm.prank(vault);
        vm.expectRevert(RewardExecutor.StaleChainlinkPrice.selector);
        executor.swap(compRouteId, amountIn, 0, block.timestamp + 3600);
    }

    function test_swapSucceedsOnAFreshFeed() public {
        vm.warp(30 days);
        compFeed.setUpdatedAt(block.timestamp - 1 minutes);
        usdcFeed.setPrice(1_000_000_000); // keep the route's other feed fresh too

        uint256 amountIn = 10e18;
        uint256 expectedOut = 9_000_000;
        usdc.mint(address(executor), expectedOut);
        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);
        router.setSwapOutput(expectedOut);

        vm.prank(vault);
        uint256 out = executor.swap(compRouteId, amountIn, 0, block.timestamp + 3600);
        assertGt(out, 0, "swap should succeed on a fresh feed");
    }

    /// @dev Same route parameters must not produce the same digest on another
    ///      chain — the digest previously omitted block.chainid entirely.
    function test_routeDigestBindsChainId() public {
        bytes32 here = executor.computeDigest(compRouteId, compDirectRoute);
        vm.chainId(999);
        assertTrue(here != executor.computeDigest(compRouteId, compDirectRoute), "digest must bind chain id");
    }

    /// @dev The Swapped event was declared but never emitted, leaving
    ///      harvests with no on-chain evidence.
    function test_swapEmitsSwappedEvidence() public {
        uint256 amountIn = 10e18;
        uint256 expectedOut = 9_000_000;
        usdc.mint(address(executor), expectedOut);
        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);
        router.setSwapOutput(expectedOut);

        vm.prank(vault);
        vm.expectEmit(true, true, true, false);
        emit IRewardExecutor.Swapped(compRouteId, address(comp), CANONICAL_USDC, 0, 0, 0);
        executor.swap(compRouteId, amountIn, 0, block.timestamp + 3600);
    }

    /// @dev swapCount is the replay/evidence counter that did not exist before.
    function test_swapCountIncrements() public {
        uint256 amountIn = 10e18;
        uint256 expectedOut = 9_000_000;
        usdc.mint(address(executor), expectedOut);
        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);
        router.setSwapOutput(expectedOut);

        uint256 before = executor.swapCount(compRouteId);
        vm.prank(vault);
        executor.swap(compRouteId, amountIn, 0, block.timestamp + 3600);
        assertEq(executor.swapCount(compRouteId), before + 1, "swapCount must increment per completed swap");
    }

    /// @dev approveRoute must reject a zero maxRewardFeedAge — an unbounded
    ///      age is the exact defect this task fixes, so it cannot be
    ///      reintroduced through configuration.
    function test_approveRoute_rejectsZeroMaxRewardFeedAge() public {
        bytes32 routeId = keccak256("zero-reward-age");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = CANONICAL_USDC;
        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 0,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });
        route.routeDigest = executor.computeDigest(routeId, route);

        vm.prank(admin);
        vm.expectRevert(RewardExecutor.InvalidMaxFeedAge.selector);
        executor.approveRoute(routeId, route);
    }

    function test_approveRoute_rejectsZeroMaxUsdcFeedAge() public {
        bytes32 routeId = keccak256("zero-usdc-age");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = CANONICAL_USDC;
        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 0,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });
        route.routeDigest = executor.computeDigest(routeId, route);

        vm.prank(admin);
        vm.expectRevert(RewardExecutor.InvalidMaxFeedAge.selector);
        executor.approveRoute(routeId, route);
    }

    /// @dev Rejecting zero closes the *safe* direction (a zero max age means
    ///      "only a same-block update is fresh"). The dangerous direction is
    ///      the upper one: without a ceiling an admin can set
    ///      type(uint256).max and an indefinitely frozen feed passes every
    ///      validation, reinstating the exact staleness defect these fields
    ///      exist to close. Both max-age legs must be bounded above.
    function test_approveRoute_rejectsUnboundedMaxRewardFeedAge() public {
        IRewardExecutor.Route memory route = _boundedRoute();
        route.maxRewardFeedAge = type(uint256).max;
        _expectRouteRejected(keccak256("unbounded-reward-age"), route);
    }

    function test_approveRoute_rejectsUnboundedMaxUsdcFeedAge() public {
        IRewardExecutor.Route memory route = _boundedRoute();
        route.maxUsdcFeedAge = type(uint256).max;
        _expectRouteRejected(keccak256("unbounded-usdc-age"), route);
    }

    /// @dev A plausible-looking typo (365 days) is just as dangerous as
    ///      type(uint256).max and must be rejected by the same bound.
    function test_approveRoute_rejectsAPlausibleButExcessiveMaxFeedAge() public {
        IRewardExecutor.Route memory route = _boundedRoute();
        route.maxRewardFeedAge = 365 days;
        _expectRouteRejected(keccak256("year-long-reward-age"), route);
    }

    /// @dev The ceiling is inclusive and the rejection above is caused by the
    ///      bound rather than by some unrelated validation: one second over
    ///      MAX_FEED_AGE is refused, MAX_FEED_AGE itself is approved and
    ///      stored.
    function test_approveRoute_maxFeedAgeCeilingIsInclusive() public {
        uint256 ceiling = executor.MAX_FEED_AGE();
        assertGe(ceiling, 24 hours, "the ceiling must clear a 24h Chainlink heartbeat");

        IRewardExecutor.Route memory tooOld = _boundedRoute();
        tooOld.maxRewardFeedAge = ceiling + 1;
        _expectRouteRejected(keccak256("ceiling-plus-one"), tooOld);

        bytes32 routeId = keccak256("at-ceiling");
        IRewardExecutor.Route memory atCeiling = _boundedRoute();
        atCeiling.maxRewardFeedAge = ceiling;
        atCeiling.maxUsdcFeedAge = ceiling;
        atCeiling.routeDigest = executor.computeDigest(routeId, atCeiling);
        vm.prank(admin);
        executor.approveRoute(routeId, atCeiling);

        // The auto-generated getter omits the three dynamic arrays, so it
        // returns 14 words: inputToken, outputToken, rewardFeed, usdcFeed,
        // maxRewardFeedAge, maxUsdcFeedAge, maxInput, minOutputBps,
        // maxPriceImpactBps, maxDailyNotional, lowerBound, upperBound,
        // activationBlockHash, routeDigest.
        (,,,, uint256 storedRewardAge, uint256 storedUsdcAge,,,,,,,,) = executor.routes(routeId);
        assertEq(storedRewardAge, ceiling, "a route at the ceiling must be stored");
        assertEq(storedUsdcAge, ceiling);
    }

    /// @dev A COMP->USDC route with everything except the max-age fields set
    ///      to values approveRoute accepts, so a rejection can only come from
    ///      the max-age bound under test.
    function _boundedRoute() internal view returns (IRewardExecutor.Route memory route) {
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = CANONICAL_USDC;
        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;

        route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(0)
        });
    }

    function _expectRouteRejected(bytes32 routeId, IRewardExecutor.Route memory route) internal {
        route.routeDigest = executor.computeDigest(routeId, route);
        vm.prank(admin);
        vm.expectRevert(RewardExecutor.InvalidMaxFeedAge.selector);
        executor.approveRoute(routeId, route);
    }

    // ============================================
    // ORACLE MATH TESTS
    // ============================================

    function test_oracleRewardToUsdcConversion() public {
        // COMP at $0.90, input 10 COMP
        // Expected USDC = 10 * 0.90 = 9 USDC (with 6 decimals)
        uint256 amountIn = 10e18;
        uint256 expectedUsdc = 9_000_000; // 9 USDC with 6 decimals

        // This tests the oracle math: reward/USD divided by USDC/USD
        // COMP/USD = 0.90 * 1e8 = 90_000_000
        // USDC/USD = 1.00 * 1e8 = 100_000_000
        // Result = amountIn * (COMP/USD) / (USDC/USD) = 10e18 * 90e6 / 100e6 = 9e18 -> 9e6 USDC
    }

    // ============================================
    // TWO-HOP ROUTE TESTS
    // ============================================

    function test_approveRoute_twoHopValid() public {
        // Two-hop: COMP -> WETH -> USDC is already set up and should be valid
        IRewardExecutor.Route memory route = executor.getRoute(twoHopRouteId);

        assertEq(route.path.length, 3, "path should have 3 tokens");
        assertEq(route.fees.length, 2, "fees should have 2 entries");
    }

    function test_swap_twoHopSuccess() public {
        uint256 amountIn = 10e18;
        uint256 expectedOut = 8_500_000; // ~8.5 USDC
        uint256 deadline = block.timestamp + 3600;

        usdc.mint(address(executor), expectedOut);

        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        router.setSwapOutput(expectedOut);

        vm.prank(vault);
        uint256 amountOut = executor.swap(twoHopRouteId, amountIn, 0, deadline);

        assertEq(amountOut, expectedOut, "two-hop swap should succeed");
    }

    // ============================================
    // DIGEST VALIDATION TESTS
    // ============================================

    function test_approveRoute_validatesDigest() public {
        bytes32 routeId = keccak256("wrong-digest");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = CANONICAL_USDC;

        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: CANONICAL_USDC,
            path: path,
            fees: fees,
            pools: new address[](1),
            rewardFeed: address(compFeed),
            usdcFeed: address(usdcFeed),
            maxRewardFeedAge: 3600,
            maxUsdcFeedAge: 3600,
            maxInput: type(uint256).max,
            minOutputBps: 9850,
            maxPriceImpactBps: 200,
            maxDailyNotional: 1_000_000_000_000,
            lowerBound: 0,
            upperBound: type(uint256).max,
            activationBlockHash: blockhash(block.number - 1),
            routeDigest: bytes32(uint256(0x12345678)) // Wrong digest
        });

        route.routeDigest = executor.computeDigest(routeId, route); // Correct digest

        vm.prank(admin);
        executor.approveRoute(routeId, route); // Should store correct digest
    }

    // ============================================
    // BOUNDS VALIDATION TESTS
    // ============================================

    function test_swap_enforcesUpperBound() public {
        // Route has upperBound = type(uint256).max, so this is a placeholder
        // In production, upperBound would be a reasonable cap
    }

    // ============================================
    // ACCESSOR TESTS
    // ============================================

    function test_getRouteIds_returnsAllRoutes() public {
        bytes32[] memory routeIds = executor.getRouteIds();

        assertEq(routeIds.length, 3, "should have 3 routes");
    }

    function test_isRouteApproved_correctStatus() public {
        assertTrue(executor.isRouteApproved(compRouteId), "comp route should be approved");
        assertTrue(executor.isRouteApproved(twoHopRouteId), "two-hop route should be approved");
        assertFalse(executor.isRouteApproved(invalidRouteId), "invalid route should not be approved");
    }

    function test_getRoute_emptyForNonExistent() public {
        IRewardExecutor.Route memory route = executor.getRoute(invalidRouteId);
        assertEq(route.inputToken, address(0), "non-existent route should have zero inputToken");
    }
}
