// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRewardSource} from "./interfaces/IRewardSource.sol";
import {IAggregatorV3} from "./interfaces/chainlink/IAggregatorV3.sol";
import {ISwapRouter02} from "./interfaces/uniswap/ISwapRouter02.sol";

/// @notice Executes reward harvesting by claiming from adapters and swapping to USDC
contract RewardExecutor is AccessControl {
    using SafeERC20 for IERC20;

    /// @notice Role that can trigger harvests
    bytes32 public constant ALLOCATOR_ROLE = keccak256("ALLOCATOR_ROLE");

    /// @notice Vault that receives harvested USDC
    address public immutable vault;

    /// @notice USDC token
    address public immutable usdc;

    /// @notice Uniswap V3 SwapRouter
    ISwapRouter02 public immutable router;

    /// @notice Route configuration (storage struct)
    struct Route {
        address inputToken;
        bytes path;           // Encoded V3 path
        address outputToken;
        address oracleFeed;   // Chainlink price feed
        uint256 maxOracleAge;
        uint256 maxPriceImpactBps;
        uint256 maxDailyNotional;
        bool enabled;
    }

    /// @notice Route data cache (memory struct to reduce stack pressure)
    struct RouteData {
        address inputToken;
        bytes path;
        address oracleFeed;
        uint256 maxOracleAge;
        uint256 maxDailyNotional;
        uint256 maxPriceImpactBps;
        bool enabled;
    }

    /// @notice Route registry - split into individual mappings for struct member access
    mapping(bytes32 => address) public routeInputToken;
    mapping(bytes32 => bytes) public routePath;
    mapping(bytes32 => address) public routeOutputToken;
    mapping(bytes32 => address) public routeOracleFeed;
    mapping(bytes32 => uint256) public routeMaxOracleAge;
    mapping(bytes32 => uint256) public routeMaxPriceImpactBps;
    mapping(bytes32 => uint256) public routeMaxDailyNotional;
    mapping(bytes32 => bool) public routeEnabled;

    /// @notice Daily notional consumed per route (UTC day index)
    mapping(bytes32 => mapping(uint256 => uint256)) public dailyNotional;

    /// @notice Decision hashes that have been used
    mapping(bytes32 => bool) public usedDecisions;

    /// @notice Events
    event RouteSet(bytes32 indexed routeId, Route route);
    event RouteDisabled(bytes32 indexed routeId);
    event Harvested(
        address indexed adapter,
        address indexed rewardToken,
        bytes32 indexed routeId,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 decisionHash
    );

    /// @notice Errors
    error RouteDisabledError();
    error DailyCapExceeded();
    error InsufficientOutput();
    error StaleOracle();
    error PriceImpactTooHigh();
    error InvalidPath();
    error DecisionAlreadyUsed();

    constructor(
        address vault_,
        address admin_,
        address router_,
        address usdc_
    ) {
        require(vault_ != address(0), "zero vault");
        require(admin_ != address(0), "zero admin");
        require(router_ != address(0), "zero router");
        require(usdc_ != address(0), "zero usdc");

        vault = vault_;
        router = ISwapRouter02(router_);
        usdc = usdc_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Admin: set or update a route
    function setRoute(bytes32 routeId, Route calldata route) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(route.outputToken == usdc, "Must output USDC");
        require(route.inputToken != usdc, "Input must not be USDC");
        // Only require non-empty path if the route is enabled
        if (route.enabled) {
            require(route.path.length > 0, "Invalid path");
        }
        require(route.maxPriceImpactBps <= 1000, "Price impact too high");

        routeInputToken[routeId] = route.inputToken;
        routePath[routeId] = route.path;
        routeOutputToken[routeId] = route.outputToken;
        routeOracleFeed[routeId] = route.oracleFeed;
        routeMaxOracleAge[routeId] = route.maxOracleAge;
        routeMaxPriceImpactBps[routeId] = route.maxPriceImpactBps;
        routeMaxDailyNotional[routeId] = route.maxDailyNotional;
        routeEnabled[routeId] = route.enabled;

        emit RouteSet(routeId, route);
    }

    /// @notice Admin: disable a route
    function disableRoute(bytes32 routeId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        routeEnabled[routeId] = false;
        emit RouteDisabled(routeId);
    }

    /// @notice Allocator: harvest rewards via approved route
    function harvest(
        address adapter,
        address rewardToken,
        bytes32 routeId,
        uint256 amountIn,
        uint256 minOut,
        uint256 deadline,
        bytes32 decisionHash
    ) external onlyRole(ALLOCATOR_ROLE) returns (uint256 amountOut) {
        // Validate inputs
        require(amountIn > 0);
        if (usedDecisions[decisionHash]) revert DecisionAlreadyUsed();
        require(block.timestamp <= deadline, "Expired deadline");

        // Cache route data into memory struct to reduce stack pressure
        RouteData memory routeData = _loadRouteData(routeId);
        require(rewardToken == routeData.inputToken, "Wrong token");
        if (!routeData.enabled) revert RouteDisabledError();

        // Verify oracle freshness and check daily cap
        _verifyOracle(routeData.oracleFeed, routeData.maxOracleAge);
        _checkDailyCap(routeId, amountIn, routeData.maxDailyNotional);

        // Mark decision as used
        usedDecisions[decisionHash] = true;

        // Claim rewards and execute swap
        amountOut = _executeSwap(adapter, rewardToken, routeData, amountIn, minOut, routeData.maxPriceImpactBps);

        // Update daily notional tracking
        uint256 todayIndex = block.timestamp / 1 days;
        dailyNotional[routeId][todayIndex] += amountIn;

        emit Harvested(adapter, rewardToken, routeId, amountIn, amountOut, decisionHash);
    }

    /// @notice Internal helper to cache route data
    function _loadRouteData(bytes32 routeId) internal view returns (RouteData memory) {
        return RouteData({
            inputToken: routeInputToken[routeId],
            path: routePath[routeId],
            oracleFeed: routeOracleFeed[routeId],
            maxOracleAge: routeMaxOracleAge[routeId],
            maxDailyNotional: routeMaxDailyNotional[routeId],
            maxPriceImpactBps: routeMaxPriceImpactBps[routeId],
            enabled: routeEnabled[routeId]
        });
    }

    /// @notice Internal helper to check daily notional cap
    function _checkDailyCap(bytes32 routeId, uint256 amountIn, uint256 dailyCap) internal view {
        uint256 todayIndex = block.timestamp / 1 days;
        uint256 dailyUsed = dailyNotional[routeId][todayIndex];
        if (dailyUsed + amountIn > dailyCap) revert DailyCapExceeded();
    }

    /// @notice Internal helper to execute the swap
    function _executeSwap(
        address adapter,
        address rewardToken,
        RouteData memory routeData,
        uint256 amountIn,
        uint256 minOut,
        uint256 maxPriceImpactBps
    ) internal returns (uint256) {
        // Cache route path to avoid stack too deep
        bytes memory path = routeData.path;

        // Step 1: Claim rewards from adapter
        IERC20 rewardIERC20 = IERC20(rewardToken);
        uint256 beforeBalance = rewardIERC20.balanceOf(address(this));
        IRewardSource(adapter).claimReward(rewardToken, amountIn);
        uint256 claimed = rewardIERC20.balanceOf(address(this)) - beforeBalance;

        if (claimed == 0) return 0;

        // Step 2: Approve router
        rewardIERC20.forceApprove(address(router), claimed);

        // Step 3: Get oracle price for minOut and price impact verification
        uint256 expectedOut = _getOracleFloor(routeData.oracleFeed, claimed);
        // Normalize expectedOut to USDC decimals (6) for comparison with actualOut
        uint256 expectedOutUSDC = expectedOut / 1e12;
        uint256 actualMinOut = minOut > expectedOutUSDC ? minOut : expectedOutUSDC;

        // Step 4: Execute swap
        IERC20 usdcIERC20 = IERC20(usdc);
        uint256 usdcBefore = usdcIERC20.balanceOf(vault);

        router.exactInput(ISwapRouter02.ExactInputParams({
            path: path,
            recipient: vault,
            amountIn: claimed,
            amountOutMinimum: actualMinOut
        }));

        // Step 5: Reset allowance
        rewardIERC20.forceApprove(address(router), 0);

        // Step 6: Verify output
        uint256 amountOut = usdcIERC20.balanceOf(vault) - usdcBefore;
        if (amountOut < actualMinOut) revert InsufficientOutput();

        // Step 7: Validate price impact
        _validatePriceImpact(expectedOut, amountOut, maxPriceImpactBps);

        return amountOut;
    }

    /// @notice Validate that actual price impact does not exceed maxPriceImpactBps
    /// @dev expectedOut is in reward token decimals (18), actualOut is in USDC decimals (6)
    ///      We normalize actualOut to reward token decimals by multiplying by 1e12
    function _validatePriceImpact(uint256 expectedOut, uint256 actualOut, uint256 maxPriceImpactBps) internal pure {
        if (maxPriceImpactBps == 0) return; // Skip validation if set to 0

        // Normalize actualOut to reward token decimals (18) by multiplying by 1e12
        // actualOut is in USDC (6 dec), expectedOut is in reward token (18 dec)
        uint256 normalizedActual = actualOut * 1e12;
        if (expectedOut == 0) return; // Avoid division by zero

        // Calculate price impact in bps: (expected - actual) * 10_000 / expected
        uint256 priceImpactBps = (expectedOut - normalizedActual) * 10_000 / expectedOut;
        if (priceImpactBps > maxPriceImpactBps) revert PriceImpactTooHigh();
    }

    /// @notice Check oracle price and revert if stale
    function _verifyOracle(address feed, uint256 maxAge) internal view {
        (, int256 answer, , uint256 updatedAt,) = IAggregatorV3(feed).latestRoundData();
        require(answer > 0, "Invalid oracle answer");
        if (block.timestamp - updatedAt > maxAge) revert StaleOracle();
    }

    /// @notice Get minimum output from oracle price
    /// @dev Assumes reward token price is ~$1 USD (1 USDC), so oracle returns ~1e8
    ///      and the output in USDC (6 decimals) is: amountIn * 1e6 / 1e18 (scaled)
    ///      Chainlink returns 8 decimals for price (e.g., 1e8 = $1)
    ///      Formula: minOut = amountIn * price / 1e8
    ///      This assumes reward tokens are ~$1 stablecoins with 18 decimals
    function _getOracleFloor(address feed, uint256 amountIn) internal view returns (uint256) {
        (, int256 answer, , ,) = IAggregatorV3(feed).latestRoundData();

        // Chainlink returns 8 decimals for price
        // Assuming ~$1 reward token price (1 USDC), answer is ~1e8
        // minOut = amountIn * price / 1e8
        return uint256(answer) * amountIn / 1e8;
    }

    /// @notice Get current daily used notional for a route
    function getDailyUsed(bytes32 routeId) external view returns (uint256) {
        uint256 todayIndex = block.timestamp / 1 days;
        return dailyNotional[routeId][todayIndex];
    }
}
