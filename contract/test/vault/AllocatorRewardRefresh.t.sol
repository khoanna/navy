// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {RewardAccountant} from "../../src/reward/RewardAccountant.sol";
import {IRewardAccountant} from "../../src/interfaces/IRewardAccountant.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract RRFeed {
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

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestAnswer() external view returns (int256) {
        return price;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, price, updatedAt, updatedAt, roundId);
    }
}

contract RRToken {
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

/// @dev Stands in for the accountant and reverts on every state-changing call.
///      Used to prove a reward-oracle outage cannot suppress a safety unwind.
contract RRRevertingAccountant {
    address public immutable vault;

    constructor(address v) {
        vault = v;
    }

    function syncForShareAction(bool) external pure returns (uint256) {
        revert("accountant down");
    }

    function refresh(address[] calldata) external pure returns (uint256) {
        revert("accountant down");
    }

    function cachedRewardAssets() external pure returns (uint256) {
        return 0;
    }

    function recognizedRewardAssets() external pure returns (uint256) {
        return 0;
    }

    function issuanceReady() external pure returns (bool) {
        return true;
    }

    function configurationDigest() external pure returns (bytes32) {
        return bytes32(uint256(1));
    }
}

/// @dev A minimal adapter. `withdraw` pays out of its own balance.
contract RRAdapter {
    address public immutable vaultAddress;
    address public immutable assetAddress;
    uint256 public reported;

    constructor(address v, address a) {
        vaultAddress = v;
        assetAddress = a;
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
        return reported;
    }

    function maxDeployable() external pure returns (uint256) {
        return type(uint256).max;
    }

    function configurationDigest() external view returns (bytes32) {
        return keccak256(abi.encode(vaultAddress, assetAddress));
    }

    function rewardTokens() external pure returns (address[] memory) {
        return new address[](0);
    }

    function claimableReward(address) external pure returns (uint256) {
        return 0;
    }

    function claimReward(address, uint256, address) external pure returns (uint256) {
        return 0;
    }

    function deposit(uint256 assets) external returns (uint256) {
        reported += assets;
        return assets;
    }

    function withdraw(uint256 assets) external returns (uint256) {
        uint256 sent = assets > reported ? reported : assets;
        reported -= sent;
        MockUSDC(assetAddress).transfer(vaultAddress, sent);
        return sent;
    }
}

/// @title AllocatorRewardRefreshBase
/// @notice Audit Item 1. Paper 9.2: "share-changing AND ALLOCATOR transactions
///         refresh material reward values lazily when cache-age or
///         material-change rules require it." Only the share-changing leg
///         existed (`deposit`/`mint` call `syncForShareAction`);
///         `executeNextActionWithProof` and `emergencyExit` never touched the
///         accountant, so a plan that deployed or divested left reward NAV at
///         whatever the last deposit or harvest happened to write.
abstract contract AllocatorRewardRefreshBase is Test {
    NavyVaultSRCLA internal vault;
    MockUSDC internal usdc;
    RewardAccountant internal accountant;
    RRAdapter internal adapter;
    RRFeed internal usdcFeed;
    RRFeed internal tokenFeed;
    RRToken internal rewardToken;

    address internal user = address(0xB0B);
    address internal allocator = address(0xA110C);

    uint256 internal constant DEPOSIT = 10_000e6;
    uint256 internal constant DEPLOYED = 4_000e6;
    uint256 internal constant CACHE_LIFETIME = 1 hours;
    /// @dev Shorter than CACHE_LIFETIME on purpose: warping past the cache
    ///      lifetime WITHOUT re-stamping the feeds makes the lazy refresh
    ///      genuinely unable to succeed, which is the only way to observe the
    ///      "stale value closes issuance" remedy.
    uint256 internal constant FEED_MAX_AGE = 30 minutes;

    uint256 internal _nextPlanId;
    /// @dev The reward NAV recorded by the seeding refresh in setUp.
    uint256 internal seededRewardValue;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        adapter = new RRAdapter(address(vault), address(usdc));
        vault.registerAdapter(address(adapter), 10_000, 500, "RR");
        vault.setMinIdleBps(0);

        usdc.mint(user, DEPOSIT);
        vm.startPrank(user);
        usdc.approve(address(vault), DEPOSIT);
        vault.deposit(DEPOSIT, user);
        vm.stopPrank();

        _deploy(DEPLOYED);

        // ---- wire the accountant AFTER the seeding deploy, so the plan above
        // ---- is not invalidated by the configuration-digest change.
        usdcFeed = new RRFeed(1e6);
        tokenFeed = new RRFeed(1e18); // $1 in the policy's 18-decimal convention
        rewardToken = new RRToken();

        if (!_accountantEnabled()) return;

        accountant = new RewardAccountant(address(this), address(vault));
        accountant.setUsdcUsdFeed(address(usdcFeed));
        accountant.setTokenPolicy(address(rewardToken), _policy());
        accountant.setVault(address(vault));
        vault.setRewardAccountant(address(accountant));

        // The vault is the reward HOLDER (RewardAccountant._rewardHolder).
        rewardToken.mint(address(vault), 100e18);
        accountant.refresh(new address[](0));

        seededRewardValue = accountant.cachedRewardAssets();
        assertEq(seededRewardValue, 100e6, "setUp: 100 tokens at $1 with no haircut is 100 USDC");
    }

    /// @dev `setRewardAccountant` rejects address(0), so "no accountant wired"
    ///      cannot be reached by unwiring - it has to be a vault that never had
    ///      one. See NoAccountantAllocatorActionTest below.
    function _accountantEnabled() internal pure virtual returns (bool) {
        return true;
    }

    function _policy() internal view returns (IRewardAccountant.TokenPolicy memory) {
        return IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(tokenFeed),
            description: "RR",
            decimals: 18,
            maxAge: FEED_MAX_AGE,
            lowerBound: 0,
            upperBound: 1e30,
            haircutBps: 10_000,
            contributionCap: type(uint256).max,
            materialityThreshold: 1, // any non-zero value is material
            cacheLifetime: CACHE_LIFETIME,
            allowedAdapters: new address[](0),
            exists: true
        });
    }

    function _action(uint32 index, NavyVaultSRCLA.ActionKind kind, uint256 amount)
        internal
        view
        returns (NavyVaultSRCLA.Action memory)
    {
        return NavyVaultSRCLA.Action({
            planId: _nextPlanId,
            index: index,
            kind: kind,
            adapter: address(adapter),
            amount: amount,
            minOut: 0,
            dataHash: bytes32(0)
        });
    }

    function _submitAndRun(NavyVaultSRCLA.ActionKind kind, uint256 amount) internal {
        _nextPlanId++;
        NavyVaultSRCLA.Action memory a = _action(0, kind, amount);
        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: a.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256(abi.encode("s", a.planId)),
            decisionHash: keccak256(abi.encode("d", a.planId)),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });
        bytes32 leaf = vault.hashPlanAction(vault.planDomain(header), a);
        vm.startPrank(allocator);
        vault.submitPlan(header, leaf);
        vault.executeNextActionWithProof(new bytes32[](0), a);
        vm.stopPrank();
    }

    function _deploy(uint256 amount) internal {
        _submitAndRun(NavyVaultSRCLA.ActionKind.Deploy, amount);
    }

    /// @dev Age the cache past its lifetime and double the held reward
    ///      balance, so a refresh that runs is worth exactly 2x the seed and a
    ///      refresh that does not run leaves exactly the seed.
    function _staleAndDoubled() internal {
        vm.warp(block.timestamp + CACHE_LIFETIME + 1);
        tokenFeed.setPrice(1e18); // re-stamp updatedAt; the PRICE is unchanged
        usdcFeed.setPrice(1e6);
        rewardToken.mint(address(vault), 100e18);
        assertEq(accountant.cachedRewardAssets(), seededRewardValue, "precondition: the cache has NOT moved yet");
    }

}

