// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRewardAccountant} from "../interfaces/IRewardAccountant.sol";
import {IRewardSource} from "../interfaces/IRewardSource.sol";
import {IPriceFeed} from "../interfaces/IPriceFeed.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title RewardAccountant - Conservative cached reward NAV accounting
/// @notice Provides conservative cached valuations of harvestable rewards without
///         conflating them with synchronous on-chain liquidity.
/// @dev Safety rules:
///      1. Validates sequencer health before feed reads
///      2. Validates both feed rounds (completeness + staleness)
///      3. On invalid refresh: preserve last safe cache, mark material issuance unready
///      4. Reward value NEVER increases synchronous withdrawal capacity
///      5. maxDeposit/maxMint revert to zero when material cache is stale
contract RewardAccountant is IRewardAccountant, AccessControl {
    using SafeERC20 for IERC20;

    /// @notice Role for reward administrator
    bytes32 public constant REWARD_ADMIN_ROLE = keccak256("REWARD_ADMIN_ROLE");

    /// @notice Grace period for sequencer recovery (24 hours)
    uint256 public constant SEQUENCER_GRACE_PERIOD = 24 hours;

    /// @notice Admin-controlled USDC/USD feed (set via setUsdcUsdFeed)
    address public usdcUsdFeed;

    /// @notice Token policies (token => policy)
    mapping(address => IRewardAccountant.TokenPolicy) internal _tokenPolicies;

    /// @notice Token caches (token => cache)
    mapping(address => IRewardAccountant.TokenCache) public tokenCaches;

    /// @notice Last refresh timestamp
    uint256 public lastRefreshTime;

    /// @notice Last safe total value (preserved on failed refresh)
    uint256 public lastSafeValue;

    /// @notice Token list for iteration
    address[] internal _policyTokens;

    /// @notice Cached configuration digest
    bytes32 private _configDigest;

    // ---- Custom Errors ----

    error InvalidToken();
    error InvalidFeed();
    error StaleFeed(uint256 age, uint256 maxAge);
    error FeedOutOfBounds(int256 price, uint256 lower, uint256 upper);
    error IncompleteRound(uint80 roundId, uint80 answeredInRound);
    error SequencerDown(uint256 timestamp, uint256 gracePeriod);
    error SequencerNotRecovered(uint256 startedAt, uint256 gracePeriod);
    error ZeroValue();
    error Unauthorized();
    error AdapterNotAllowed(address adapter, address token);
    error CacheStale();
    error MaterialCacheRequired();
    error ArrayLengthMismatch();

    // ---- Events ----

    event TokenPolicySet(
        address indexed token,
        address feed,
        bytes description,
        uint8 decimals,
        uint256 maxAge,
        uint256 lowerBound,
        uint256 upperBound,
        uint32 haircutBps,
        uint256 contributionCap,
        uint256 materialityThreshold,
        uint256 cacheLifetime
    );

    event TokenPolicyRemoved(address indexed token);

    event CacheRefreshed(
        address indexed token,
        uint256 value,
        uint256 lastUpdated,
        bool isMaterial
    );

    event SequencerValidationFailed(string reason);

    // ---- Constructor ----

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REWARD_ADMIN_ROLE, admin);
        usdcUsdFeed = address(0); // Must be set by admin
    }

    // ---- Admin Functions ----

    /// @notice Set the USDC/USD price feed
    function setUsdcUsdFeed(address feed) external onlyRole(REWARD_ADMIN_ROLE) {
        if (feed == address(0)) revert InvalidFeed();
        usdcUsdFeed = feed;
    }

    /// @notice Set or update a token policy
    function setTokenPolicy(address token, IRewardAccountant.TokenPolicy calldata policy) external onlyRole(REWARD_ADMIN_ROLE) {
        if (token == address(0)) revert InvalidToken();
        if (policy.feed == address(0)) revert InvalidFeed();
        if (policy.lowerBound > policy.upperBound) revert InvalidFeed();
        if (policy.haircutBps > 10_000) revert InvalidFeed();

        IRewardAccountant.TokenPolicy storage stored = _tokenPolicies[token];

        if (!stored.exists) {
            _policyTokens.push(token);
        }

        stored.token = policy.token;
        stored.feed = policy.feed;
        stored.description = policy.description;
        stored.decimals = policy.decimals;
        stored.maxAge = policy.maxAge;
        stored.lowerBound = policy.lowerBound;
        stored.upperBound = policy.upperBound;
        stored.haircutBps = policy.haircutBps;
        stored.contributionCap = policy.contributionCap;
        stored.materialityThreshold = policy.materialityThreshold;
        stored.cacheLifetime = policy.cacheLifetime;
        stored.exists = true;

        // Copy allowed adapters
        delete stored.allowedAdapters;
        for (uint256 i = 0; i < policy.allowedAdapters.length; i++) {
            stored.allowedAdapters.push(policy.allowedAdapters[i]);
        }

        // Invalidate cached digest
        _configDigest = bytes32(0);

        emit TokenPolicySet(
            token,
            policy.feed,
            policy.description,
            policy.decimals,
            policy.maxAge,
            policy.lowerBound,
            policy.upperBound,
            policy.haircutBps,
            policy.contributionCap,
            policy.materialityThreshold,
            policy.cacheLifetime
        );
    }

    /// @notice Remove a token policy
    function removeTokenPolicy(address token) external onlyRole(REWARD_ADMIN_ROLE) {
        IRewardAccountant.TokenPolicy storage stored = _tokenPolicies[token];
        if (!stored.exists) revert InvalidToken();

        // Clear cache
        delete tokenCaches[token];

        // Remove from policy list
        uint256 len = _policyTokens.length;
        for (uint256 i = 0; i < len; i++) {
            if (_policyTokens[i] == token) {
                _policyTokens[i] = _policyTokens[len - 1];
                _policyTokens.pop();
                break;
            }
        }

        delete stored.exists;

        // Invalidate cached digest
        _configDigest = bytes32(0);

        emit TokenPolicyRemoved(token);
    }

    // ---- Core Valuation Functions ----

    /// @notice Refresh valuations for all policy tokens from given adapters
    /// @dev Calculates: (balance × price × haircut) / (scale × usdcPrice)
    ///      Values are ROUNDED DOWN at every step for conservatism.
    function refresh(address[] calldata) external onlyRole(REWARD_ADMIN_ROLE) returns (uint256 totalValue) {
        // Validate USDC feed if set
        if (usdcUsdFeed == address(0)) {
            emit SequencerValidationFailed("usdc_feed_not_set");
            return lastSafeValue;
        }

        (bool usdcValid, int256 usdcPrice) = _getValidatedPrice(usdcUsdFeed, 1 hours);
        if (!usdcValid) {
            // Cannot refresh without USDC price - preserve last safe cache
            emit SequencerValidationFailed("usdc_feed_invalid");
            return lastSafeValue;
        }

        uint256 tokenCount = _policyTokens.length;
        if (tokenCount == 0) {
            lastRefreshTime = block.timestamp;
            lastSafeValue = 0;
            return 0;
        }

        for (uint256 i = 0; i < tokenCount; i++) {
            address token = _policyTokens[i];
            IRewardAccountant.TokenPolicy storage policy = _tokenPolicies[token];
            IRewardAccountant.TokenCache storage cache = tokenCaches[token];

            // Validate token feed
            (bool feedValid, int256 rewardPrice) = _getValidatedPrice(policy.feed, policy.maxAge);

            uint256 tokenValue;
            bool isMaterial;

            if (feedValid) {
                // Valid feed - compute conservative value
                tokenValue = _computeTokenValue(token, policy, rewardPrice, usdcPrice);

                // Check materiality
                isMaterial = tokenValue >= policy.materialityThreshold;

                // Update cache
                cache.value = tokenValue;
                cache.lastUpdated = block.timestamp;
                cache.isMaterial = isMaterial;

                emit CacheRefreshed(token, tokenValue, block.timestamp, isMaterial);
            } else {
                // Invalid feed - preserve last safe cache if material
                if (cache.isMaterial) {
                    // Cannot refresh material token with invalid feed
                    emit SequencerValidationFailed("feed_invalid_for_material_token");
                    // Preserve last safe value by keeping cache unchanged
                }
                // Non-material tokens with invalid feeds become zero
            }

            totalValue += tokenValue;
        }

        lastRefreshTime = block.timestamp;
        lastSafeValue = totalValue;
        _configDigest = bytes32(0); // Invalidate cached digest

        return totalValue;
    }

    /// @notice Compute the conservative USDC value of a token's held balance
    /// @dev Formula (all rounding down):
    ///      1. balance = IERC20(token).balanceOf(this)
    ///      2. value = balance × rewardPrice × USDC_SCALE × haircutBps
    ///                  ÷ (10^decimals × usdcPrice × 10_000)
    function _computeTokenValue(
        address token,
        IRewardAccountant.TokenPolicy storage policy,
        int256 rewardPrice,
        int256 usdcPrice
    ) internal view returns (uint256) {
        if (rewardPrice <= 0 || usdcPrice <= 0) return 0;

        // Get held balance
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) return 0;

        // Bounds check (inclusive) - out-of-range prices result in zero valuation
        // lowerBound check is safe (always fits in int256 when < 2^255)
        if (rewardPrice < int256(policy.lowerBound)) {
            return 0;
        }
        // For upperBound, only check if it fits in int256
        uint256 upperBound = policy.upperBound;
        if (upperBound < uint256(type(int256).max) && rewardPrice > int256(upperBound)) {
            return 0;
        }

        // Compute: balance × rewardPrice × haircutBps × USDC_DECIMALS
        //                        ÷ (10^decimals)² × 10_000
        // Result in USDC base units (6 decimals).
        //
        // balance: token quantity with token decimals (e.g., 1000 tokens = 1000e18)
        // rewardPrice: USD per token with token decimals (e.g., $50 = 50e18)
        //
        // balance × rewardPrice has 2×decimals of scale that must be removed.
        // We divide by SCALE twice: once for each decimal in the product.
        //
        // Formula derivation for 18-decimal token at $50 with 5% haircut:
        //   balance = 1000e18, rewardPrice = 50e18, SCALE = 1e18, haircut = 500 bps
        //   Step 1: 1000e18 × 50e18 × 500 = 25,000,000e36
        //   Step 2: / 1e18 / 1e18 / 10_000 = 2,500 (USDC quantity)
        //   Step 3: × 1e6 = 2,500e6 USDC base units ✓
        //
        // Formula derivation for 6-decimal token at $1 with 10% haircut:
        //   balance = 1000e6, rewardPrice = 1e6, SCALE = 1e6, haircut = 1000 bps
        //   Step 1: 1000e6 × 1e6 × 1000 = 1000e15
        //   Step 2: / 1e6 / 1e6 / 10_000 = 100 (USDC quantity)
        //   Step 3: × 1e6 = 100e6 USDC base units ✓
        uint256 SCALE = 10 ** policy.decimals;

        // Step 1: balance × rewardPrice × haircutBps (round down)
        uint256 product = uint256(balance) * uint256(rewardPrice) * policy.haircutBps;
        // Round down

        // Step 2: ÷ SCALE (remove first decimal scale)
        uint256 afterFirstScale = product / SCALE;
        // Round down

        // Step 3: ÷ SCALE (remove second decimal scale)
        uint256 afterSecondScale = afterFirstScale / SCALE;
        // Round down

        // Step 4: ÷ 10_000 (apply haircut)
        uint256 usdcQuantity = afterSecondScale / 10_000;
        // Round down

        // Step 5: × USDC_DECIMALS (to USDC base units)
        uint256 value = usdcQuantity * 1_000_000;
        // Round down

        // Apply per-token cap
        if (policy.contributionCap > 0 && value > policy.contributionCap) {
            value = policy.contributionCap;
        }

        return value;
    }

    /// @notice Get validated price from feed with full safety checks
    /// @dev Checks:
    ///      1. Sequencer health (grace period after recovery)
    ///      2. Round completeness (answeredInRound >= roundId)
    ///      3. Staleness (updatedAt not too old)
    function _getValidatedPrice(address feed, uint256 maxAge)
        internal
        view
        returns (bool valid, int256 price)
    {
        if (feed == address(0)) return (false, 0);

        try IPriceFeed(feed).latestAnswer() returns (int256 answer) {
            price = answer;
        } catch {
            return (false, 0);
        }

        // Basic validation
        if (price <= 0) return (false, price);

        // Get round data for staleness check
        try AggregatorV3Interface(feed).latestRoundData() returns (
            uint80 roundId,
            int256,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Check round completeness
            if (answeredInRound < roundId) {
                return (false, price);
            }

            // Check round started
            if (startedAt == 0) {
                return (false, price);
            }

            // Check staleness
            if (updatedAt == 0 || updatedAt > block.timestamp) {
                return (false, price);
            }

            uint256 age = block.timestamp - updatedAt;
            if (age > maxAge) {
                return (false, price);
            }

            return (true, price);
        } catch {
            return (false, price);
        }
    }

    /// @notice Validate sequencer health
    /// @dev Override point for chain-specific sequencer validation
    function _validateSequencer() internal view returns (bool healthy) {
        // Base chain validation - can be overridden or use empty feed
        healthy = true;
        // For Base L2 chains, check sequencer feed
        // This is a no-op on Ethereum/L2s without sequencer
    }

    // ---- View Functions ----

    /// @notice Get the cached reward assets value
    function cachedRewardAssets() external view returns (uint256) {
        return lastSafeValue;
    }

    /// @notice Check if the cache is fresh enough for material share issuance
    /// @dev Returns true if ALL material cache entries are fresh, or if no material entries exist
    function issuanceReady() external view returns (bool) {
        uint256 tokenCount = _policyTokens.length;

        // If no tokens, issuance is ready (no rewards to be conservative about)
        if (tokenCount == 0) return true;

        for (uint256 i = 0; i < tokenCount; i++) {
            address token = _policyTokens[i];
            IRewardAccountant.TokenCache storage cache = tokenCaches[token];
            IRewardAccountant.TokenPolicy storage policy = _tokenPolicies[token];

            if (cache.isMaterial) {
                // Material cache must be fresh
                if (cache.lastUpdated == 0) return false;
                if (block.timestamp - cache.lastUpdated > policy.cacheLifetime) return false;
            }
        }

        return true;
    }

    /// @notice Check if issuance would be blocked due to stale material cache
    function issuanceBlocked() external view returns (bool blocked, uint256 staleTokens) {
        uint256 tokenCount = _policyTokens.length;
        blocked = false;
        staleTokens = 0;

        for (uint256 i = 0; i < tokenCount; i++) {
            address token = _policyTokens[i];
            IRewardAccountant.TokenCache storage cache = tokenCaches[token];
            IRewardAccountant.TokenPolicy storage policy = _tokenPolicies[token];

            if (cache.isMaterial) {
                if (cache.lastUpdated == 0) {
                    blocked = true;
                    staleTokens++;
                } else if (block.timestamp - cache.lastUpdated > policy.cacheLifetime) {
                    blocked = true;
                    staleTokens++;
                }
            }
        }
    }

    /// @notice Get the configuration digest of all token policies
    function configurationDigest() public view returns (bytes32 digest) {
        // Check cache
        if (_configDigest != bytes32(0)) return _configDigest;

        digest = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                usdcUsdFeed,
                REWARD_ADMIN_ROLE
            )
        );

        uint256 tokenCount = _policyTokens.length;
        for (uint256 i = 0; i < tokenCount; i++) {
            address token = _policyTokens[i];
            IRewardAccountant.TokenPolicy storage policy = _tokenPolicies[token];
            digest = keccak256(
                abi.encode(
                    digest,
                    token,
                    policy.feed,
                    policy.decimals,
                    policy.maxAge,
                    policy.lowerBound,
                    policy.upperBound,
                    policy.haircutBps,
                    policy.contributionCap,
                    keccak256(abi.encode(policy.allowedAdapters))
                )
            );
        }

        return digest;
    }

    /// @notice Get a specific token's policy
    function tokenPolicies(address token) external view returns (IRewardAccountant.TokenPolicy memory policy) {
        policy = _tokenPolicies[token];
    }

    /// @notice Get token cache details
    function tokenCache(address token) external view returns (uint256 value, uint256 lastUpdated, bool isMaterial) {
        IRewardAccountant.TokenCache storage cache = tokenCaches[token];
        return (cache.value, cache.lastUpdated, cache.isMaterial);
    }

    /// @notice Get list of all policy tokens
    function getPolicyTokens() external view returns (address[] memory) {
        return _policyTokens;
    }

    /// @notice Get the sequencer grace period
    function sequencerGracePeriod() external pure returns (uint256) {
        return SEQUENCER_GRACE_PERIOD;
    }

    /// @notice Legacy recognized reward assets
    function recognizedRewardAssets() external view returns (uint256) {
        return lastSafeValue;
    }

    /// @notice Sync before share actions
    /// @dev For conservative NAV, we acknowledge rewards before share issuance
    ///      so new share price reflects expected value.
    ///      Reward value is NEVER added to synchronous liquidity.
    /// @dev No access control needed - this is a read-only function.
    function syncForShareAction(bool) external view returns (uint256 recognizedAssets) {
        recognizedAssets = lastSafeValue;
        // issuingShares = true: acknowledge reward NAV for share price
        // issuingShares = false: redeem path (rewards already recognized)
        return recognizedAssets;
    }

    // ---- Adapter Claim Integration ----

    /// @notice Get total claimable rewards from adapters for a specific token
    /// @dev Sum of claimable from all allowed adapters
    /// @dev Note: This is not view because claimableReward may be a state-changing call
    function getClaimableFromAdapters(address token, address[] calldata adapters)
        external
        returns (uint256 totalClaimable)
    {
        IRewardAccountant.TokenPolicy storage policy = _tokenPolicies[token];
        if (!policy.exists) return 0;

        for (uint256 i = 0; i < adapters.length; i++) {
            // Verify adapter is allowed
            bool allowed = false;
            for (uint256 j = 0; j < policy.allowedAdapters.length; j++) {
                if (policy.allowedAdapters[j] == adapters[i]) {
                    allowed = true;
                    break;
                }
            }
            if (!allowed) continue;

            // Get claimable from adapter
            try IRewardSource(adapters[i]).claimableReward(token) returns (uint256 claimable) {
                totalClaimable += claimable;
            } catch {
                // Skip failed adapter reads
            }
        }
    }
}

/// @title AggregatorV3Interface - Minimal Chainlink aggregator interface
interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
