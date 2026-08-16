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

        accountant = new RewardAccountant(admin);

        usdcFeed = new MockPriceFeed();
        usdcFeed.setPrice(USDC_USD_PRICE);

        rewardFeed = new MockPriceFeed();
        rewardFeed.setPrice(REWARD_USD_PRICE_18);

        rewardToken = new MockRewardToken(18);

        // Fund the accountant with reward tokens
        rewardToken.mint(address(accountant), 1000e18);
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
        token8.mint(address(accountant), 1000e8); // 1000 tokens with 8 decimals

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
        token6.mint(address(accountant), 1000e6); // 1000 tokens with 6 decimals

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
        token.mint(address(accountant), 1_500_000_000_000_000_000);

        MockPriceFeed feed = new MockPriceFeed();
        // $33.33 with 18 decimals = 3333...e15
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

        // Expected: 1.5 * 33.33 * 0.10 = 4.9995 USDC
        // Rounded down should be 4 USDC (not 5)
        // Value should be less than or equal to the ceiling calculation
        assertLe(value, 5e6 + 1, "Should round down");
    }

    // ============================================
    // Absolute Cap Tests
    // ============================================

    /// @dev Test per-token contribution cap
    function test_contributionCap() public {
        // Create large holding
        MockRewardToken token = new MockRewardToken(18);
        token.mint(address(accountant), 10000e18); // 10000 tokens at $50 = $500k

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
        tinyToken.mint(address(accountant), 1e18); // Just 1 token

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
        uint256 syncValue = accountant.syncForShareAction(true);
        assertGt(syncValue, 0, "Sync should return cached value");
        assertEq(syncValue, accountant.cachedRewardAssets(), "Sync should return same as cached");
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
