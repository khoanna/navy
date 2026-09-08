// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";
import {VaultGuardrails} from "../../script/VaultGuardrails.sol";

/// @dev 6-decimal USDC.
contract GRUsdc {
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function burn(address from, uint256 amount) external {
        balanceOf[from] -= amount;
        totalSupply -= amount;
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

/// @notice Adapter with independently controllable position value, synchronous
///         exit capacity, and a per-withdrawal shortfall that models a venue's
///         base-unit rounding floor.
contract GRAdapter {
    address public immutable vaultAddress;
    address public immutable assetAddress;

    uint256 public reported;
    uint256 public withdrawable;
    /// @dev Base units retained on every withdraw. Comet floors ~2.
    uint256 public dustShortfall;
    /// @dev When set, a deposit does NOT raise synchronous exit capacity -
    ///      the venue took the funds but has no free cash to return them.
    bool public freezeWithdrawable;

    constructor(address vault_, address asset_) {
        vaultAddress = vault_;
        assetAddress = asset_;
    }

    function setWithdrawable(uint256 v) external {
        withdrawable = v;
    }

    function setDustShortfall(uint256 v) external {
        dustShortfall = v;
    }

    function setFreezeWithdrawable(bool v) external {
        freezeWithdrawable = v;
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
        if (!freezeWithdrawable) withdrawable += assets;
        return assets;
    }

    /// @dev Models a venue floor faithfully: the POSITION is debited by the
    ///      full requested amount but only `debited - dustShortfall` is
    ///      actually transferred, so the vault sees a real shortfall. A mock
    ///      that debited only what it paid would report no loss at all and the
    ///      loss guard under test would never be exercised.
    function withdraw(uint256 assets) external returns (uint256) {
        uint256 debited = assets > withdrawable ? withdrawable : assets;
        uint256 sent = debited > dustShortfall ? debited - dustShortfall : 0;
        withdrawable -= debited;
        reported = reported > debited ? reported - debited : 0;
        GRUsdc(assetAddress).transfer(vaultAddress, sent);
        return sent;
    }
}

/// @title VaultGuardrailsTest
/// @notice NEW-6. Each test asserts a guardrail is BOTH set to the documented
///         value AND that it changes vault behaviour, so a regression to the
///         unconfigured defaults cannot pass.
contract VaultGuardrailsTest is Test {
    NavyVaultSRCLA internal vault;
    GRUsdc internal usdc;
    GRAdapter internal aave;
    GRAdapter internal compound;
    GRAdapter internal moonwell;

    address internal user = address(0xB0B);
    address internal allocator = address(0xA110C);

    function setUp() public {
        usdc = new GRUsdc();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        aave = new GRAdapter(address(vault), address(usdc));
        compound = new GRAdapter(address(vault), address(usdc));
        moonwell = new GRAdapter(address(vault), address(usdc));

        // The same registration parameters the Base deploy uses.
        vault.registerAdapter(address(aave), 4_000, 100, "Aave V3 Base USDC");
        vault.registerAdapter(address(compound), 4_000, 100, "Compound III Base USDC");
        vault.registerAdapter(address(moonwell), 2_000, 150, "Moonwell Base USDC");
    }

    function _ordered() internal view returns (address[] memory list) {
        list = new address[](3);
        list[0] = address(aave);
        list[1] = address(compound);
        list[2] = address(moonwell);
    }

    function _configure() internal {
        VaultGuardrails.applyTo(vault, _ordered());
    }

    function _deposit(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(vault), amount);
        vault.deposit(amount, who);
        vm.stopPrank();
    }

    uint256 internal _nextPlanId;

    /// @dev Deploys are reachable only through a committed plan, so these
    ///      helpers exercise the real `executeNextActionWithProof` path rather
    ///      than an internal shortcut. A single-leaf tree's root IS the leaf,
    ///      so the proof is empty.
    function _action(NavyVaultSRCLA.ActionKind kind, address adapter, uint256 amount)
        internal
        returns (NavyVaultSRCLA.Action memory)
    {
        return NavyVaultSRCLA.Action({
            planId: ++_nextPlanId,
            index: 0,
            kind: kind,
            adapter: adapter,
            amount: amount,
            minOut: 0,
            dataHash: bytes32(0)
        });
    }

    function _submit(NavyVaultSRCLA.Action memory action) internal {
        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: action.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256(abi.encode("snapshot", action.planId)),
            decisionHash: keccak256(abi.encode("decision", action.planId)),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });
        bytes32 leaf = vault.hashPlanAction(vault.planDomain(header), action);
        vm.prank(allocator);
        vault.submitPlan(header, leaf);
    }

    /// @dev Submits, then executes. The execute call is made on its own so a
    ///      caller can wrap ONLY it in `vm.expectRevert` - the submit and the
    ///      funding steps make successful external calls first, and
    ///      `expectRevert` guards the literal next one.
    function _deployVia(address adapter, uint256 amount) internal {
        NavyVaultSRCLA.Action memory action = _action(NavyVaultSRCLA.ActionKind.Deploy, adapter, amount);
        _submit(action);
        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), action);
    }

    function _submitDeploy(address adapter, uint256 amount)
        internal
        returns (NavyVaultSRCLA.Action memory action)
    {
        action = _action(NavyVaultSRCLA.ActionKind.Deploy, adapter, amount);
        _submit(action);
    }

    // ------------------------------------------------------------------
    // The unconfigured defaults, pinned so the regression is visible.
    // ------------------------------------------------------------------

    /// @notice What a deploy script produced before NEW-6 was addressed.
    function test_anUnconfiguredVaultHasEveryGuardrailOff() public view {
        (,,,,, uint16 floorA,) = vault.adapters(address(aave));
        (,,,,, uint16 floorC,) = vault.adapters(address(compound));
        (,,,,, uint16 floorM,) = vault.adapters(address(moonwell));
        assertEq(floorA, 0, "P5 liquidity floor defaults off");
        assertEq(floorC, 0, "P5 liquidity floor defaults off");
        assertEq(floorM, 0, "P5 liquidity floor defaults off");

        assertEq(vault.maxSynchronousLossBps(), 0, "loss allowance defaults to zero, not to a tolerance");
        assertEq(vault.adminReserve(), 0, "no admin floor by default");
        assertEq(vault.withdrawalOrder().length, 0, "no deterministic divestment order by default");
    }

    // ------------------------------------------------------------------
    // Each guardrail: set, and binding.
    // ------------------------------------------------------------------

    function test_configureSetsEveryGuardrailToItsDocumentedValue() public {
        _configure();

        (uint16 capA, uint256 absA, uint16 lossA,,, uint16 floorA,) = vault.adapters(address(aave));
        assertEq(floorA, 9_000, "aave liquidity floor");
        assertEq(capA, 4_000, "registerAdapter's capBps must be preserved, not overwritten");
        assertEq(lossA, 100, "registerAdapter's maxLossBps must be preserved");
        assertEq(absA, type(uint256).max, "absolute cap preserved");

        (,,,,, uint16 floorC,) = vault.adapters(address(compound));
        (uint16 capM,, uint16 lossM,,, uint16 floorM,) = vault.adapters(address(moonwell));
        assertEq(floorC, 9_000, "compound liquidity floor");
        assertEq(floorM, 9_000, "moonwell liquidity floor");
        assertEq(capM, 2_000, "moonwell capBps preserved");
        assertEq(lossM, 150, "moonwell maxLossBps preserved");

        assertEq(vault.maxSynchronousLossBps(), 5, "synchronous loss allowance");
        assertEq(vault.adminReserve(), 1_000e6, "admin idle floor");

        address[] memory order = vault.withdrawalOrder();
        assertEq(order.length, 3, "withdrawal order length");
        assertEq(order[0], address(aave), "aave drains first: its exit is exact");
        assertEq(order[1], address(compound), "compound second: base-unit supply floor");
        assertEq(order[2], address(moonwell), "moonwell last: exchange-rate conversion");

        (uint16 gCap, uint256 gAbs, address[] memory gMembers) = vault.getDependencyGroup(VaultGuardrails.GROUP_BASE_L2);
        assertEq(gCap, 10_000, "Base is an accepted common-mode dependency at 100%");
        assertEq(gAbs, type(uint256).max, "no absolute common-mode cap");
        assertEq(gMembers.length, 3, "every adapter is on Base");

        (uint16 uCap,, address[] memory uMembers) = vault.getDependencyGroup(VaultGuardrails.GROUP_NATIVE_USDC);
        assertEq(uCap, 10_000, "native USDC is an accepted common-mode dependency at 100%");
        assertEq(uMembers.length, 3, "every adapter holds native USDC");
    }

    /// @notice P5 binds: a venue that cannot synchronously return 90% of the
    ///         resulting position rejects the deploy.
    /// @dev Mutant check: setting LIQUIDITY_FLOOR_BPS back to 0 makes this
    ///      deploy succeed and the expectRevert fails.
    function test_theLiquidityFloorRejectsADeployIntoAnIlliquidVenue() public {
        _configure();
        _deposit(user, 100_000e6);

        // The venue takes the funds but reports only 80% of the resulting
        // position as synchronously exitable - below the 90% floor.
        aave.setFreezeWithdrawable(true);
        aave.setWithdrawable(8_000e6);
        NavyVaultSRCLA.Action memory action = _submitDeploy(address(aave), 10_000e6);
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterLiquidityFloorBreached.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);
    }

    /// @notice ...and does not reject a healthy one, so the floor is a
    ///         liquidity guard rather than a blanket deploy block.
    function test_theLiquidityFloorAllowsADeployIntoALiquidVenue() public {
        _configure();
        _deposit(user, 100_000e6);

        _deployVia(address(aave), 10_000e6);
        assertEq(vault.strategyAssets(address(aave)), 10_000e6, "a liquid venue accepts the deploy");
    }

    /// @notice A venue that sheds a couple of base units on withdrawal must not
    ///         revert a redemption.
    /// @dev With the unconfigured default of `maxSynchronousLossBps == 0` the
    ///      allowance is `mulDiv(assets, 0, 10_000) == 0`, so this 2-base-unit
    ///      shortfall reverts SynchronousLossExceeded - the exact failure NEW-6
    ///      predicts for any Compound-sourced redemption on a default deploy.
    function test_theLossAllowanceToleratesVenueDust() public {
        _configure();
        _deposit(user, 100_000e6);

        _deployVia(address(aave), 40_000e6);
        _deployVia(address(compound), 40_000e6);
        assertEq(usdc.balanceOf(address(vault)), 20_000e6, "precondition: the withdrawal must need a divest");

        // A venue that floors a couple of base units on withdrawal, as
        // Compound III does on supply. Aave is first in the withdrawal order,
        // so it takes the large pull; the 2-unit residual is topped up from
        // the clean next venue.
        aave.setDustShortfall(2);

        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        vault.withdraw(50_000e6, user, user);
        assertEq(usdc.balanceOf(user) - before, 50_000e6, "a base-unit venue shortfall must not block a redemption");
        assertGt(vault.recognizedLosses(), 0, "the dust is recognized as a loss, not silently absorbed");
    }

    /// @notice ...but a shortfall past the allowance still reverts, so the
    ///         tolerance is a dust allowance and not an open door.
    function test_theLossAllowanceStillRejectsARealLoss() public {
        _configure();
        _deposit(user, 100_000e6);

        _deployVia(address(aave), 40_000e6);
        _deployVia(address(compound), 40_000e6);

        // 5 bps of a 50,000e6 withdrawal is 25_000_000 base units. Aave is
        // first in the withdrawal order and will be asked for the whole
        // 30,000e6 shortfall, so a single 26_000_000 shortfall exceeds it.
        aave.setDustShortfall(26_000_000);

        vm.prank(user);
        vm.expectRevert(NavyVaultSRCLA.SynchronousLossExceeded.selector);
        vault.withdraw(50_000e6, user, user);
    }

    /// @notice Paper 8.1's absolute floor binds while the vault is small, which
    ///         is exactly the regime `minIdleBps` cannot cover.
    function test_theAdminReserveBindsWhileTheProportionalFloorIsTooSmall() public {
        _configure();
        _deposit(user, 50_000e6);

        // 0.5% of $50k is $250; the absolute floor is $1,000 and must win.
        assertEq(vault.requiredIdle(), 1_000e6, "the absolute floor dominates at small NAV");

        // Fill the two 40% adapters, leaving $10,000 idle. NAV is unchanged by
        // a deploy, so the per-adapter caps stay at $20,000 / $20,000 / $10,000.
        _deployVia(address(aave), 20_000e6);
        _deployVia(address(compound), 20_000e6);
        assertEq(usdc.balanceOf(address(vault)), 10_000e6, "precondition: $10,000 idle");

        // $9,500 into moonwell is inside its 20% cap but would leave $500 idle.
        NavyVaultSRCLA.Action memory tooBig = _submitDeploy(address(moonwell), 9_500e6);
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.InsufficientIdle.selector);
        vault.executeNextActionWithProof(new bytes32[](0), tooBig);

        vm.prank(allocator);
        vault.cancelPlan();
        _deployVia(address(moonwell), 9_000e6); // leaves exactly $1,000
        assertEq(usdc.balanceOf(address(vault)), 1_000e6, "the floor is left intact");
    }

    /// @notice ...and stops binding once the proportional floor overtakes it,
    ///         so it costs no yield at scale.
    function test_theAdminReserveStopsBindingOnceNavPassesTwoHundredThousand() public {
        _configure();
        _deposit(user, 400_000e6);

        // 0.5% of $400k is $2,000, which now exceeds the $1,000 absolute floor.
        assertEq(vault.requiredIdle(), 2_000e6, "the proportional floor takes over");
    }

    /// @notice Paper 5.2: the configured order is the order actually drained.
    /// @dev Registry order is aave, compound, moonwell; the configured order is
    ///      asserted to be honoured by reversing it and observing which venue
    ///      loses its position first.
    function test_theWithdrawalOrderDeterminesWhichVenueIsDrainedFirst() public {
        _configure();
        _deposit(user, 100_000e6);

        _deployVia(address(aave), 40_000e6);
        _deployVia(address(compound), 40_000e6);

        // Reverse the order: compound must now be drained before aave.
        address[] memory reversed = new address[](3);
        reversed[0] = address(compound);
        reversed[1] = address(aave);
        reversed[2] = address(moonwell);
        vault.setWithdrawalOrder(reversed);

        vm.prank(user);
        vault.withdraw(40_000e6, user, user);

        assertEq(vault.strategyAssets(address(aave)), 40_000e6, "aave is untouched: it is second in the order");
        assertLt(vault.strategyAssets(address(compound)), 40_000e6, "compound was drained first");
    }

    /// @notice The dependency groups exist and are enumerated by
    ///         `_enforceDependencyGroupCaps`, which previously iterated an
    ///         empty list. At 100% they are declaratory, not binding.
    function test_theCommonModeDependencyGroupsDoNotBlockAHealthyDeploy() public {
        _configure();
        _deposit(user, 100_000e6);

        _deployVia(address(aave), 40_000e6);
        _deployVia(address(compound), 40_000e6);

        assertEq(vault.strategyAssets(address(aave)), 40_000e6, "100% common-mode groups must not bind on a healthy vault");
        assertEq(vault.strategyAssets(address(compound)), 40_000e6, "100% common-mode groups must not bind on a healthy vault");
    }

    /// @notice DISCOVERED INTERACTION, pinned rather than hidden.
    ///         `_enforceDependencyGroupCaps` sums RAW `strategyAssets` for the
    ///         group but compares against NAV, which is net of
    ///         `adapterRecognizedLoss`. Once a loss is recognized the raw sum
    ///         can exceed NAV, so a 100%-capped group blocks further deploys to
    ///         its members. That is arguably the right behaviour - do not add
    ///         exposure to an impaired common-mode group - but it is a
    ///         consequence of configuring the groups at all and did not exist
    ///         while the group list was empty. Recorded so the next change to
    ///         these groups sees it.
    function test_aRecognizedLossMakesTheHundredPercentGroupBlockFurtherDeploys() public {
        _configure();
        _deposit(user, 100_000e6);

        _deployVia(address(aave), 40_000e6);

        // Write aave's whole contribution off. NAV falls to $60,000 (idle) but
        // strategyAssets[aave] still reads $40,000.
        vault.recognizeLoss(address(aave), 40_000e6);
        assertEq(vault.strategyAssets(address(aave)), 40_000e6, "the raw figure is unchanged");
        assertEq(vault.totalAssets(), 60_000e6, "NAV is net of the recognized loss");

        // $24,000 is exactly compound's 40% cap of the reduced NAV, so the
        // per-adapter check passes and the GROUP check is what fires:
        // raw exposure 40,000 + 24,000 = 64,000 > NAV 60,000.
        NavyVaultSRCLA.Action memory action = _submitDeploy(address(compound), 24_000e6);
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.DependencyGroupCapExceeded.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);
    }

    /// @notice DISCOVERED DEFECT, pinned. The aggregate allowance configured
    ///         here cannot rescue a redemption when the dust-shedding venue is
    ///         the LAST one with liquidity. `_ensureIdle` tops the residual up
    ///         with a pull of exactly the shortfall, and
    ///         `_pullSynchronousLiquidity`'s PER-ADAPTER allowance is
    ///         `mulDiv(pull, maxLossBps, 10_000)` - which floors to 0 for a
    ///         2-base-unit pull at any maxLossBps below 100%. The redemption
    ///         reverts AdapterLossExceeded before the aggregate guard is
    ///         reached.
    ///
    ///         This is NOT fixable from a deploy script: no value of
    ///         `maxSynchronousLossBps` or `maxLossBps` short of 10_000 makes a
    ///         proportional allowance cover a fixed base-unit floor. It needs
    ///         an absolute dust allowance on the vault, which is a design
    ///         decision and is deliberately not made here.
    function test_aDustSheddingVenueThatIsLastWithLiquidityStillRevertsTheRedemption() public {
        _configure();
        _deposit(user, 100_000e6);

        _deployVia(address(aave), 40_000e6);
        _deployVia(address(compound), 40_000e6);

        // Every venue floors base units, so the residual pull has nowhere
        // clean to come from.
        aave.setDustShortfall(2);
        compound.setDustShortfall(2);
        moonwell.setDustShortfall(2);

        vm.prank(user);
        vm.expectRevert(NavyVaultSRCLA.AdapterLossExceeded.selector);
        vault.withdraw(50_000e6, user, user);
    }
}
