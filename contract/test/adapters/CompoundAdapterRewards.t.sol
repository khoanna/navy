// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CompoundAdapter} from "../../src/adapters/CompoundAdapter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockCompoundRewardToken is ERC20 {
    address public feeSender;
    uint256 public feeBps;

    constructor() ERC20("Compound", "COMP") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFee(address sender, uint256 bps) external {
        feeSender = sender;
        feeBps = bps;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from == feeSender && to != address(0) && feeBps != 0) {
            uint256 fee = amount * feeBps / 10_000;
            super._update(from, address(0), fee);
            super._update(from, to, amount - fee);
            return;
        }
        super._update(from, to, amount);
    }
}

contract MockCompoundComet {
    struct TotalsBasic {
        uint64 baseSupplyIndex;
        uint64 baseBorrowIndex;
        uint64 trackingSupplyIndex;
        uint64 trackingBorrowIndex;
        uint104 totalSupplyBase;
        uint104 totalBorrowBase;
        uint40 lastAccrualTime;
        uint8 pauseFlags;
    }

    address public immutable baseToken;
    bool public isSupplyPaused;
    uint64 public baseTrackingSupplySpeed;
    uint104 public baseMinForRewards;
    uint256 public totalSupply;
    uint104 public totalSupplyBase;
    uint256 public accrualIncrement;
    address public extensionDelegate;
    mapping(address => uint64) public baseTrackingAccrued;

    constructor(address baseToken_) {
        baseToken = baseToken_;
    }

    function setRewardState(uint64 speed, uint104 minimum, uint256 marketSupply, uint104 marketPrincipal) external {
        baseTrackingSupplySpeed = speed;
        baseMinForRewards = minimum;
        totalSupply = marketSupply;
        totalSupplyBase = marketPrincipal;
    }

    function setExtensionDelegate(address extension) external {
        extensionDelegate = extension;
    }

    function totalsBasic() external view returns (TotalsBasic memory totals) {
        totals.totalSupplyBase = totalSupplyBase;
    }

    function setTrackingAccrued(address account, uint64 amount) external {
        baseTrackingAccrued[account] = amount;
    }

    function setAccrualIncrement(uint256 amount) external {
        accrualIncrement = amount;
    }

    function accrueAccount(address account) external {
        baseTrackingAccrued[account] += uint64(accrualIncrement);
        accrualIncrement = 0;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }

    function getUtilization() external pure returns (uint256) {
        return 0;
    }

    function getSupplyRate(uint256) external pure returns (uint64) {
        return 0;
    }

    function supply(address, uint256) external {}

    function withdrawTo(address, address, uint256) external {}
}

contract MockCompoundCometRewards {
    struct RewardConfig {
        address token;
        uint64 rescaleFactor;
        bool shouldUpscale;
        uint256 multiplier;
    }

    struct RewardOwed {
        address token;
        uint256 owed;
    }

    mapping(address => RewardConfig) internal _configs;
    mapping(address => mapping(address => uint256)) public rewardsClaimed;
    uint256 public claimCount;
    address public lastClaimComet;
    address public lastClaimSource;
    bool public lastClaimShouldAccrue;

    function setConfig(address comet, address token, uint64 rescaleFactor, bool shouldUpscale, uint256 multiplier)
        external
    {
        _configs[comet] = RewardConfig(token, rescaleFactor, shouldUpscale, multiplier);
    }

    function rewardConfig(address comet) external view returns (RewardConfig memory) {
        return _configs[comet];
    }

    function getRewardOwed(address comet, address account) external returns (RewardOwed memory) {
        MockCompoundComet(comet).accrueAccount(account);
        return RewardOwed(_configs[comet].token, _owed(comet, account));
    }

    function claim(address comet, address src, bool shouldAccrue) external {
        claimCount += 1;
        lastClaimComet = comet;
        lastClaimSource = src;
        lastClaimShouldAccrue = shouldAccrue;
        if (shouldAccrue) MockCompoundComet(comet).accrueAccount(src);
        uint256 owed = _owed(comet, src);
        if (owed == 0) return;
        rewardsClaimed[comet][src] += owed;
        IERC20(_configs[comet].token).transfer(src, owed);
    }

    function _owed(address comet, address account) internal view returns (uint256) {
        RewardConfig memory config = _configs[comet];
        uint256 accrued = MockCompoundComet(comet).baseTrackingAccrued(account);
        if (config.shouldUpscale) accrued *= config.rescaleFactor;
        else accrued /= config.rescaleFactor;
        accrued = accrued * config.multiplier / 1e18;
        uint256 claimed = rewardsClaimed[comet][account];
        return accrued > claimed ? accrued - claimed : 0;
    }
}

