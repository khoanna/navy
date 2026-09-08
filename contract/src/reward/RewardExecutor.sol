// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IRewardExecutor} from "../interfaces/IRewardExecutor.sol";

/// @title RewardExecutor - Converts protocol rewards to USDC via Uniswap V3
/// @notice Routes must be pre-approved by admin and pass strict admission criteria:
///         - Only 1-hop (path[2]) or 2-hop (path[3]) routes through canonical pools
///         - Output must be canonical USDC
///         - Fee tiers must match existing canonical pools
///         - Route digest must be immutable once approved
///         - Chainlink oracle validation with dual feeds
///         - Sequencer uptime monitoring for L2 safety
contract RewardExecutor is AccessControl, IRewardExecutor {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address public immutable vault;
    address public immutable admin;
    address public immutable canonicalUsdc;
    address public immutable factory;
    address public immutable swapRouter02;
    address public immutable sequencerFeed;
    uint256 public immutable recoveryGrace;

    mapping(bytes32 => Route) public routes;
    bytes32[] private _routeIds;
    mapping(bytes32 => mapping(uint256 => uint256)) public dailyVolume;
    /// @notice Number of swaps completed against a route (replay/evidence counter)
    mapping(bytes32 => uint256) public swapCount;

    // ---- Custom Errors ----
    error RouteNotFound();
    error SlippageExceeded();
    error DailyVolumeLimitExceeded();
    error StaleChainlinkPrice();
    error InvalidChainlinkPrice();
    error RoundNotStarted();
    error RoundIncomplete();
    error PriceImpactExceeded(uint256 actualBps, uint256 maxBps);
    error ZeroAmount();
    error NotVault();
    error FeedTokenMismatch();
    error OutputNotUsdc();
    error InvalidPathLength();
    error ArrayLengthMismatch();
    error UnsupportedFeeTier();
    error PoolNotFound();
    error DigestMismatch();
    error SequencerDown();
    error DeadlineExpired();
    error InputExceedsMax();
    error ZeroActivationBlockHash();
    error ZeroAddress();
    error InvalidMinOutBps();
    error InvalidMaxPriceImpactBps();
    error InvalidBounds();
    error InvalidMaxInput();
    error InvalidMaxFeedAge();

    constructor(
        address _vault,
        address _admin,
        address _canonicalUsdc,
        address _factory,
        address _swapRouter02,
        address _sequencerFeed,
        uint256 _recoveryGrace
    ) {
        if (_vault == address(0) || _admin == address(0) || _canonicalUsdc == address(0) ||
            _factory == address(0) || _swapRouter02 == address(0)) revert ZeroAddress();

        vault = _vault;
        admin = _admin;
        canonicalUsdc = _canonicalUsdc;
        factory = _factory;
        swapRouter02 = _swapRouter02;
        sequencerFeed = _sequencerFeed;
        recoveryGrace = _recoveryGrace;

        _grantRole(DEFAULT_ADMIN_ROLE, _vault);
        _grantRole(ADMIN_ROLE, _vault);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    /// @notice Compute the canonical route digest
    /// @dev Binds block.chainid and pools (in addition to every other route
    ///      field, including the feed max-ages) so a route approved on one
    ///      chain, or with a substituted pool set, cannot produce the same
    ///      digest. Shared by approveRoute so the two computations cannot drift.
    function computeDigest(bytes32 routeId, Route calldata route_) external view returns (bytes32) {
        return _computeDigest(routeId, route_);
    }

    function _computeDigest(bytes32 routeId, Route calldata route_) internal view returns (bytes32) {
        return keccak256(abi.encode(
            routeId,
            block.chainid,
            route_.inputToken,
            route_.outputToken,
            keccak256(abi.encodePacked(route_.path)),
            keccak256(abi.encodePacked(route_.fees)),
            keccak256(abi.encodePacked(route_.pools)),
            route_.rewardFeed,
            route_.usdcFeed,
            route_.maxRewardFeedAge,
            route_.maxUsdcFeedAge,
            route_.maxInput,
            route_.minOutputBps,
            route_.maxPriceImpactBps,
            route_.maxDailyNotional,
            route_.lowerBound,
            route_.upperBound,
            route_.activationBlockHash
        ));
    }

    /// @notice Approve a swap route
    function approveRoute(bytes32 routeId, Route calldata route_) external onlyRole(ADMIN_ROLE) {
        // Validate digest (mirrors computeDigest exactly via the shared internal helper)
        bytes32 digest = _computeDigest(routeId, route_);
        if (route_.routeDigest != digest) revert DigestMismatch();

        // Validate output is USDC
        if (route_.outputToken != canonicalUsdc) revert OutputNotUsdc();

        // Validate path length (2 or 3)
        uint256 pathLen = route_.path.length;
        if (pathLen < 2 || pathLen > 3) revert InvalidPathLength();
        if (route_.path[0] != route_.inputToken) revert InvalidPathLength();
        if (route_.path[pathLen - 1] != route_.outputToken) revert InvalidPathLength();

        // Validate arrays
        uint256 hops = pathLen - 1;
        if (route_.fees.length != hops || route_.pools.length != hops) revert ArrayLengthMismatch();

        // Validate no zero/repeated tokens
        for (uint256 i = 0; i < pathLen; ++i) {
            if (route_.path[i] == address(0)) revert ZeroAddress();
            for (uint256 j = i + 1; j < pathLen; ++j) {
                if (route_.path[i] == route_.path[j]) revert InvalidPathLength();
            }
        }

        // Validate fee tiers (100, 500, 3000, 10000)
        for (uint256 i = 0; i < hops; ++i) {
            uint24 fee = route_.fees[i];
            if (fee != 100 && fee != 500 && fee != 3000 && fee != 10000) revert UnsupportedFeeTier();
        }

        // Validate pools via factory
        for (uint256 i = 0; i < hops; ++i) {
            address tIn = route_.path[i];
            address tOut = route_.path[i + 1];
            address pool = IUniswapV3Factory(factory).getPool(tIn, tOut, route_.fees[i]);
            if (pool == address(0)) revert PoolNotFound();
            if (pool.code.length == 0) revert PoolNotFound();
            // Validate token order
            address p0 = IUniswapV3Pool(pool).token0();
            address p1 = IUniswapV3Pool(pool).token1();
            address e0 = tIn < tOut ? tIn : tOut;
            address e1 = tIn < tOut ? tOut : tIn;
            if (p0 != e0 || p1 != e1) revert PoolNotFound();
        }

        // Validate feeds
        if (route_.rewardFeed == address(0) || route_.usdcFeed == address(0)) revert ZeroAddress();
        if (AggregatorV3Interface(route_.rewardFeed).decimals() > 18) revert FeedTokenMismatch();
        if (AggregatorV3Interface(route_.usdcFeed).decimals() > 18) revert FeedTokenMismatch();

        // Paper 9.4: each route must fix a maximum feed age. An unbounded
        // (zero) age is the exact staleness defect being fixed here, so it
        // cannot be configured back in.
        if (route_.maxRewardFeedAge == 0 || route_.maxUsdcFeedAge == 0) revert InvalidMaxFeedAge();

        // Validate bounds
        if (route_.minOutputBps == 0 || route_.minOutputBps > 10000) revert InvalidMinOutBps();
        if (route_.maxPriceImpactBps > 10000) revert InvalidMaxPriceImpactBps();
        if (route_.lowerBound >= route_.upperBound && route_.upperBound != 0) revert InvalidBounds();

        // Validate activation
        if (route_.activationBlockHash == bytes32(0)) revert ZeroActivationBlockHash();
        if (route_.maxInput == 0) revert InvalidMaxInput();

        // Fail closed on stale feed at approval
        _validateChainlinkPrice(route_.rewardFeed, route_.maxRewardFeedAge);
        _validateChainlinkPrice(route_.usdcFeed, route_.maxUsdcFeedAge);

        // Store route
        bool isNew = routes[routeId].inputToken == address(0);
        routes[routeId] = route_;
        if (isNew) _routeIds.push(routeId);

        emit RouteApproved(routeId, route_.inputToken, route_.outputToken);
    }

    /// @notice Revoke a swap route
    function revokeRoute(bytes32 routeId) external onlyRole(ADMIN_ROLE) {
        if (routes[routeId].inputToken == address(0)) return;
        delete routes[routeId];
        for (uint256 i = 0; i < _routeIds.length; ++i) {
            if (_routeIds[i] == routeId) {
                _routeIds[i] = _routeIds[_routeIds.length - 1];
                _routeIds.pop();
                break;
            }
        }
        emit RouteRevoked(routeId);
    }

    /// @notice Execute a swap via an approved route
    function swap(bytes32 routeId, uint256 amountIn, uint256 minAmountOut, uint256 deadline)
        external returns (uint256)
    {
        if (msg.sender != vault) revert NotVault();
        if (amountIn == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();

        Route storage r = routes[routeId];
        if (r.inputToken == address(0)) revert RouteNotFound();
        if (amountIn > r.maxInput) revert InputExceedsMax();

        _validateSequencer();
        (int256 rewardPrice, int256 usdcPrice) = _validateOracle(r);

        // Calculate floor
        uint256 expected = _oracleExpectedOut(r, amountIn, rewardPrice, usdcPrice);
        uint256 floor = Math.mulDiv(expected, r.minOutputBps, 10_000);
        if (minAmountOut < floor) minAmountOut = floor;

        // Transfer and approve
        IERC20(r.inputToken).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(r.inputToken).forceApprove(swapRouter02, amountIn);

        // Execute swap
        uint256 beforeBal = IERC20(canonicalUsdc).balanceOf(address(this));
        uint256 out;
        if (r.path.length == 2) {
            out = _swapSingleHop(r.path[0], r.path[1], r.fees[0], amountIn, minAmountOut);
        } else {
            out = _swapMultiHop(r.path, r.fees, amountIn, minAmountOut);
        }

        // Use measured balance delta
        uint256 delta = IERC20(canonicalUsdc).balanceOf(address(this)) - beforeBal;
        if (delta < out) out = delta;
        if (out < minAmountOut) revert SlippageExceeded();

        // Price impact
        uint256 priceImpactBps = (expected > out && expected > 0) ? Math.mulDiv(expected - out, 10_000, expected) : 0;
        if (priceImpactBps > r.maxPriceImpactBps) revert PriceImpactExceeded(priceImpactBps, r.maxPriceImpactBps);

        // Daily volume, replay counter and emit in one helper to avoid stack issues
        _completeSwap(routeId, r.inputToken, r.outputToken, amountIn, out, priceImpactBps, r.maxDailyNotional);

        // Transfer out
        IERC20(canonicalUsdc).safeTransfer(vault, out);
        if (IERC20(r.inputToken).allowance(address(this), swapRouter02) > 0) {
            IERC20(r.inputToken).forceApprove(swapRouter02, 0);
        }
        return out;
    }

    /// @dev Helper to update volume, bump the replay counter and emit evidence
    ///      (avoids stack-too-deep in swap). Every completed swap increments
    ///      swapCount and emits Swapped so harvests leave on-chain evidence.
    function _completeSwap(
        bytes32 rid,
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 out,
        uint256 priceImpactBps,
        uint256 maxDaily
    ) internal {
        uint256 day = block.timestamp / 86400;
        uint256 vol = dailyVolume[rid][day] + out;
        if (vol > maxDaily) revert DailyVolumeLimitExceeded();
        dailyVolume[rid][day] = vol;
        swapCount[rid] += 1;
        emit Swapped(rid, inputToken, outputToken, amountIn, out, priceImpactBps);
    }

    // ---- Internal Functions ----

    function _validateSequencer() internal view {
        if (sequencerFeed == address(0)) return;
        // Check sequencer status: answer != 0 means sequencer is down
        // answer == 0 means sequencer is up
        (,, uint256 startedAt, uint256 updatedAt,) = AggregatorV3Interface(sequencerFeed).latestRoundData();
        if (updatedAt == 0) revert RoundNotStarted();
        int256 answer = AggregatorV3Interface(sequencerFeed).latestAnswer();
        // If answer != 0, sequencer is down - check grace period
        if (answer != 0) {
            uint256 graceEnd = startedAt + recoveryGrace;
            if (block.timestamp < graceEnd) revert SequencerDown();
        }
    }

    function _validateOracle(Route storage route) internal view returns (int256 rewardPrice, int256 usdcPrice) {
        rewardPrice = _validateChainlinkPrice(route.rewardFeed, route.maxRewardFeedAge);
        usdcPrice = _validateChainlinkPrice(route.usdcFeed, route.maxUsdcFeedAge);

        uint256 p = uint256(rewardPrice);
        if (p < route.lowerBound && route.lowerBound != 0) revert InvalidChainlinkPrice();
        if (route.upperBound != 0 && p > route.upperBound) revert InvalidChainlinkPrice();
    }

    /// @dev Paper 9.4: each route fixes a maximum feed age. Round completeness
    ///      and a non-zero updatedAt were checked, but updatedAt was never
    ///      compared to block.timestamp, so a feed frozen indefinitely passed.
    function _validateChainlinkPrice(address feed, uint256 maxAge) internal view returns (int256 price) {
        uint80 roundId;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
        (roundId, price, startedAt, updatedAt, answeredInRound) = AggregatorV3Interface(feed).latestRoundData();
        if (startedAt == 0) revert RoundNotStarted();
        if (answeredInRound < roundId) revert RoundIncomplete();
        if (price <= 0) revert InvalidChainlinkPrice();
        if (updatedAt == 0 || updatedAt > block.timestamp) revert StaleChainlinkPrice();
        if (block.timestamp - updatedAt > maxAge) revert StaleChainlinkPrice();
    }

    function _oracleExpectedOut(Route storage route, uint256 amountIn, int256 rewardPrice, int256 usdcPrice)
        internal
        view
        returns (uint256)
    {
        uint8 inDec = IERC20Metadata(route.inputToken).decimals();
        uint256 rPrice = uint256(rewardPrice);
        uint256 uPrice = uint256(usdcPrice);
        // USDC always has 6 decimals - this is the target output precision
        // Formula: amountIn * (reward/USD) / 10^inDec * 10^6 / (usdc/USD)
        // = amountIn * rPrice * 10^6 / (10^inDec * uPrice)
        uint256 base = Math.mulDiv(amountIn, rPrice, 10 ** inDec);
        return Math.mulDiv(base, 1e6, uPrice);
    }

    function _swapSingleHop(address tIn, address tOut, uint24 fee, uint256 amountIn, uint256 minOut)
        internal returns (uint256)
    {
        bytes memory path = abi.encodePacked(tIn, fee, tOut);
        return ISwapRouter02(swapRouter02).exactInput(
            ISwapRouter02.ExactInputParams({
                path: path,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _swapMultiHop(address[] memory pathTokens, uint24[] memory fees, uint256 amountIn, uint256 minOut)
        internal returns (uint256)
    {
        bytes memory path = abi.encodePacked(pathTokens[0]);
        for (uint256 i = 0; i < fees.length; ++i) {
            path = bytes.concat(path, abi.encodePacked(fees[i], pathTokens[i + 1]));
        }
        return ISwapRouter02(swapRouter02).exactInput(
            ISwapRouter02.ExactInputParams({
                path: path,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    // ---- Accessors ----

    function getRoute(bytes32 routeId) external view returns (Route memory) {
        return routes[routeId];
    }

    function getRouteIds() external view returns (bytes32[] memory) {
        return _routeIds;
    }

    function isRouteApproved(bytes32 routeId) external view returns (bool) {
        return routes[routeId].inputToken != address(0);
    }
}

// ---- Interfaces ----

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestAnswer() external view returns (int256);
    function latestRoundData()
        external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}
