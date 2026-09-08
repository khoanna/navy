// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {RewardAccountant} from "../../src/reward/RewardAccountant.sol";
import {IRewardAccountant} from "../../src/interfaces/IRewardAccountant.sol";

/// @dev Minimal 6-decimal USDC.
contract RVUsdc {
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= amount, "allowance");
            allowance[from][msg.sender] -= amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// @dev Minimal 18-decimal reward token (COMP/WELL shaped).
contract RVReward {
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Chainlink-shaped feed.
contract RVFeed {
    int256 public price;
    uint256 public updatedAt;
    uint80 public roundId = 1;

    constructor(int256 p) {
        price = p;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 p) external {
        price = p;
        updatedAt = block.timestamp;
        roundId++;
    }

    function latestAnswer() external view returns (int256) {
        return price;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, price, block.timestamp, updatedAt, roundId);
    }
}

/// @notice Adapter whose `claimReward` behaves exactly as the production
///         adapters do: it pays the CALLER-SUPPLIED recipient and decrements
///         its own claimable balance. Nothing here ever credits the accountant.
/// @dev This faithfulness is the whole point of this suite. A mock that
///      credited the RewardAccountant directly would make every assertion below
///      pass while the production path still recognized nothing.
contract RVAdapter {
    address public immutable vaultAddress;
    address public immutable assetAddress;

    uint256 public reported;
    uint256 public withdrawable;

    address[] private _rewardTokens;
    mapping(address => uint256) public claimableAmounts;

    constructor(address vault_, address asset_, address rewardToken_) {
        vaultAddress = vault_;
        assetAddress = asset_;
        _rewardTokens.push(rewardToken_);
    }

    function vault() external view returns (address) {
        return vaultAddress;
    }

    function asset() external view returns (address) {
        return assetAddress;
    }

    function totalAssets() external view returns (uint256) {
        return reported;
    }

    function sync() external view returns (uint256) {
        return reported;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawable;
    }

    function maxDeployable() external pure returns (uint256) {
        return type(uint256).max;
    }

    function configurationDigest() external view returns (bytes32) {
        return keccak256(abi.encode(vaultAddress, assetAddress));
    }

    function deposit(uint256 assets) external returns (uint256) {
        reported += assets;
        withdrawable += assets;
        return assets;
    }

    function withdraw(uint256 assets) external returns (uint256) {
        uint256 sent = assets > withdrawable ? withdrawable : assets;
        withdrawable -= sent;
        reported = reported > sent ? reported - sent : 0;
        RVUsdc(assetAddress).transfer(vaultAddress, sent);
        return sent;
    }

    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    /// @dev Sets what the venue still owes. Does NOT pre-mint anything: the
    ///      tokens only exist once `claimReward` is called, like a real venue.
    function setClaimable(address token, uint256 amount) external {
        claimableAmounts[token] = amount;
    }

    function claimableReward(address token) external view returns (uint256) {
        return claimableAmounts[token];
    }

    function claimReward(address token, uint256 maxAmount, address recipient) external returns (uint256 claimed) {
        require(msg.sender == vaultAddress, "only vault");
        claimed = claimableAmounts[token];
        if (claimed > maxAmount) claimed = maxAmount;
        if (claimed > 0) {
            claimableAmounts[token] -= claimed;
            // Production behaviour: pay the recipient the vault passed in.
            RVReward(token).mint(recipient, claimed);
        }
    }
}

/// @dev Reward executor stub. `harvest` requires one to be set even when the
///      route id is zero (no swap), which is the configuration used here so the
///      claimed reward token stays where the claim put it.
contract RVExecutor {
    function swap(bytes32, uint256, uint256, uint256) external pure returns (uint256) {
        revert("no swap configured");
    }
}