contract CompoundAdapterRewardsTest is Test {
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant COMP = 0x9e1028F5F1D5eDE59748FFceE5532509976840E0;
    address internal constant COMET_REWARDS = 0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1;

    address internal vault;
    address internal recipient;
    MockCompoundComet internal comet;
    MockCompoundCometRewards internal rewards;
    MockCompoundRewardToken internal comp;
    CompoundAdapter internal adapter;

    function setUp() public {
        vault = makeAddr("vault");
        recipient = makeAddr("recipient");
        comet = new MockCompoundComet(USDC);

        MockCompoundRewardToken tokenImplementation = new MockCompoundRewardToken();
        vm.etch(COMP, address(tokenImplementation).code);
        comp = MockCompoundRewardToken(COMP);

        MockCompoundCometRewards rewardsImplementation = new MockCompoundCometRewards();
        vm.etch(COMET_REWARDS, address(rewardsImplementation).code);
        rewards = MockCompoundCometRewards(COMET_REWARDS);
        rewards.setConfig(address(comet), COMP, 1e12, true, 1e18);

        comet.setRewardState(1, 100e6, 1_000e6, 1_000e6);
        adapter = new CompoundAdapter(vault, USDC, address(comet));
    }

    function test_constructorBindsOfficialRewardsAndExactConfiguredTokenInDigest() external view {
        (bool success, bytes memory result) = address(adapter).staticcall(abi.encodeWithSignature("cometRewards()"));
        assertTrue(success);
        assertEq(abi.decode(result, (address)), COMET_REWARDS);
        address extension = comet.extensionDelegate();
        bytes32 codeIdentity = keccak256(
            abi.encode(
                address(comet),
                address(comet).codehash,
                extension,
                extension.codehash,
                COMET_REWARDS,
                COMET_REWARDS.codehash
            )
        );
        bytes32 rewardRegime = keccak256(abi.encode(COMP, uint64(1e12), true, uint256(1e18), uint64(1), uint104(100e6)));
        bytes32 expected = keccak256(abi.encode(codeIdentity, USDC, rewardRegime, block.chainid));
        assertEq(adapter.configurationDigest(), expected);
    }

    function test_constructorRejectsRewardTokenMismatch() external {
        rewards.setConfig(address(comet), makeAddr("wrong-token"), 1, true, 1e18);

        vm.expectRevert(bytes4(keccak256("InvalidConfiguration()")));
        new CompoundAdapter(vault, USDC, address(comet));
    }

    function test_rewardTokensReturnsConfiguredCompOnlyWhenRewardIsActuallyClaimable() external {
        _setOwedRaw(30e6);
        comp.mint(COMET_REWARDS, 30e18);

        address[] memory tokens = adapter.rewardTokens();

        assertEq(tokens.length, 1);
        assertEq(tokens[0], COMP);
    }

    function test_rewardTokensDiscoversFreshAccruableRewardBeforeStoredOwedExists() external {
        comet.setAccrualIncrement(50e6);
        comp.mint(COMET_REWARDS, 50e18);

        address[] memory tokens = adapter.rewardTokens();
        assertEq(tokens.length, 1);
        assertEq(tokens[0], COMP);

        vm.prank(vault);
        assertEq(adapter.claimableReward(COMP), 50e18);

        vm.prank(vault);
        assertEq(adapter.claimReward(COMP, 50e18, recipient), 50e18);
        assertEq(comp.balanceOf(recipient), 50e18);
    }

    function test_rewardTokensReturnsEmptyWhenSupplySpeedIsZero() external {
        _setOwedRaw(30e6);
        comp.mint(COMET_REWARDS, 30e18);
        comet.setRewardState(0, 100e6, 1_000e6, 1_000e6);

        assertEq(adapter.rewardTokens().length, 0);
    }

    function test_rewardTokensReturnsEmptyWhenMarketSupplyIsBelowRewardsMinimum() external {
        _setOwedRaw(30e6);
        comp.mint(COMET_REWARDS, 30e18);
        comet.setRewardState(1, 100e6, 99e6, 99e6);

        assertEq(adapter.rewardTokens().length, 0);
    }

    function test_rewardTokensUsesPrincipalSupplyThresholdNotPresentValueSupply() external {
        _setOwedRaw(30e6);
        comp.mint(COMET_REWARDS, 30e18);
        comet.setRewardState(1, 100e6, 101e6, 99e6);

        assertEq(adapter.rewardTokens().length, 0);
    }

    function test_rewardTokensReturnsEmptyWhenRewardsFundingIsInsufficient() external {
        _setOwedRaw(30e6);
        comp.mint(COMET_REWARDS, 30e18 - 1);

        assertEq(adapter.rewardTokens().length, 0);
    }

    function test_rewardTokensReturnsEmptyForFreshAccrualWhenRewardsAreUnfunded() external {
        comet.setAccrualIncrement(30e6);

        assertEq(adapter.rewardTokens().length, 0);
    }

    function test_rewardTokensReturnsEmptyWhenLiveRewardConfigurationDrifts() external {
        comp.mint(COMET_REWARDS, 30e18);
        rewards.setConfig(address(comet), COMP, 1e12, true, 9e17);

        assertEq(adapter.rewardTokens().length, 0);
    }

    function test_claimableRewardAccruesStateAndReturnsExactFundedOwedAmount() external {
        comet.setAccrualIncrement(73e6);
        comp.mint(COMET_REWARDS, 73e18);

        vm.prank(vault);
        assertEq(adapter.claimableReward(COMP), 73e18);
        assertEq(comet.baseTrackingAccrued(address(adapter)), 73e6);
    }

    function test_claimableRewardReportsZeroForInactiveOrUnfundedRewards() external {
        _setOwedRaw(30e6);
        comet.setRewardState(0, 100e6, 1_000e6, 1_000e6);
        vm.prank(vault);
        assertEq(adapter.claimableReward(COMP), 0);

        comet.setRewardState(1, 100e6, 1_000e6, 1_000e6);
        comp.mint(COMET_REWARDS, 30e18 - 1);
        vm.prank(vault);
        assertEq(adapter.claimableReward(COMP), 0);
    }

    function test_claimableRewardRejectsUnsupportedToken() external {
        vm.prank(vault);
        vm.expectRevert(CompoundAdapter.UnsupportedRewardToken.selector);
        adapter.claimableReward(makeAddr("unsupported"));
    }

    function test_claimableRewardRejectsNonVaultCallerBecauseItAccruesState() external {
        vm.expectRevert(CompoundAdapter.NotVault.selector);
        adapter.claimableReward(COMP);
    }

    function test_downscaleAndNonUnitMultiplierUseOfficialRewardMath() external {
        rewards.setConfig(address(comet), COMP, 10, false, 5e17);
        CompoundAdapter scaledAdapter = new CompoundAdapter(vault, USDC, address(comet));
        comet.setTrackingAccrued(address(scaledAdapter), 100e6);
        comp.mint(COMET_REWARDS, 5e6);

        address[] memory tokens = scaledAdapter.rewardTokens();
        assertEq(tokens.length, 1);
        assertEq(tokens[0], COMP);

        vm.prank(vault);
        assertEq(scaledAdapter.claimableReward(COMP), 5e6);

        vm.prank(vault);
        assertEq(scaledAdapter.claimReward(COMP, 5e6, recipient), 5e6);
        assertEq(comp.balanceOf(recipient), 5e6);
    }

    function test_claimRewardRejectsNonVaultCaller() external {
        _setOwedRaw(50e6);
        comp.mint(COMET_REWARDS, 50e18);

        vm.expectRevert(CompoundAdapter.NotVault.selector);
        adapter.claimReward(COMP, 50e18, recipient);
    }

    function test_claimRewardRejectsZeroRecipient() external {
        vm.prank(vault);
        vm.expectRevert(bytes4(keccak256("InvalidRecipient()")));
        adapter.claimReward(COMP, 50e18, address(0));
    }

    function test_claimRewardUsesOfficialClaimAndHonorsMaximumWithoutStrandingRemainder() external {
        _setOwedRaw(100e6);
        comp.mint(COMET_REWARDS, 100e18);

        vm.prank(vault);
        uint256 first = adapter.claimReward(COMP, 40e18, recipient);

        assertEq(first, 40e18);
        assertEq(comp.balanceOf(recipient), 40e18);
        assertEq(comp.balanceOf(address(adapter)), 60e18);
        assertEq(_pendingRewards(), 60e18);
        assertEq(rewards.claimCount(), 1);
        assertEq(rewards.lastClaimComet(), address(comet));
        assertEq(rewards.lastClaimSource(), address(adapter));
        assertTrue(rewards.lastClaimShouldAccrue());

        vm.prank(vault);
        uint256 second = adapter.claimReward(COMP, 60e18, recipient);

        assertEq(second, 60e18);
        assertEq(comp.balanceOf(recipient), 100e18);
        assertEq(comp.balanceOf(address(adapter)), 0);
        assertEq(_pendingRewards(), 0);
        assertEq(rewards.claimCount(), 1, "pending rewards should be paid without another upstream claim");
    }

    function test_pendingRemainderDoesNotStrandRewardsAccruedAfterFirstUpstreamClaim() external {
        _setOwedRaw(100e6);
        comp.mint(COMET_REWARDS, 100e18);

        vm.prank(vault);
        assertEq(adapter.claimReward(COMP, 40e18, recipient), 40e18);
        assertEq(_pendingRewards(), 60e18);

        _setOwedRaw(150e6);
        comp.mint(COMET_REWARDS, 50e18);

        vm.prank(vault);
        assertEq(adapter.claimReward(COMP, 80e18, recipient), 60e18, "first drain the owned pending balance");
        vm.prank(vault);
        assertEq(adapter.claimReward(COMP, 80e18, recipient), 50e18, "then claim newly accrued rewards");

        assertEq(comp.balanceOf(recipient), 150e18);
        assertEq(_pendingRewards(), 0);
        assertEq(rewards.claimCount(), 2);
    }

    function test_claimRewardMeasuresExactRecipientDeltaAndDoesNotExpropriatePriorBalance() external {
        comp.mint(address(adapter), 777e18);
        _setOwedRaw(50e6);
        comp.mint(COMET_REWARDS, 50e18);

        vm.prank(vault);
        uint256 claimed = adapter.claimReward(COMP, 50e18, recipient);

        assertEq(claimed, 50e18);
        assertEq(comp.balanceOf(recipient), 50e18);
        assertEq(comp.balanceOf(address(adapter)), 777e18);
        assertEq(_pendingRewards(), 0);
    }

    function test_claimRewardReturnsZeroWhenNoClaimableReward() external {
        vm.prank(vault);
        uint256 claimed = adapter.claimReward(COMP, 50e18, recipient);

        assertEq(claimed, 0);
        assertEq(rewards.claimCount(), 0);
    }

    function test_claimRewardRevertsAtomicallyWhenUpstreamTransferDeltaDoesNotMatchOwed() external {
        _setOwedRaw(50e6);
        comp.mint(COMET_REWARDS, 50e18);
        comp.setFee(COMET_REWARDS, 100);

        vm.prank(vault);
        vm.expectRevert(bytes4(keccak256("RewardClaimMismatch()")));
        adapter.claimReward(COMP, 50e18, recipient);

        assertEq(comp.balanceOf(COMET_REWARDS), 50e18);
        assertEq(comp.balanceOf(address(adapter)), 0);
        assertEq(rewards.rewardsClaimed(address(comet), address(adapter)), 0);
    }

    function test_configurationDigestChangesWithLiveRewardRegimeAndAccessibleCodeIdentity() external {
        bytes32 initial = adapter.configurationDigest();

        comet.setRewardState(2, 100e6, 1_000e6, 1_000e6);
        assertNotEq(adapter.configurationDigest(), initial, "speed drift must invalidate plans");

        comet.setRewardState(1, 101e6, 1_000e6, 1_000e6);
        assertNotEq(adapter.configurationDigest(), initial, "minimum drift must invalidate plans");

        comet.setRewardState(1, 100e6, 1_000e6, 1_000e6);
        rewards.setConfig(address(comet), COMP, 1e12, true, 9e17);
        assertNotEq(adapter.configurationDigest(), initial, "reward config drift must invalidate plans");

        rewards.setConfig(address(comet), COMP, 1e12, true, 1e18);
        comet.setExtensionDelegate(address(new MockCompoundRewardToken()));
        assertNotEq(adapter.configurationDigest(), initial, "extension identity drift must invalidate plans");
    }

    function _setOwedRaw(uint64 rawAmount) internal {
        comet.setTrackingAccrued(address(adapter), rawAmount);
    }

    function _pendingRewards() internal view returns (uint256 pending) {
        (bool success, bytes memory result) = address(adapter).staticcall(abi.encodeWithSignature("pendingRewards()"));
        assertTrue(success);
        pending = abi.decode(result, (uint256));
    }
}
