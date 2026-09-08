// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RewardAccountant} from "../../src/reward/RewardAccountant.sol";
import {IRewardAccountant} from "../../src/interfaces/IRewardAccountant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Mock Chainlink Aggregator for testing
contract MockAggregator {
    int256 public answer;
    uint256 public updatedAt = block.timestamp;
    uint80 public roundId = 1;
    uint80 public answeredInRound = 1;
    bool public shouldRevert;

    function setAnswer(int256 answer_) external {
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function setAnswerWithTimestamp(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function setStale() external {
        updatedAt = block.timestamp - 2 hours;
    }

    function setIncompleteRound() external {
        answeredInRound = 0;
    }

    function setRevert() external {
        shouldRevert = true;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId_, int256 answer_, uint256 startedAt_, uint256 updatedAt_, uint80 answeredInRound_)
    {
        if (shouldRevert) revert();
        return (roundId, answer, block.timestamp, updatedAt, answeredInRound);
    }
}

/// @title Mock Price Feed for testing
contract MockPriceFeed {
    int256 public price = 1e6;
    uint256 public updatedAt = block.timestamp;
    uint80 public roundId = 1;
    uint80 public answeredInRound = 1;
    bool public shouldRevert;

    function setPrice(int256 price_) external {
        price = price_;
        updatedAt = block.timestamp;
        roundId++;
        answeredInRound = roundId;
    }

    function setPriceWithTimestamp(int256 price_, uint256 updatedAt_) external {
        price = price_;
        updatedAt = updatedAt_;
        roundId++;
        answeredInRound = roundId;
    }

    function setStale() external {
        updatedAt = block.timestamp - 2 hours;
    }

    function setRevert() external {
        shouldRevert = true;
    }

    function latestAnswer() external view returns (int256) {
        if (shouldRevert) revert();
        return price;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId_, int256 answer_, uint256 startedAt_, uint256 updatedAt_, uint80 answeredInRound_)
    {
        if (shouldRevert) revert();
        return (roundId, price, block.timestamp, updatedAt, answeredInRound);
    }
}

/// @title Mock ERC20 for testing
contract MockRewardToken {
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply_;

    constructor(uint8 _decimals) {
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply_ += amount;
    }

    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        totalSupply_ -= amount;
    }
}

/// @title RewardAccountantTest - Tests for RewardAccountant contract
contract RewardAccountantTest is Test {
    RewardAccountant public accountant;
    MockPriceFeed public usdcFeed;
    MockPriceFeed public rewardFeed;
    MockRewardToken public rewardToken;
    MockAggregator public aggregator;

    address public admin;
    address public user;
    address public vault;

    // USDC has 6 decimals, typical Chainlink ETH/USD has 8 decimals
    uint256 public constant USDC_DECIMALS = 6;
    uint256 public constant REWARD_DECIMALS_18 = 18;
    uint256 public constant REWARD_DECIMALS_8 = 8;

    // USDC/USD feed (1:1, scaled for Chainlink)
    int256 public constant USDC_USD_PRICE = 1_000_000; // $1 with 6 decimals = 1e6

    // Reward/USD price (e.g., COMP at $50)
    int256 public constant REWARD_USD_PRICE_18 = 50 * 1e18; // $50 with 18 decimals
    int256 public constant REWARD_USD_PRICE_8 = 50 * 1e8; // $50 with 8 decimals

    function setUp() public {
        admin = address(uint160(0xA11CE));
        user = address(uint160(0xB0B));
        vault = address(uint160(0x11A17));

        accountant = new RewardAccountant(admin, vault);
        vm.prank(admin);
        accountant.setVault(vault);

        usdcFeed = new MockPriceFeed();
        usdcFeed.setPrice(USDC_USD_PRICE);

        rewardFeed = new MockPriceFeed();
        rewardFeed.setPrice(REWARD_USD_PRICE_18);

        rewardToken = new MockRewardToken(18);

        // Fund the REWARD HOLDER with reward tokens. That is the vault, not
        // the accountant: HarvestLib is an internal library, so the vault's
        // harvest path calls adapter.claimReward(token, max, address(this))
        // with `this` == the vault, and every adapter pays that recipient.
        // Crediting the accountant here would make these tests pass against a
        // balance production never creates - the exact defect that kept the
        // recognized reward value R_t identically zero.
        rewardToken.mint(vault, 1000e18);
    }

    // ============================================
    // Oracle Math Tests - Different Decimals
    // ============================================

    /// @dev Test reward with 18 decimals (typical ERC20)
    function test_oracleMath_18Decimals() public {
        // Set up policy for 18-decimal token
        address[] memory allowedAdapters = new address[](0);

        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(rewardFeed),
            description: "COMP",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500, // 5%
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(rewardToken), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        // Refresh to compute value
        address[] memory adapters = new address[](0);
        vm.prank(admin);
        uint256 value = accountant.refresh(adapters);

        // Manual calculation:
        // balance = 1000e18
        // rewardPrice = 50 * 1e18
        // usdcPrice = 1 * 1e6
        // haircut = 500 / 10000 = 0.05
        // value = 1000e18 * 50e18 * 1e6 * 500 / 1e18 / 1e6 / 10000
        //       = 1000 * 50 * 500 / 10000 = 2500 USDC units (1e6)
        assertGt(value, 0, "Should compute non-zero value");
        // With 5% haircut: 1000 * 50 * 0.05 = 2500 USDC
        assertApproxEqAbs(value, 2500e6, 1e6, "Value should be ~2500 USDC");
    }

    /// @dev Test reward with 8 decimals (typical Chainlink price)
    function test_oracleMath_8Decimals() public {
        // Create 8-decimal token
        MockRewardToken token8 = new MockRewardToken(8);
        token8.mint(vault, 1000e8); // 1000 tokens with 8 decimals

        MockPriceFeed feed8 = new MockPriceFeed();
        feed8.setPrice(REWARD_USD_PRICE_8); // $50 with 8 decimals

        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(token8),
            feed: address(feed8),
            description: "LINK",
            decimals: 8,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(token8), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        address[] memory adapters = new address[](0);
        vm.prank(admin);
        uint256 value = accountant.refresh(adapters);

        // With 5% haircut: 1000 * 50 * 0.05 = 2500 USDC
        assertApproxEqAbs(value, 2500e6, 1e6, "Value should be ~2500 USDC");
    }

    /// @dev Test reward with 6 decimals (USDC-like)
    function test_oracleMath_6Decimals() public {
        // Create 6-decimal token (like staked USDC)
        MockRewardToken token6 = new MockRewardToken(6);
        token6.mint(vault, 1000e6); // 1000 tokens with 6 decimals

        MockPriceFeed feed6 = new MockPriceFeed();
        feed6.setPrice(1_000_000); // $1 with 6 decimals

        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(token6),
            feed: address(feed6),
            description: "Reward",
            decimals: 6,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 1000, // 10%
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(token6), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        address[] memory adapters = new address[](0);
        vm.prank(admin);
        uint256 value = accountant.refresh(adapters);

        // 1000 tokens * $1 * 10% haircut = 100 USDC
        assertApproxEqAbs(value, 100e6, 1e4, "Value should be ~100 USDC");
    }

    // ============================================
    // Haircut Rounding Down Tests
    // ============================================

    /// @dev Test that haircut rounds DOWN (conservative)
    function test_haircut_roundsDown() public {
        // Create token with precise calculation that would round differently
        MockRewardToken token = new MockRewardToken(18);
        // 1.5e18 tokens
        token.mint(vault, 1_500_000_000_000_000_000);

        MockPriceFeed feed = new MockPriceFeed();
        // 33_333_333_333_333_333 with 18 decimals is $0.033333333333333333
        // per token (NOT $33.33 - the original comment here was wrong by
        // three orders of magnitude).
        feed.setPrice(33_333_333_333_333_333);

        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(token),
            feed: address(feed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 1000, // 10%
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(token), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        address[] memory adapters = new address[](0);
        vm.prank(admin);
        uint256 value = accountant.refresh(adapters);

        // Exact expected value, derived by hand:
        //   grossScaled = floor(1.5e18 * 33_333_333_333_333_333 / 1e18)
        //               = 49_999_999_999_999_999          (the .5 is dropped)
        //   value       = floor(49_999_999_999_999_999 * 1000 * 1e6
        //                       / (1e18 * 10_000))
        //               = 4_999                            USDC base units
        // i.e. $0.004999 - the exact 10% haircut of 1.5 x $0.0333..., floored.
        //
        // The previous assertion here was `assertLe(value, 5e6 + 1)`, which is
        // satisfied by ZERO. It was in fact satisfied by zero: the old
        // whole-USDC formula (divide by SCALE twice, then by 10_000, only THEN
        // multiply by 1e6) truncated this reward to exactly 0. Assert the
        // value, and assert it is non-zero, so neither a regression to the
        // whole-USDC quantum nor a regression to a zero balance can pass.
        assertEq(value, 4_999, "haircut must round down at 6-decimal granularity");
        assertGt(value, 0, "a sub-dollar reward must not value to zero");
    }

    // ============================================
    // Absolute Cap Tests
    // ============================================

    /// @dev Test per-token contribution cap
    function test_contributionCap() public {
        // Create large holding
        MockRewardToken token = new MockRewardToken(18);
        token.mint(vault, 10000e18); // 10000 tokens at $50 = $500k

        MockPriceFeed feed = new MockPriceFeed();
        feed.setPrice(REWARD_USD_PRICE_18); // $50

        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(token),
            feed: address(feed),
            description: "Expensive",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500, // 5%
            contributionCap: 1000e6, // Cap at 1000 USDC
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(token), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        address[] memory adapters = new address[](0);
        vm.prank(admin);
        uint256 value = accountant.refresh(adapters);

        // Without cap: 10000 * 50 * 0.05 = 25000 USDC
        // With cap: 1000 USDC
        assertEq(value, 1000e6, "Value should be capped at 1000 USDC");
    }

    // ============================================
    // Stale Feed Tests
    // ============================================

    /// @dev Test rejection of stale feed
    function test_staleFeed_rejected() public {
        MockPriceFeed feed = new MockPriceFeed();
        // Set a valid feed
        feed.setPrice(50e18);

        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(feed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(rewardToken), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        // Set feed to revert
        feed.setRevert();

        // Refresh should not revert but preserve lastSafeValue
        address[] memory adapters = new address[](0);
        vm.prank(admin);
        uint256 value = accountant.refresh(adapters);

        // Value should be 0 since feed is broken
        assertEq(value, 0, "Stale feed should result in zero value");
    }

    // ============================================
    // Bounds Tests
    // ============================================

    /// @dev Test price out of bounds rejection
    function test_priceOutOfBounds_rejected() public {
        MockPriceFeed feed = new MockPriceFeed();
        feed.setPrice(100e18); // Way too high price

        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(feed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: 75e18, // Cap at $75
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(rewardToken), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        address[] memory adapters = new address[](0);
        vm.prank(admin);
        uint256 value = accountant.refresh(adapters);

        // Value should be 0 because price was out of bounds
        assertEq(value, 0, "Out of bounds price should result in zero value");
    }

    // ============================================
    // Cache Expiry Tests
    // ============================================

    /// @dev Test cache expiry and issuanceReady
    function test_cacheExpiry_materiality() public {
        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(rewardFeed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 1e6, // 1 USDC threshold
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(rewardToken), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        // Initial refresh
        address[] memory adapters = new address[](0);
        vm.prank(admin);
        accountant.refresh(adapters);

        // Cache should be ready
        assertTrue(accountant.issuanceReady(), "Fresh cache should be issuance ready");

        // Warp forward past cache lifetime
        vm.warp(block.timestamp + 2 hours);

        // Cache should no longer be ready
        assertFalse(accountant.issuanceReady(), "Expired cache should not be issuance ready");
    }

    /// @dev Test immaterial expired cache still allows issuance
    function test_immaterialExpiredCache_allowsIssuance() public {
        // Create tiny holding that won't be material
        MockRewardToken tinyToken = new MockRewardToken(18);
        tinyToken.mint(vault, 1e18); // Just 1 token

        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(tinyToken),
            feed: address(rewardFeed),
            description: "Tiny",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 1000e6, // 1000 USDC threshold - tiny won't hit this
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(tinyToken), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        // Initial refresh
        address[] memory adapters = new address[](0);
        vm.prank(admin);
        accountant.refresh(adapters);

        // Get cache status
        (, , bool isMaterial) = accountant.tokenCache(address(tinyToken));
        assertFalse(isMaterial, "Tiny holding should not be material");

        // Warp forward past cache lifetime
        vm.warp(block.timestamp + 2 hours);

        // Even with expired cache, immaterial tokens don't block issuance
        assertTrue(accountant.issuanceReady(), "Immaterial expired cache should still allow issuance");
    }

    // ============================================
    // Sequencer / Recovery Tests
    // ============================================

    /// @dev Test sequencer grace period (placeholder)
    function test_sequencerGracePeriod() public view {
        assertEq(accountant.sequencerGracePeriod(), 24 hours);
    }

    // ============================================
    // Configuration Digest Tests
    // ============================================

    /// @dev Test configuration digest changes with policy
    function test_configurationDigest_changesWithPolicy() public {
        // Initial digest with no policies
        bytes32 digest1 = accountant.configurationDigest();

        // Add a policy
        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(rewardFeed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(rewardToken), policy);

        // Digest should change
        bytes32 digest2 = accountant.configurationDigest();
        assertNotEq(digest1, digest2, "Digest should change after adding policy");
    }

    // ============================================
    // Sync For Share Action Tests
    // ============================================

    /// @dev Test syncForShareAction returns cached value
    function test_syncForShareAction() public {
        // Set up and refresh
        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(rewardFeed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(rewardToken), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        address[] memory adapters = new address[](0);
        vm.prank(admin);
        accountant.refresh(adapters);

        // Sync should return the cached value
        vm.prank(vault);
        uint256 syncValue = accountant.syncForShareAction(true);
        assertGt(syncValue, 0, "Sync should return cached value");
        assertEq(syncValue, accountant.cachedRewardAssets(), "Sync should return same as cached");
    }

    /// @dev Seeds a single material token policy, refreshes it, and asserts
    ///      the seed is genuinely material and issuance-ready so the tests
    ///      that build on it are meaningful. maxAge is set far longer than
    ///      cacheLifetime so the *cache* (not the underlying feed) is what
    ///      goes stale after a warp — the scenario paper 9.2 targets.
    function _seedMaterialToken() internal {
        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(rewardFeed),
            description: "Test",
            decimals: 18,
            maxAge: 30 days,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 1e6, // 1 USDC — comfortably below the seeded value
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(rewardToken), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        address[] memory adapters = new address[](0);
        vm.prank(admin);
        accountant.refresh(adapters);

        (uint256 seededValue,, bool isMaterial) = accountant.tokenCache(address(rewardToken));
        // A zero seed would make every "must not raise NAV" assertion below
        // trivially true, so pin that the seed is a real, non-zero valuation.
        assertGt(seededValue, 0, "seed precondition: seeded value must be non-zero");
        assertGt(accountant.cachedRewardAssets(), 0, "seed precondition: NAV must be non-zero");
        assertTrue(isMaterial, "seed precondition: token must be material");
        assertTrue(accountant.issuanceReady(), "seed precondition: cache must start fresh");
    }

    /// @dev Paper 9.2's lazy refresh. syncForShareAction was `view` and did
    ///      nothing, so a stale cache closed deposits permanently with no
    ///      on-chain remedy: refresh() is role-gated and nothing calls it.
    function test_syncForShareActionRefreshesAStaleCache() public {
        _seedMaterialToken();
        // 2 hours: past the 1-hour cacheLifetime, but inside both the token
        // feed's 30-day maxAge and the USDC leg's default 24h bound. NOTHING
        // is touched across the warp - the feeds simply have not published,
        // which is the ordinary state of a 24h-heartbeat stablecoin feed.
        // Fabricating a same-block USDC heartbeat here would hide whether the
        // USDC leg's own bound permits the refresh at all.
        vm.warp(block.timestamp + 2 hours);
        assertFalse(accountant.issuanceReady(), "precondition: stale");

        vm.prank(vault);
        accountant.syncForShareAction(true);

        assertTrue(accountant.issuanceReady(), "sync must clear staleness");
        assertGt(accountant.cachedRewardAssets(), 0, "the refresh must produce a real valuation");
    }

    /// @dev Paper 9.2: "A stale or invalid source cannot increase NAV."
    /// @dev assertLe(after, before) would be satisfied by after == before,
    ///      which is exactly what a no-op sync produces - so this pins the
    ///      specific post-state instead: the token's contribution is dropped
    ///      (NAV strictly falls, to zero here, its only material entry), the
    ///      cache is left untouched so its staleness survives, and issuance
    ///      stays blocked.
    function test_syncForShareActionDoesNotRaiseValueFromAnInvalidFeed() public {
        _seedMaterialToken();
        (, uint256 lastUpdatedBefore,) = accountant.tokenCache(address(rewardToken));
        uint256 before = accountant.cachedRewardAssets();
        assertGt(before, 0, "precondition: NAV must start non-zero or the assertions below are trivial");

        rewardFeed.setPrice(-1); // invalid: latestAnswer <= 0 fails validation
        // 2 hours keeps the USDC leg inside its bound, so the ONLY invalid
        // input is the reward feed. No feed is touched to fabricate freshness.
        vm.warp(block.timestamp + 2 hours);

        vm.prank(vault);
        accountant.syncForShareAction(true);

        assertLt(accountant.cachedRewardAssets(), before, "an invalid source must never raise NAV");
        assertEq(accountant.cachedRewardAssets(), 0, "the only material entry must be dropped, not carried");
        assertFalse(accountant.issuanceReady(), "an unrefreshable material entry must keep issuance blocked");
        (, uint256 lastUpdatedAfter,) = accountant.tokenCache(address(rewardToken));
        assertEq(lastUpdatedAfter, lastUpdatedBefore, "an invalid refresh must not stamp the cache fresh");
    }

    /// @dev The USDC leg's max age is the gate every other refresh sits
    ///      behind: it is checked before any per-token work, so a bound
    ///      shorter than the feed's real publication cadence silently turns
    ///      the whole paper 9.2 lazy refresh into a no-op. Tightening it to
    ///      1 hour reproduces exactly that.
    function test_syncForShareActionIsBlockedByAnOverTightUsdcFeedMaxAge() public {
        _seedMaterialToken();
        vm.prank(admin);
        accountant.setUsdcFeedMaxAge(1 hours);

        vm.warp(block.timestamp + 2 hours); // USDC feed now 2h old: outside 1h, inside the 24h default

        vm.prank(vault);
        accountant.syncForShareAction(true);
        assertFalse(accountant.issuanceReady(), "a USDC feed outside the configured bound must block the refresh");

        // The same scenario, with the bound restored to the default sized to
        // the Base USDC/USD feed's real 24h heartbeat, does refresh.
        // (Read the constant before the prank - an external call would
        // consume it.)
        uint256 defaultAge = accountant.DEFAULT_USDC_FEED_MAX_AGE();
        vm.prank(admin);
        accountant.setUsdcFeedMaxAge(defaultAge);
        vm.prank(vault);
        accountant.syncForShareAction(true);
        assertTrue(accountant.issuanceReady(), "within the configured bound the refresh must proceed");
    }

    /// @dev The default must be at least the Base USDC/USD feed's published
    ///      86400s heartbeat, or the leg is invalid for most of every day.
    function test_defaultUsdcFeedMaxAgeCoversTheBaseHeartbeat() public view {
        assertGe(accountant.usdcFeedMaxAge(), 86_400, "default must cover the 24h Chainlink heartbeat");
        assertEq(accountant.usdcFeedMaxAge(), accountant.DEFAULT_USDC_FEED_MAX_AGE());
    }

    /// @dev Zero would freeze every refresh; an unbounded value would
    ///      reinstate the staleness defect. Both must be rejected.
    function test_setUsdcFeedMaxAge_rejectsZeroAndUnboundedValues() public {
        vm.prank(admin);
        vm.expectRevert(RewardAccountant.InvalidUsdcFeedMaxAge.selector);
        accountant.setUsdcFeedMaxAge(0);

        vm.prank(admin);
        vm.expectRevert(RewardAccountant.InvalidUsdcFeedMaxAge.selector);
        accountant.setUsdcFeedMaxAge(type(uint256).max);

        uint256 ceiling = accountant.MAX_USDC_FEED_MAX_AGE();
        vm.prank(admin);
        vm.expectRevert(RewardAccountant.InvalidUsdcFeedMaxAge.selector);
        accountant.setUsdcFeedMaxAge(ceiling + 1);

        // The ceiling itself is accepted, so the bound is inclusive.
        vm.prank(admin);
        accountant.setUsdcFeedMaxAge(ceiling);
        assertEq(accountant.usdcFeedMaxAge(), ceiling);
    }

    /// @dev setUsdcFeedMaxAge is REWARD_ADMIN_ROLE-gated.
    function test_setUsdcFeedMaxAge_requiresAdmin() public {
        vm.prank(user);
        vm.expectRevert();
        accountant.setUsdcFeedMaxAge(2 hours);
        assertEq(accountant.usdcFeedMaxAge(), accountant.DEFAULT_USDC_FEED_MAX_AGE(), "must be unchanged");
    }

    /// @dev The constructor's vault argument exists so a deployment whose
    ///      broadcaster is not `admin` cannot ship an accountant that
    ///      authorises nobody - which bricks every deposit and mint.
    function test_constructorAuthorisesTheVault() public {
        RewardAccountant wired = new RewardAccountant(admin, vault);
        assertEq(wired.vault(), vault, "constructor must authorise the vault");
        // And the authorisation is real, not just a stored address.
        vm.prank(vault);
        wired.syncForShareAction(true);

        RewardAccountant unwired = new RewardAccountant(admin, address(0));
        assertEq(unwired.vault(), address(0));
        vm.prank(vault);
        vm.expectRevert(RewardAccountant.Unauthorized.selector);
        unwired.syncForShareAction(true);
    }

    /// @dev syncForShareAction must reject a caller that is neither the
    ///      authorised vault nor REWARD_ADMIN_ROLE — the paper 9.4-style
    ///      lesson applied here: an unauthorised caller should not be able to
    ///      force cache mutations.
    function test_syncForShareAction_rejectsUnauthorizedCaller() public {
        vm.prank(user);
        vm.expectRevert(RewardAccountant.Unauthorized.selector);
        accountant.syncForShareAction(true);
    }

    /// @dev setVault is REWARD_ADMIN_ROLE-gated, not open to an arbitrary caller.
    function test_setVault_requiresAdmin() public {
        vm.prank(user);
        vm.expectRevert();
        accountant.setVault(user);
    }

    // ============================================
    // Admin Tests
    // ============================================

    /// @dev Test setTokenPolicy requires admin
    function test_setTokenPolicy_requiresAdmin() public {
        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(rewardFeed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.expectRevert();
        accountant.setTokenPolicy(address(rewardToken), policy);
    }

    /// @dev Test removeTokenPolicy requires admin
    function test_removeTokenPolicy_requiresAdmin() public {
        vm.expectRevert();
        accountant.removeTokenPolicy(address(rewardToken));
    }

    /// @dev Test removeTokenPolicy clears cache
    function test_removeTokenPolicy_clearsCache() public {
        // First set a policy
        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(rewardFeed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(rewardToken), policy);
        vm.prank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));

        // Refresh to populate cache
        address[] memory adapters = new address[](0);
        vm.prank(admin);
        accountant.refresh(adapters);

        // Remove policy
        vm.prank(admin);
        accountant.removeTokenPolicy(address(rewardToken));

        // Cache should be cleared
        (uint256 value, uint256 lastUpdated, bool isMaterial) = accountant.tokenCache(address(rewardToken));
        assertEq(value, 0, "Cache value should be zero after removal");
        assertEq(lastUpdated, 0, "Cache lastUpdated should be zero after removal");
        assertFalse(isMaterial, "Cache isMaterial should be false after removal");
    }

    // ============================================
    // Error Cases
    // ============================================

    /// @dev Test invalid token address reverts
    function test_invalidToken_reverts() public {
        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(0),
            feed: address(rewardFeed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        vm.expectRevert(RewardAccountant.InvalidToken.selector);
        accountant.setTokenPolicy(address(0), policy);
    }

    /// @dev Test invalid feed reverts
    function test_invalidFeed_reverts() public {
        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(0),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        vm.expectRevert(RewardAccountant.InvalidFeed.selector);
        accountant.setTokenPolicy(address(rewardToken), policy);
    }

    /// @dev Test invalid bounds reverts
    function test_invalidBounds_reverts() public {
        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(rewardFeed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 100e18,
            upperBound: 50e18, // lower > upper
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        vm.expectRevert(RewardAccountant.InvalidFeed.selector);
        accountant.setTokenPolicy(address(rewardToken), policy);
    }

    /// @dev Test haircut > 10000 reverts
    function test_invalidHaircut_reverts() public {
        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(rewardFeed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 10001, // > 10000
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        vm.expectRevert(RewardAccountant.InvalidFeed.selector);
        accountant.setTokenPolicy(address(rewardToken), policy);
    }

    // ============================================
    // Empty State Tests
    // ============================================

    /// @dev Test empty policies returns zero
    function test_emptyPolicies_returnsZero() public view {
        // No policies set
        assertEq(accountant.cachedRewardAssets(), 0);
        assertTrue(accountant.issuanceReady());
    }

    /// @dev Test refresh with no USDC feed
    function test_refresh_noUsdcFeed() public {
        address[] memory allowedAdapters = new address[](0);
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(rewardFeed),
            description: "Test",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 500,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });

        vm.prank(admin);
        accountant.setTokenPolicy(address(rewardToken), policy);
        // Note: NOT setting usdcUsdFeed

        address[] memory adapters = new address[](0);
        vm.prank(admin);
        uint256 value = accountant.refresh(adapters);

        // Should return lastSafeValue (0)
        assertEq(value, 0);
    }
}
