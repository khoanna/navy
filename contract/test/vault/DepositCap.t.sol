// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {IVaultEvents} from "../../src/interfaces/IVaultEvents.sol";
import {MockERC20} from "../../src/MockERC20.sol";

/// @notice P37 G5: the admin-set deposit cap bounds deposits and mints, never
///         withdrawals, and an uncapped vault behaves exactly as before.
contract DepositCapTest is Test {
    uint256 internal constant CAP = 1_000_000e6;

    MockERC20 internal usdc;
    NavyVaultSRCLA internal vault;

    address internal admin = makeAddr("admin");
    address internal allocator = makeAddr("allocator");
    address internal stranger = makeAddr("stranger");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);
    }

    function _deposit(address who, uint256 assets) internal returns (uint256 shares) {
        usdc.mint(who, assets);
        vm.startPrank(who);
        usdc.approve(address(vault), assets);
        shares = vault.deposit(assets, who);
        vm.stopPrank();
    }

    function test_depositCapDefaultsToUncapped() public {
        assertEq(vault.depositCap(), type(uint256).max, "a new vault is uncapped");
        _deposit(alice, 5_000_000e6);
        assertEq(vault.maxDeposit(bob), type(uint256).max, "an uncapped vault keeps advertising unlimited deposits");
        assertEq(vault.maxMint(bob), type(uint256).max, "and unlimited mints");
    }

    function test_onlyAdminCanSetTheDepositCap() public {
        bytes32 adminRole = vault.ADMIN_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, adminRole)
        );
        vault.setDepositCap(CAP);

        vm.prank(allocator);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, allocator, adminRole)
        );
        vault.setDepositCap(CAP);
    }

    function test_setDepositCapEmitsDepositCapSet() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit IVaultEvents.DepositCapSet(type(uint256).max, CAP);
        vm.prank(admin);
        vault.setDepositCap(CAP);

        assertEq(vault.depositCap(), CAP, "the cap is stored");
    }

    function test_maxDepositAndMaxMintAreTheRoomBelowTheCap() public {
        vm.prank(admin);
        vault.setDepositCap(CAP);
        _deposit(alice, 400_000e6);

        assertEq(vault.maxDeposit(bob), 600_000e6, "room is the cap minus totalAssets");
        // alice's deposit was the vault's first, so its exchange rate is
        // exactly 1e6 shares per asset unit (the 6-decimal offset with no
        // rounding at an empty vault): convertToShares(600_000e6) here is
        // exactly 600_000e12, not an approximation.
        assertEq(vault.maxMint(bob), 600_000e12, "maxMint is the room in shares, rounded down");
    }

    function test_depositUpToTheCapSucceedsAndOneMoreUnitReverts() public {
        vm.prank(admin);
        vault.setDepositCap(CAP);
        _deposit(alice, CAP);

        assertEq(vault.totalAssets(), CAP, "a deposit of exactly the room fills the cap");
        assertEq(vault.maxDeposit(bob), 0, "a full vault advertises no room");

        usdc.mint(bob, 1);
        vm.startPrank(bob);
        usdc.approve(address(vault), 1);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 1, 0));
        vault.deposit(1, bob);
        vm.stopPrank();
    }

    function test_mintAboveMaxMintReverts() public {
        vm.prank(admin);
        vault.setDepositCap(CAP);
        _deposit(alice, 400_000e6);

        uint256 maxShares = vault.maxMint(bob);
        uint256 shares = maxShares + 1;
        uint256 assetsNeeded = vault.previewMint(shares);
        usdc.mint(bob, assetsNeeded);

        vm.startPrank(bob);
        usdc.approve(address(vault), assetsNeeded);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxMint.selector, bob, shares, maxShares));
        vault.mint(shares, bob);
        vm.stopPrank();
    }

    function test_yieldMayCarryAssetsPastTheCapAndOnlyClosesDeposits() public {
        vm.prank(admin);
        vault.setDepositCap(CAP);
        uint256 shares = _deposit(alice, CAP);

        usdc.mint(address(vault), 10_000e6); // accrued yield, no shares minted
        assertGt(vault.totalAssets(), CAP, "yield is not clamped by the cap");
        assertEq(vault.maxDeposit(bob), 0, "deposits close above the cap");
        assertEq(vault.maxMint(bob), 0, "mints close above the cap");

        vm.prank(alice);
        uint256 assetsOut = vault.redeem(shares / 2, alice, alice);
        assertGt(assetsOut, 0, "withdrawals are unaffected by the cap");
    }

    function test_loweringTheCapBelowNavClosesDepositsButNotWithdrawals() public {
        uint256 shares = _deposit(alice, 500_000e6);

        vm.prank(admin);
        vault.setDepositCap(100_000e6);
        assertEq(vault.maxDeposit(bob), 0, "a cap below NAV admits nothing");
        assertEq(vault.maxMint(bob), 0, "nor does it admit any mint");

        vm.prank(alice);
        uint256 assetsOut = vault.redeem(shares / 10, alice, alice);
        assertGt(assetsOut, 0, "a cap below NAV never blocks a redemption");
    }

    function test_theExistingZeroCasesStillWinBelowTheCap() public {
        vm.startPrank(admin);
        vault.setDepositCap(CAP);
        vault.pause();
        vm.stopPrank();

        assertEq(vault.maxDeposit(bob), 0, "a paused vault advertises no deposits even below its cap");
        assertEq(vault.maxMint(bob), 0, "nor mints");
    }

    function test_settingTheCapBackToMaxRestoresUncapped() public {
        vm.startPrank(admin);
        vault.setDepositCap(CAP);
        vault.setDepositCap(type(uint256).max);
        vm.stopPrank();

        _deposit(alice, 5_000_000e6);
        assertEq(vault.maxDeposit(bob), type(uint256).max, "type(uint256).max is uncapped, not netted against NAV");
        assertEq(vault.maxMint(bob), type(uint256).max, "and maxMint does not overflow converting it");
    }

    function testFuzz_depositNeverTakesAssetsPastTheCap(uint256 cap, uint256 first, uint256 second) public {
        cap = bound(cap, 1, 1_000_000_000e6);
        first = bound(first, 1, cap);
        second = bound(second, 1, 2_000_000_000e6);

        vm.prank(admin);
        vault.setDepositCap(cap);
        _deposit(alice, first);

        uint256 room = vault.maxDeposit(bob);
        assertEq(room, cap - first, "room is the cap minus what is already in");

        usdc.mint(bob, second);
        vm.startPrank(bob);
        usdc.approve(address(vault), second);
        if (second > room) {
            vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, second, room));
        }
        vault.deposit(second, bob);
        vm.stopPrank();

        assertLe(vault.totalAssets(), cap, "deposits alone never carry totalAssets past the cap");
    }

    function testFuzz_maxMintNeverAdmitsMoreAssetsThanMaxDeposit(uint256 cap, uint256 first, uint256 yield_)
        public
    {
        cap = bound(cap, 1, 1_000_000_000e6);
        first = bound(first, 1, cap);
        yield_ = bound(yield_, 0, 1_000_000e6);

        vm.prank(admin);
        vault.setDepositCap(cap);
        _deposit(alice, first);
        usdc.mint(address(vault), yield_);

        uint256 shares = vault.maxMint(bob);
        uint256 assetsNeeded = vault.previewMint(shares);
        assertLe(assetsNeeded, vault.maxDeposit(bob), "minting maxMint shares never needs more than maxDeposit");

        if (shares > 0) {
            usdc.mint(bob, assetsNeeded);
            vm.startPrank(bob);
            usdc.approve(address(vault), assetsNeeded);
            vault.mint(shares, bob);
            vm.stopPrank();
            assertLe(vault.totalAssets(), cap, "a mint of maxMint shares stays within the cap");
        }
    }

    function test_zeroCapClosesDepositsAndMints() public {
        uint256 shares = _deposit(alice, 500_000e6);

        vm.prank(admin);
        vault.setDepositCap(0);

        assertEq(vault.maxDeposit(bob), 0, "a zero cap admits no deposit");
        assertEq(vault.maxMint(bob), 0, "nor any mint");

        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 1, 0));
        vault.deposit(1, bob);

        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxMint.selector, bob, 1, 0));
        vault.mint(1, bob);
        vm.stopPrank();

        vm.prank(alice);
        uint256 assetsOut = vault.redeem(shares, alice, alice);
        assertEq(assetsOut, 500_000e6, "a zero cap never blocks a holder's full redemption");
    }

    function test_capReturnsZeroWhenSyncIsUnauthorised() public {
        vm.prank(admin);
        vault.setDepositCap(CAP);

        DepositCapMockAccountant accountant = new DepositCapMockAccountant();
        accountant.setVault(stranger); // not the vault: syncForShareAction is unauthorised
        vm.prank(admin);
        vault.setRewardAccountant(address(accountant));

        assertEq(vault.maxDeposit(bob), 0, "an unauthorised accountant blocks deposits even under a live cap");
        assertEq(vault.maxMint(bob), 0, "and mints");
    }

    function test_capReturnsZeroWhenCacheIsStale() public {
        vm.prank(admin);
        vault.setDepositCap(CAP);

        DepositCapMockAccountant accountant = new DepositCapMockAccountant();
        accountant.setVault(address(vault));
        accountant.setIssuanceReady(false);
        vm.prank(admin);
        vault.setRewardAccountant(address(accountant));

        assertEq(vault.maxDeposit(bob), 0, "a stale material cache blocks deposits even under a live cap");
        assertEq(vault.maxMint(bob), 0, "and mints");
    }

    /// @notice P37 fix-round Important 1: maxDeposit/maxMint read the vault's
    ///         CACHED NAV, exactly like previewMint/maxWithdraw. deposit()/
    ///         mint() re-sync every adapter first, so the cap they enforce is
    ///         always checked against the freshly-synced NAV - only the
    ///         advisory view can overstate the room, by whatever adapter
    ///         interest accrued since the last sync.
    function test_staleAdapterCacheOverstatesRoomButTheCapHolds() public {
        uint256 v = 400_000e6;
        uint256 delta = 50_000e6;

        DepositCapMockAdapter adapterMock = new DepositCapMockAdapter(address(vault), address(usdc), v);
        vm.prank(admin);
        vault.registerAdapter(address(adapterMock), 10_000, 10_000, "mock");
        vm.prank(admin);
        vault.setDepositCap(CAP);

        // Registration's tolerant sync (NavyVaultSRCLA.sol's registerAdapter)
        // caches the adapter's value at registration time: V.
        assertEq(vault.totalAssets(), v, "the cached NAV after registration is V");

        uint256 staleRoom = CAP - v; // 1_000_000e6 - 400_000e6 = 600_000e6
        uint256 syncedRoom = CAP - (v + delta); // 1_000_000e6 - 450_000e6 = 550_000e6

        // Raise the adapter's live value WITHOUT a vault sync: the cache is
        // now stale by delta.
        adapterMock.setReported(v + delta);

        // (i) the view reads the cached NAV, so it still advertises the
        // stale room.
        assertEq(vault.maxDeposit(bob), staleRoom, "(i) maxDeposit reads the stale cached NAV");

        usdc.mint(bob, staleRoom);
        vm.startPrank(bob);
        usdc.approve(address(vault), staleRoom);
        // (ii) deposit() re-syncs every adapter (updating the cache to
        // v + delta) BEFORE OpenZeppelin's maxDeposit check, so the check
        // runs against the freshly-synced, smaller room and rejects the
        // stale one.
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, staleRoom, syncedRoom));
        vault.deposit(staleRoom, bob);
        vm.stopPrank();

        // (iii) the synced room succeeds - the cap itself held.
        vm.prank(bob);
        vault.deposit(syncedRoom, bob);

        // (iv) the vault is now exactly at its cap.
        assertEq(vault.totalAssets(), CAP, "the synced deposit fills the cap exactly");
        assertEq(vault.maxDeposit(bob), 0, "(iv) the cap holds against the now-synced NAV");
    }
}