/// @notice The allocator leg with a real RewardAccountant wired.
contract AllocatorRewardRefreshTest is AllocatorRewardRefreshBase {
    // ==================================================================
    // Item 1 - the allocator leg
    // ==================================================================

    /// @notice A plan Divest must refresh a stale material reward value.
    /// @dev Mutant check: deleting the `_refreshRewardsForAllocatorAction()`
    ///      call from `executeNextActionWithProof` leaves the cache at the
    ///      seeded value and both assertions fail. Note the quantity, not the
    ///      price, is what changes - so this cannot pass by accident on a
    ///      revaluation of the same balance.
    function test_aPlanDivestRefreshesAStaleMaterialRewardValue() public {
        _staleAndDoubled();
        uint256 navBefore = vault.totalAssets();

        _submitAndRun(NavyVaultSRCLA.ActionKind.Divest, 1_000e6);

        assertEq(accountant.cachedRewardAssets(), 2 * seededRewardValue, "the allocator action refreshed the cache");
        assertEq(vault.totalAssets(), navBefore + seededRewardValue, "and the fresh value reached NAV");
    }

    /// @notice The same for a Deploy. 9.2 says "allocator transactions", not
    ///         "divests".
    /// @dev Mutant check: as above.
    function test_aPlanDeployRefreshesAStaleMaterialRewardValue() public {
        _staleAndDoubled();

        _submitAndRun(NavyVaultSRCLA.ActionKind.Deploy, 500e6);

        assertEq(accountant.cachedRewardAssets(), 2 * seededRewardValue, "a deploy refreshes too");
    }

    /// @notice And for an EmergencyExit action inside a plan.
    function test_aPlanEmergencyExitRefreshesAStaleMaterialRewardValue() public {
        _staleAndDoubled();

        _submitAndRun(NavyVaultSRCLA.ActionKind.EmergencyExit, 0);

        assertEq(accountant.cachedRewardAssets(), 2 * seededRewardValue, "an in-plan exit refreshes too");
    }

    /// @notice And for the direct `emergencyExit` lever.
    /// @dev Mutant check: deleting the call from `emergencyExit` fails here.
    function test_theDirectEmergencyExitRefreshesAStaleMaterialRewardValue() public {
        _staleAndDoubled();

        vm.prank(allocator);
        vault.emergencyExit(address(adapter));

        assertEq(accountant.cachedRewardAssets(), 2 * seededRewardValue, "the direct exit refreshes too");
    }

    /// @notice "Lazily when cache-age rules require it" - a cache that is
    ///         still inside its lifetime is carried forward untouched, not
    ///         re-read. Without this the refresh would be the periodic on-chain
    ///         refresh 9.2 explicitly rules out.
    /// @dev Mutant check: swapping `syncForShareAction(false)` for
    ///      `refresh(_activeAdapters)` re-reads unconditionally and the cache
    ///      doubles here, failing the assertion.
    function test_aFreshCacheIsNotReReadByAnAllocatorAction() public {
        rewardToken.mint(address(vault), 100e18); // the held balance doubles
        // ...but no time passes, so the cache is still within its lifetime.

        _submitAndRun(NavyVaultSRCLA.ActionKind.Divest, 1_000e6);

        assertEq(accountant.cachedRewardAssets(), seededRewardValue, "a fresh cache is carried forward, not re-read");
    }

    // ==================================================================
    // The refresh must never become a lever that blocks the unwind
    // ==================================================================

    /// @notice Paper 9.1 requires a bounded safety unwind. A reward-oracle
    ///         outage must not be able to suppress it.
    /// @dev Mutant check: removing the try/catch from
    ///      `_refreshRewardsForAllocatorAction` makes this revert with
    ///      "accountant down" and the test fails.
    function test_aRevertingAccountantDoesNotBlockAnEmergencyExit() public {
        vault.setRewardAccountant(address(new RRRevertingAccountant(address(vault))));

        vm.prank(allocator);
        vault.emergencyExit(address(adapter));

        assertEq(vault.strategyAssets(address(adapter)), 0, "the unwind completed despite the failing accountant");
    }

    /// @notice The same for a plan divest - the ordinary de-risking path.
    function test_aRevertingAccountantDoesNotBlockAPlanDivest() public {
        vault.setRewardAccountant(address(new RRRevertingAccountant(address(vault))));

        _submitAndRun(NavyVaultSRCLA.ActionKind.Divest, 1_000e6);

        assertEq(vault.strategyAssets(address(adapter)), DEPLOYED - 1_000e6, "the divest completed");
    }

    /// @notice A failed refresh is not silent: the stale cache still closes
    ///         issuance, which is 9.2's own remedy. Pinned so the best-effort
    ///         catch above is not mistaken for swallowing the condition.
    function test_aStaleCacheStillClosesIssuanceAfterAnAllocatorAction() public {
        vm.warp(block.timestamp + CACHE_LIFETIME + 1);
        // The USDC feed is now stale too, so the lazy refresh cannot succeed.
        assertFalse(accountant.issuanceReady(), "precondition: the material cache is stale");

        _submitAndRun(NavyVaultSRCLA.ActionKind.Divest, 1_000e6);

        assertEq(vault.maxDeposit(user), 0, "deposits stay closed until a safe refresh succeeds");
        assertEq(vault.maxMint(user), 0, "and so do mints");
    }
}

/// @notice The unwired case. `rewardAccountant == address(0)` is the default
///         for every deployment that has not admitted a reward token, and the
///         refresh must be a no-op there rather than a call into address(0).
/// @dev Mutant check: deleting the `if (accountant == address(0)) return;`
///      guard turns the refresh into a call to an address with no code whose
///      empty returndata cannot be decoded as `uint256` - which is NOT caught
///      by the `catch` - and every allocator action in the repo starts
///      reverting, this one first.
contract NoAccountantAllocatorActionTest is AllocatorRewardRefreshBase {
    function _accountantEnabled() internal pure override returns (bool) {
        return false;
    }

    function test_anAllocatorActionWithNoAccountantWiredIsUnaffected() public {
        assertEq(vault.rewardAccountant(), address(0), "precondition: nothing is wired");
        _submitAndRun(NavyVaultSRCLA.ActionKind.Divest, 1_000e6);
        assertEq(vault.strategyAssets(address(adapter)), DEPLOYED - 1_000e6, "the divest ran");
    }
}