/// @title RewardValueReachableTest
/// @notice Proves the recognized reward value R_t can be non-zero, using only
///         the production path: allocator calls `vault.harvest(...)`, HarvestLib
///         (an internal library, so inlined into the vault) calls
///         `adapter.claimReward(token, max, address(this))`, the adapter pays
///         the VAULT, and the vault refreshes the accountant.
contract RewardValueReachableTest is Test {
    NavyVaultSRCLA internal vault;
    RewardAccountant internal accountant;
    RVUsdc internal usdc;
    RVReward internal reward;
    RVAdapter internal adapter;
    RVExecutor internal executor;
    RVFeed internal usdcFeed;
    RVFeed internal rewardFeed;

    address internal admin = address(0xA11CE);
    address internal allocator = address(0xA110C);
    address internal user = address(0xB0B);

    // 18-decimal token priced at $50, expressed with the token's decimals -
    // the convention TokenPolicy.decimals carries.
    int256 internal constant REWARD_PRICE = 50e18;
    int256 internal constant USDC_PRICE = 1e6;

    function setUp() public {
        vm.warp(1_000_000);

        usdc = new RVUsdc();
        reward = new RVReward();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        adapter = new RVAdapter(address(vault), address(usdc), address(reward));
        executor = new RVExecutor();
        accountant = new RewardAccountant(admin, address(vault));

        usdcFeed = new RVFeed(USDC_PRICE);
        rewardFeed = new RVFeed(REWARD_PRICE);

        vm.startPrank(admin);
        accountant.setUsdcUsdFeed(address(usdcFeed));
        vm.stopPrank();

        vault.registerAdapter(address(adapter), 10_000, 100, "mock");
        vault.setRewardExecutor(address(executor));
        vault.setRewardAccountant(address(accountant));
    }

    /// @dev haircutBps 9500 => a 5% haircut is NOT what this means: the
    ///      contract multiplies by haircutBps/10_000, so 9_500 keeps 95%.
    function _setPolicy(uint256 materiality, address[] memory allowedAdapters) internal {
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(reward),
            feed: address(rewardFeed),
            description: "MOCK",
            decimals: 18,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 9_500,
            contributionCap: type(uint256).max,
            materialityThreshold: materiality,
            cacheLifetime: 1 hours,
            allowedAdapters: allowedAdapters,
            exists: true
        });
        vm.prank(admin);
        accountant.setTokenPolicy(address(reward), policy);
    }

    function _one(address a) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }

    // ------------------------------------------------------------------
    // The headline property: R_t can be non-zero, via the production path.
    // ------------------------------------------------------------------

    /// @notice A real harvest puts reward tokens in the VAULT and the
    ///         accountant recognizes them. Before the fix this asserted 0:
    ///         `_computeTokenValue` read `balanceOf(address(this))` on the
    ///         accountant, which no code path ever credits.
    function test_harvestThroughTheProductionPathMakesRecognizedRewardValueNonZero() public {
        _setPolicy(0, new address[](0));

        adapter.setClaimable(address(reward), 10e18);

        assertEq(reward.balanceOf(address(vault)), 0, "precondition: vault holds no reward token");
        assertEq(accountant.cachedRewardAssets(), 0, "precondition: R_t starts at zero");

        vm.prank(allocator);
        // routeId == 0 => HarvestLib skips the swap, so the claimed token
        // stays exactly where claimReward put it.
        vault.harvest(address(adapter), address(reward), 10e18, bytes32(0), 0, block.timestamp + 1);

        // 1. The tokens are in the VAULT, and the accountant holds none.
        assertEq(reward.balanceOf(address(vault)), 10e18, "claimed tokens must land in the vault");
        assertEq(reward.balanceOf(address(accountant)), 0, "the accountant never receives reward tokens");

        // 2. R_t is non-zero and exactly the hand-computed conservative value:
        //    10 tokens x $50 x 95% = $475.00 => 475_000_000 USDC base units.
        assertEq(accountant.cachedRewardAssets(), 475_000_000, "R_t must equal the haircut value of the held balance");
        assertGt(accountant.cachedRewardAssets(), 0, "R_t must be non-zero");
    }

    /// @notice The same value reaches vault NAV, and only through the reward
    ///         leg (idle USDC is unchanged by a no-swap harvest).
    function test_recognizedRewardValueFlowsIntoTotalAssets() public {
        _setPolicy(0, new address[](0));
        adapter.setClaimable(address(reward), 10e18);

        uint256 navBefore = vault.totalAssets();
        uint256 idleBefore = usdc.balanceOf(address(vault));

        vm.prank(allocator);
        vault.harvest(address(adapter), address(reward), 10e18, bytes32(0), 0, block.timestamp + 1);

        assertEq(usdc.balanceOf(address(vault)), idleBefore, "no swap, so idle USDC must be unchanged");
        assertEq(vault.totalAssets() - navBefore, 475_000_000, "NAV must rise by exactly the recognized reward value");
    }

    /// @notice Pins the direction of the fix: crediting the ACCOUNTANT - what a
    ///         convenient mock would do - must recognize nothing, because that
    ///         is not where any production path puts a reward token.
    function test_tokensSittingOnTheAccountantAreNotRecognized() public {
        _setPolicy(0, new address[](0));

        reward.mint(address(accountant), 1_000e18);

        vm.prank(admin);
        uint256 value = accountant.refresh(new address[](0));

        assertEq(reward.balanceOf(address(accountant)), 1_000e18, "precondition: the accountant does hold tokens");
        assertEq(value, 0, "a balance on the accountant must not be recognized");
        assertEq(accountant.cachedRewardAssets(), 0, "R_t must stay zero");
    }

    // ------------------------------------------------------------------
    // The `adapters` parameter of refresh() is load-bearing.
    // ------------------------------------------------------------------

    /// @notice Unclaimed-but-claimable rewards are recognized only when the
    ///         adapter holding them is BOTH supplied to refresh() and on the
    ///         token policy's allowlist.
    function test_refreshRecognizesClaimableOnlyFromSuppliedAllowlistedAdapters() public {
        _setPolicy(0, _one(address(adapter)));
        adapter.setClaimable(address(reward), 10e18);

        // Nothing has been claimed: the vault holds no reward token at all.
        assertEq(reward.balanceOf(address(vault)), 0, "precondition: nothing claimed yet");

        vm.prank(admin);
        uint256 withoutAdapters = accountant.refresh(new address[](0));
        assertEq(withoutAdapters, 0, "an empty adapter array must recognize held balances only");

        vm.prank(admin);
        uint256 withAdapter = accountant.refresh(_one(address(adapter)));
        assertEq(withAdapter, 475_000_000, "claimable from an allowlisted, supplied adapter must be recognized");
    }

    /// @notice A supplied adapter that the policy does not allowlist is ignored,
    ///         so the parameter cannot be used to inject an unadmitted source.
    function test_refreshIgnoresAnAdapterThePolicyDoesNotAllowlist() public {
        _setPolicy(0, new address[](0)); // empty allowlist
        adapter.setClaimable(address(reward), 10e18);

        vm.prank(admin);
        assertEq(accountant.refresh(_one(address(adapter))), 0, "a non-allowlisted source must contribute nothing");
    }

    /// @notice The VAULT passes its live active-adapter set, so a partial
    ///         harvest leaves the residual claimable recognized.
    /// @dev Mutant check: reverting NavyVaultSRCLA to `refresh(new address[](0))`
    ///      makes this recognize only the 4e18 claimed leg and the assertion
    ///      fails on 190_000_000 != 475_000_000.
    function test_vaultPassesItsActiveAdaptersSoResidualClaimableIsRecognized() public {
        _setPolicy(0, _one(address(adapter)));
        adapter.setClaimable(address(reward), 10e18);

        vm.prank(allocator);
        vault.harvest(address(adapter), address(reward), 4e18, bytes32(0), 0, block.timestamp + 1);

        assertEq(reward.balanceOf(address(vault)), 4e18, "only the capped amount is claimed");
        assertEq(adapter.claimableReward(address(reward)), 6e18, "the rest stays claimable at the venue");

        // 4 held + 6 claimable = 10 tokens x $50 x 95% = $475.
        assertEq(
            accountant.cachedRewardAssets(),
            475_000_000,
            "the vault's own refresh must see held AND claimable"
        );
    }

    // ------------------------------------------------------------------
    // The vault must be authorised to refresh, or harvest bricks.
    // ------------------------------------------------------------------

    /// @notice `_harvestAtomic` calls `refresh` on every harvest. When the
    ///         accountant does not recognize the caller, that call reverts and
    ///         the whole harvest reverts with it.
    /// @dev This is the third leg of the structural-zero defect: even a correct
    ///      balance source and a correct adapter list would never have run,
    ///      because `refresh` was `onlyRole(REWARD_ADMIN_ROLE)` and the vault
    ///      holds no role on the accountant.
    function test_harvestRevertsWhenTheAccountantDoesNotAuthoriseTheVault() public {
        _setPolicy(0, new address[](0));
        adapter.setClaimable(address(reward), 10e18);

        vm.prank(admin);
        accountant.setVault(address(0)); // revoke the vault's authorisation

        vm.prank(allocator);
        vm.expectRevert(RewardAccountant.Unauthorized.selector);
        vault.harvest(address(adapter), address(reward), 10e18, bytes32(0), 0, block.timestamp + 1);
    }

    /// @notice An arbitrary caller still cannot refresh.
    function test_refreshRejectsAnUnauthorisedCaller() public {
        _setPolicy(0, new address[](0));
        vm.prank(user);
        vm.expectRevert(RewardAccountant.Unauthorized.selector);
        accountant.refresh(new address[](0));
    }

    // ------------------------------------------------------------------
    // Paper 9.2's maxDeposit/maxMint clause is now reachable.
    // ------------------------------------------------------------------

    /// @notice With a real held balance a token can actually become material,
    ///         so a stale material cache closes issuance. With R_t structurally
    ///         zero no token was ever material and this could never fire.
    function test_aStaleMaterialCacheClosesDepositsOnlyBecauseR_tCanBeNonZero() public {
        _setPolicy(1e6, new address[](0)); // material at $1 of value

        adapter.setClaimable(address(reward), 10e18);
        vm.prank(allocator);
        vault.harvest(address(adapter), address(reward), 10e18, bytes32(0), 0, block.timestamp + 1);

        (uint256 value,, bool isMaterial) = accountant.tokenCache(address(reward));
        assertEq(value, 475_000_000, "the cache carries the real value");
        assertTrue(isMaterial, "a $475 reward must be material against a $1 threshold");
        assertEq(vault.maxDeposit(user), type(uint256).max, "a fresh material cache leaves deposits open");

        // Age the cache past its lifetime AND take the reward feed stale, so
        // the lazy refresh on deposit cannot rescue it.
        vm.warp(block.timestamp + 2 hours);
        usdcFeed.setPrice(USDC_PRICE); // keep the USDC leg fresh

        assertEq(vault.maxDeposit(user), 0, "a stale material cache must close deposits");
        assertEq(vault.maxMint(user), 0, "a stale material cache must close mints");

        usdc.mint(user, 100e6);
        vm.startPrank(user);
        usdc.approve(address(vault), 100e6);
        vm.expectRevert(NavyVaultSRCLA.MaterialCacheRequired.selector);
        vault.deposit(100e6, user);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Double-counting guard introduced with the holder change.
    // ------------------------------------------------------------------

    /// @notice The reward holder is the vault, so a policy on the vault's own
    ///         asset would count that asset in NAV twice - once as idle USDC
    ///         and once as reward value.
    function test_aPolicyOnTheVaultAssetIsRejected() public {
        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(usdc),
            feed: address(usdcFeed),
            description: "USDC",
            decimals: 6,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 10_000,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: new address[](0),
            exists: true
        });

        vm.prank(admin);
        vm.expectRevert(RewardAccountant.RewardTokenIsVaultAsset.selector);
        accountant.setTokenPolicy(address(usdc), policy);
    }

    /// @notice The same guard on the other ordering: policy first, then wiring
    ///         a vault whose asset that policy already covers.
    function test_wiringAVaultWhoseAssetIsAlreadyAPolicyTokenIsRejected() public {
        RewardAccountant standalone = new RewardAccountant(admin, address(0));

        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(usdc),
            feed: address(usdcFeed),
            description: "USDC",
            decimals: 6,
            maxAge: 1 hours,
            lowerBound: 0,
            upperBound: type(uint256).max,
            haircutBps: 10_000,
            contributionCap: type(uint256).max,
            materialityThreshold: 0,
            cacheLifetime: 1 hours,
            allowedAdapters: new address[](0),
            exists: true
        });

        vm.prank(admin);
        standalone.setTokenPolicy(address(usdc), policy); // allowed: no vault yet

        vm.prank(admin);
        vm.expectRevert(RewardAccountant.RewardTokenIsVaultAsset.selector);
        standalone.setVault(address(vault));
    }

    // ------------------------------------------------------------------
    // Precision.
    // ------------------------------------------------------------------

    /// @notice A sub-dollar reward must carry a non-zero value. The previous
    ///         formula floored to whole USDC, so anything under $1.00 valued to
    ///         exactly zero and no materialityThreshold below 1e6 could bind.
    function test_aSubDollarRewardIsNotRoundedAwayToZero() public {
        _setPolicy(0, new address[](0));

        // 0.01 tokens x $50 x 95% = $0.475 => 475_000 USDC base units.
        adapter.setClaimable(address(reward), 0.01e18);
        vm.prank(allocator);
        vault.harvest(address(adapter), address(reward), 0.01e18, bytes32(0), 0, block.timestamp + 1);

        assertEq(accountant.cachedRewardAssets(), 475_000, "a $0.475 reward must value to 475_000 base units");
    }
}