/// @dev Minimal strategy adapter whose accrued value can be raised without
///      the vault knowing until the next sync (registration, deposit, mint,
///      or an allocator action). Mirrors the shape of RRAdapter in
///      AllocatorRewardRefresh.t.sol and InvariantMockAdapter in
///      NavyVaultInvariant.t.sol.
contract DepositCapMockAdapter {
    address internal immutable vaultAddress;
    address internal immutable assetAddress;
    uint256 public reported;

    constructor(address vault_, address asset_, uint256 reported_) {
        vaultAddress = vault_;
        assetAddress = asset_;
        reported = reported_;
    }

    function setReported(uint256 value) external {
        reported = value;
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
        return sent;
    }
}

/// @dev Minimal reward accountant mock, following the pattern of
///      MockRewardAccountant in VaultHarvest.t.sol: no AccessControl, so its
///      setters need no role, and it models the two states the vault's
///      maxDeposit/maxMint gate on ahead of the cap - an unauthorised `vault`
///      pointer and a not-ready issuance cache.
contract DepositCapMockAccountant {
    address public vault;
    bool internal issuanceReady_ = true;

    function setVault(address vault_) external {
        vault = vault_;
    }

    function setIssuanceReady(bool ready) external {
        issuanceReady_ = ready;
    }

    function cachedRewardAssets() external pure returns (uint256) {
        return 0;
    }

    function issuanceReady() external view returns (bool) {
        return issuanceReady_;
    }

    function configurationDigest() external pure returns (bytes32) {
        return keccak256("deposit-cap-mock-accountant");
    }

    function recognizedRewardAssets() external pure returns (uint256) {
        return type(uint256).max;
    }

    function syncForShareAction(bool) external pure returns (uint256) {
        return 0;
    }
}
