// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRewardAccountant} from "../interfaces/IRewardAccountant.sol";
import {IRewardSource} from "../interfaces/IRewardSource.sol";
import {IPriceFeed} from "../interfaces/IPriceFeed.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title RewardAccountant - Conservative cached reward NAV accounting
/// @notice Provides conservative cached valuations of harvestable rewards without
///         conflating them with synchronous on-chain liquidity.
/// @dev Safety rules:
///      1. Validates sequencer health before feed reads
///      2. Validates both feed rounds (completeness + staleness)
///      3. On invalid refresh: the token's cache ENTRY is preserved but that
///         token contributes nothing to the round's total - a stale or invalid
///         source can never raise recognized NAV. The aggregate
///         `lastSafeValue` is therefore the new (lower) total, not the prior
///         one; it is conservative, not sticky.
///      4. Reward value NEVER increases synchronous withdrawal capacity
///      5. maxDeposit/maxMint revert to zero when material cache is stale
contract RewardAccountant is IRewardAccountant, AccessControl {
    using SafeERC20 for IERC20;

    /// @notice Role for reward administrator
    bytes32 public constant REWARD_ADMIN_ROLE = keccak256("REWARD_ADMIN_ROLE");

    /// @notice Grace period for sequencer recovery (24 hours)
    uint256 public constant SEQUENCER_GRACE_PERIOD = 24 hours;

    /// @notice Default maximum accepted age for the USDC/USD leg.
    /// @dev Sized to the published heartbeat of Chainlink's USDC/USD feed on
    ///      Base: 86400s (24h) with a 0.3% deviation threshold
    ///      (reference-data-directory, feeds-ethereum-mainnet-base-1.json).
    ///      A stable asset rarely breaches a 0.3% band, so that feed normally
    ///      publishes only on its heartbeat. Bounding the USDC leg below the
    ///      heartbeat would make it invalid for most of any given day, which
    ///      turns paper 9.2's lazy refresh into a no-op and leaves deposits
    ///      closed - the exact failure this bound exists to avoid.
    uint256 public constant DEFAULT_USDC_FEED_MAX_AGE = 24 hours;

    /// @notice Hard ceiling on the configurable USDC/USD max age.
    /// @dev Two heartbeats. An admin may tighten the bound (down to 1 second)
    ///      but may not configure unbounded staleness back in.
    uint256 public constant MAX_USDC_FEED_MAX_AGE = 48 hours;

    /// @notice Admin-controlled USDC/USD feed (set via setUsdcUsdFeed)
    address public usdcUsdFeed;

    /// @notice Maximum accepted age of the USDC/USD feed's `updatedAt`, in
    ///         seconds, for both refresh() and the paper 9.2 lazy refresh.
    ///         Configurable via setUsdcFeedMaxAge within
    ///         (0, MAX_USDC_FEED_MAX_AGE].
    uint256 public usdcFeedMaxAge;

    /// @notice The vault authorised to trigger a lazy reward sync on its own
    ///         share-changing actions (set via setVault). Paper 9.2: this is
    ///         a narrow, single-purpose authorisation distinct from
    ///         REWARD_ADMIN_ROLE, which also grants policy/feed control.
    address public vault;

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
    error InvalidUsdcFeedMaxAge();
    error RewardTokenIsVaultAsset();

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

    event UsdcFeedMaxAgeSet(uint256 maxAge);

    // ---- Constructor ----

    /// @param admin      Holder of DEFAULT_ADMIN_ROLE and REWARD_ADMIN_ROLE.
    /// @param vault_      The vault authorised to call syncForShareAction.
    ///                    Passed at construction so a deployment cannot ship a
    ///                    vault whose every deposit/mint reverts Unauthorized
    ///                    when the broadcaster is not `admin` and therefore
    ///                    cannot call setVault afterwards. Pass address(0)
    ///                    deliberately to defer the wiring to setVault.
    constructor(address admin, address vault_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REWARD_ADMIN_ROLE, admin);
        usdcUsdFeed = address(0); // Must be set by admin
        usdcFeedMaxAge = DEFAULT_USDC_FEED_MAX_AGE;
        vault = vault_;
    }

    // ---- Admin Functions ----

    /// @notice Set the USDC/USD price feed
    function setUsdcUsdFeed(address feed) external onlyRole(REWARD_ADMIN_ROLE) {
        if (feed == address(0)) revert InvalidFeed();
        usdcUsdFeed = feed;
    }

    /// @notice Set the maximum accepted age of the USDC/USD feed.
    /// @dev Must be non-zero (zero would mean "only a same-block update is
    ///      acceptable", freezing every refresh) and at most
    ///      MAX_USDC_FEED_MAX_AGE (so staleness cannot be configured back in).
    function setUsdcFeedMaxAge(uint256 maxAge) external onlyRole(REWARD_ADMIN_ROLE) {
        if (maxAge == 0 || maxAge > MAX_USDC_FEED_MAX_AGE) revert InvalidUsdcFeedMaxAge();
        usdcFeedMaxAge = maxAge;
        emit UsdcFeedMaxAgeSet(maxAge);
    }

    /// @notice Authorise the vault to call syncForShareAction directly,
    ///         without widening REWARD_ADMIN_ROLE (which also controls
    ///         policies and feeds) to a contract address. Pass address(0) to
    ///         revoke.
    function setVault(address vault_) external onlyRole(REWARD_ADMIN_ROLE) {
        // The vault is also the reward HOLDER (see _rewardHolder), so a policy
        // on the vault's own underlying asset would count that asset twice:
        // once in NavyVaultSRCLA.totalAssets()'s idle balance and again as
        // recognized reward NAV. Reject the wiring rather than silently
        // inflating share price.
        uint256 count = _policyTokens.length;
        for (uint256 i = 0; i < count; i++) {
            if (_isAssetOf(vault_, _policyTokens[i])) revert RewardTokenIsVaultAsset();
        }
        vault = vault_;
    }

    /// @dev True when `token` is the ERC-4626 underlying of `vault_`. A vault_
    ///      that is address(0), an EOA, or a contract without `asset()` yields
    ///      false - there is nothing to double-count in those cases.
    function _isAssetOf(address vault_, address token) internal view returns (bool) {
        if (vault_ == address(0)) return false;
        // try/catch does NOT catch Solidity's extcodesize guard on a call
        // that returns data, so an EOA vault would revert here rather than
        // fall through. An EOA has no asset() to double-count anyway.
        if (vault_.code.length == 0) return false;
        try IVaultAsset(vault_).asset() returns (address underlying) {
            return underlying != address(0) && underlying == token;
        } catch {
            return false;
        }
    }

    /// @notice Set or update a token policy
    function setTokenPolicy(address token, IRewardAccountant.TokenPolicy calldata policy) external onlyRole(REWARD_ADMIN_ROLE) {
        if (token == address(0)) revert InvalidToken();
        if (policy.feed == address(0)) revert InvalidFeed();
        if (policy.lowerBound > policy.upperBound) revert InvalidFeed();
        if (policy.haircutBps > 10_000) revert InvalidFeed();
        // See setVault: the reward holder is the vault, so a policy on the
        // vault's own asset would be counted in NAV twice.
        if (_isAssetOf(vault, token)) revert RewardTokenIsVaultAsset();

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
    /// @dev Paper 9.2: the recognized quantity for a token is its HELD balance
    ///      at the reward holder (the vault - see _rewardHolder) PLUS the
    ///      amount still CLAIMABLE from the supplied adapters that the token's
    ///      own policy allowlists. `adapters` is therefore load-bearing: an
    ///      empty array recognizes held balances only. The vault passes its
    ///      live active-adapter set.
    /// @dev Values are ROUNDED DOWN at every step for conservatism.
    /// @dev Callable by the vault (set via setVault) or REWARD_ADMIN_ROLE. The
    ///      vault must be able to call this or its own harvest path - which
    ///      calls refresh() after every claim - reverts.
    function refresh(address[] calldata adapters) external returns (uint256 totalValue) {
        if (msg.sender != vault && !hasRole(REWARD_ADMIN_ROLE, msg.sender)) revert Unauthorized();
        // Validate USDC feed if set
        if (usdcUsdFeed == address(0)) {
            emit SequencerValidationFailed("usdc_feed_not_set");
            return lastSafeValue;
        }

        (bool usdcValid, int256 usdcPrice) = _getValidatedPrice(usdcUsdFeed, usdcFeedMaxAge);
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
                // Valid feed - compute conservative value over held + claimable
                tokenValue = _computeTokenValue(
                    policy, _rewardQuantity(token, policy, adapters), rewardPrice, usdcPrice
                );

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

    /// @notice Compute the conservative USDC value of a recognized reward quantity
    /// @param policy   The token's policy (decimals, bounds, haircut, cap)
    /// @param quantity Recognized token quantity - held at the reward holder
    ///                 plus claimable from allowlisted adapters. Supplied by
    ///                 the caller because reading claimable is a state-changing
    ///                 adapter call and this function is a pure valuation.
    /// @dev Formula (all rounding down):
    ///      value = quantity × rewardPrice × 1e6 × haircutBps
    ///              ÷ (10^decimals × 10^decimals × 10_000)
    function _computeTokenValue(
        IRewardAccountant.TokenPolicy storage policy,
        uint256 quantity,
        int256 rewardPrice,
        int256 usdcPrice
    ) internal view returns (uint256) {
        if (rewardPrice <= 0 || usdcPrice <= 0) return 0;
        if (quantity == 0) return 0;

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

        // Compute: quantity × rewardPrice × haircutBps × 1e6
        //                        ÷ ((10^decimals)² × 10_000)
        // Result in USDC base units (6 decimals).
        //
        // quantity:    token amount with token decimals (1000 tokens = 1000e18)
        // rewardPrice: USD per token, ALSO expressed with token decimals
        //              ($50 = 50e18 for an 18-decimal token). This is the
        //              convention setTokenPolicy's `decimals` field carries;
        //              it is NOT the Chainlink feed's own decimals.
        //
        // quantity × rewardPrice therefore carries 2×decimals of scale, which
        // is why SCALE appears squared in the denominator.
        //
        // 18-decimal token, 1000 tokens at $50, 5% haircut (haircutBps = 500):
        //   1000e18 × 50e18 × 500 × 1e6 / (1e18 × 1e18 × 10_000) = 2_500e6 ✓
        // 6-decimal token, 1000 tokens at $1, 10% haircut:
        //   1000e6 × 1e6 × 1000 × 1e6 / (1e6 × 1e6 × 10_000) = 100e6 ✓
        //
        // The division is performed ONCE, at full precision, via Math.mulDiv
        // (512-bit intermediate, floor rounding). The previous implementation
        // divided by SCALE twice and by 10_000 before multiplying by 1e6,
        // which truncated the result to a WHOLE USDC: a $2.70 reward valued
        // to $2.00 and anything under $1.00 valued to exactly zero, making
        // every materialityThreshold below 1e6 unreachable.
        uint256 SCALE = 10 ** policy.decimals;

        // First leg: quantity × price / SCALE. Rounds down. Splitting the
        // division here keeps the second mulDiv's numerator inside 256 bits
        // for realistic balances while preserving 6-decimal granularity.
        uint256 grossScaled = Math.mulDiv(quantity, uint256(rewardPrice), SCALE);

        // Second leg: apply the haircut and convert to USDC base units.
        // Rounds down.
        uint256 value = Math.mulDiv(grossScaled, uint256(policy.haircutBps) * 1_000_000, SCALE * 10_000);

        // Apply per-token cap
        if (policy.contributionCap > 0 && value > policy.contributionCap) {
            value = policy.contributionCap;
        }

        return value;
    }

    /// @notice The address whose reward-token balance counts as "held".
    /// @dev Claimed reward tokens land in the VAULT, not here: HarvestLib is an
    ///      `internal` library, so `harvestAtomic` is inlined into
    ///      NavyVaultSRCLA and calls `adapter.claimReward(token, max,
    ///      address(this))` with `this` == the vault. Every adapter's
    ///      `_payPending` transfers to that caller-supplied recipient. Reading
    ///      `balanceOf(address(this))` here therefore read an address that
    ///      never receives a reward token, which is why the recognized reward
    ///      value R_t was identically zero. Falls back to this contract only
    ///      when no vault is wired, so an accountant used standalone (tests,
    ///      a deployment that defers setVault) still values its own balance.
    function _rewardHolder() internal view returns (address) {
        address v = vault;
        return v == address(0) ? address(this) : v;
    }

    /// @dev A token whose `balanceOf` reverts contributes nothing rather than
    ///      bricking the whole refresh.
    function _heldBalance(address token) internal view returns (uint256) {
        if (token.code.length == 0) return 0;
        try IERC20(token).balanceOf(_rewardHolder()) returns (uint256 balance) {
            return balance;
        } catch {
            return 0;
        }
    }

    /// @notice Recognized reward quantity for a token: held + claimable.
    /// @dev Paper 9.2. `adapters` is the caller-supplied candidate set; each
    ///      one is checked against the token policy's own allowlist before its
    ///      `claimableReward` is read, so a caller cannot introduce an
    ///      unadmitted source. A reverting adapter contributes nothing.
    function _rewardQuantity(
        address token,
        IRewardAccountant.TokenPolicy storage policy,
        address[] memory adapters
    ) internal returns (uint256 quantity) {
        quantity = _heldBalance(token);

        uint256 allowedCount = policy.allowedAdapters.length;
        if (allowedCount == 0) return quantity;

        for (uint256 i = 0; i < adapters.length; i++) {
            bool allowed = false;
            for (uint256 j = 0; j < allowedCount; j++) {
                if (policy.allowedAdapters[j] == adapters[i]) {
                    allowed = true;
                    break;
                }
            }
            if (!allowed || adapters[i].code.length == 0) continue;

            try IRewardSource(adapters[i]).claimableReward(token) returns (uint256 claimable) {
                quantity += claimable;
            } catch {
                // A source that cannot be read contributes nothing.
            }
        }
    }

    /// @dev Copy a policy's allowlist into memory. Used by the lazy
    ///      (share-action) refresh, which has no caller-supplied adapter set
    ///      and therefore uses the admin-configured allowlist - the maximal
    ///      set `refresh(adapters)` can ever filter down to. Bounded by the
    ///      allowlist length, which only REWARD_ADMIN_ROLE can grow.
    function _allowedAdapters(IRewardAccountant.TokenPolicy storage policy)
        internal
        view
        returns (address[] memory list)
    {
        uint256 count = policy.allowedAdapters.length;
        list = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            list[i] = policy.allowedAdapters[i];
        }
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
    /// @dev Paper 9.2: "share-changing ... transactions refresh material
    ///      reward values lazily when cache-age or material-change rules
    ///      require it." Refreshes only tokens whose cache is both material
    ///      and older than their policy's cacheLifetime; everything else is
    ///      carried forward unchanged. Reward value is NEVER added to
    ///      synchronous liquidity, and a stale or invalid source can never
    ///      raise the recognized total (it contributes nothing that round
    ///      rather than reusing a possibly-stale figure), matching refresh().
    /// @dev Callable by the vault (set via setVault) or REWARD_ADMIN_ROLE —
    ///      deliberately not widened to REWARD_ADMIN_ROLE itself, which also
    ///      controls policies and feeds.
    function syncForShareAction(bool) external returns (uint256 recognizedAssets) {
        if (msg.sender != vault && !hasRole(REWARD_ADMIN_ROLE, msg.sender)) revert Unauthorized();
        // issuingShares = true: acknowledge reward NAV for share price
        // issuingShares = false: redeem path (rewards already recognized)
        recognizedAssets = _lazyRefreshStaleMaterialTokens();
    }

    /// @dev One pass over policy tokens: non-stale entries carry their
    ///      existing cache.value forward untouched; a stale material entry
    ///      is refreshed exactly as refresh() would refresh it, and only if
    ///      both the USDC feed and the token's own feed validate. An
    ///      unrefreshable USDC feed or token feed leaves that token's cache
    ///      untouched and contributes nothing this round — the identical
    ///      "invalid source contributes zero" rule refresh() already applies.
    function _lazyRefreshStaleMaterialTokens() internal returns (uint256 totalValue) {
        if (usdcUsdFeed == address(0)) return lastSafeValue;

        (bool usdcValid, int256 usdcPrice) = _getValidatedPrice(usdcUsdFeed, usdcFeedMaxAge);
        if (!usdcValid) {
            emit SequencerValidationFailed("usdc_feed_invalid");
            return lastSafeValue;
        }

        uint256 tokenCount = _policyTokens.length;
        if (tokenCount == 0) return lastSafeValue;

        for (uint256 i = 0; i < tokenCount; i++) {
            address token = _policyTokens[i];
            IRewardAccountant.TokenPolicy storage policy = _tokenPolicies[token];
            IRewardAccountant.TokenCache storage cache = tokenCaches[token];

            bool stale = cache.isMaterial
                && (cache.lastUpdated == 0 || block.timestamp - cache.lastUpdated > policy.cacheLifetime);

            if (!stale) {
                totalValue += cache.value;
                continue;
            }

            (bool feedValid, int256 rewardPrice) = _getValidatedPrice(policy.feed, policy.maxAge);
            if (!feedValid) {
                // Cannot safely refresh: leave the cache exactly as it is and
                // contribute nothing this round rather than reusing a
                // possibly-stale figure. A stale or invalid source must
                // never raise NAV.
                emit SequencerValidationFailed("feed_invalid_for_material_token");
                continue;
            }

            uint256 tokenValue = _computeTokenValue(
                policy, _rewardQuantity(token, policy, _allowedAdapters(policy)), rewardPrice, usdcPrice
            );
            bool isMaterial = tokenValue >= policy.materialityThreshold;
            cache.value = tokenValue;
            cache.lastUpdated = block.timestamp;
            cache.isMaterial = isMaterial;
            emit CacheRefreshed(token, tokenValue, block.timestamp, isMaterial);

            totalValue += tokenValue;
        }

        lastSafeValue = totalValue;
        return totalValue;
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

/// @title IVaultAsset - Minimal ERC-4626 underlying-asset probe
interface IVaultAsset {
    function asset() external view returns (address);
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
