// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MoonwellAdapter} from "../../src/adapters/MoonwellAdapter.sol";

contract MockMoonwellToken is ERC20 {
    uint8 private immutable _tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract MockMoonwellMToken is ERC20 {
    address public immutable underlying;
    address public immutable comptroller;
    address public immutable interestRateModel;
    uint256 public exchangeRateStored = 1e18;
    uint256 public totalBorrows;
    uint256 public totalReserves;
    uint256 public reserveFactorMantissa;
    uint256 public accrualBlockTimestamp;

    constructor(address underlying_, address comptroller_, address interestRateModel_) ERC20("Moonwell USDC", "mUSDC") {
        underlying = underlying_;
        comptroller = comptroller_;
        interestRateModel = interestRateModel_;
        accrualBlockTimestamp = block.timestamp;
    }

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function mint(uint256 amount) external returns (uint256) {
        require(IERC20(underlying).transferFrom(msg.sender, address(this), amount));
        _mint(msg.sender, amount);
        return 0;
    }

    function redeem(uint256 amount) external returns (uint256) {
        _burn(msg.sender, amount);
        require(IERC20(underlying).transfer(msg.sender, amount));
        return 0;
    }

    function redeemUnderlying(uint256 amount) external returns (uint256) {
        _burn(msg.sender, amount);
        require(IERC20(underlying).transfer(msg.sender, amount));
        return 0;
    }

    function getCash() external view returns (uint256) {
        return IERC20(underlying).balanceOf(address(this));
    }

    function exchangeRateCurrent() external view returns (uint256) {
        return exchangeRateStored;
    }

    function borrowRatePerTimestamp() external pure returns (uint256) {
        return 0;
    }
}

contract MockMoonwellDistributor {
    struct MarketConfig {
        address owner;
        address emissionToken;
        uint256 endTime;
        uint224 supplyGlobalIndex;
        uint32 supplyGlobalTimestamp;
        uint224 borrowGlobalIndex;
        uint32 borrowGlobalTimestamp;
        uint256 supplyEmissionsPerSec;
        uint256 borrowEmissionsPerSec;
    }

    struct RewardInfo {
        address emissionToken;
        uint256 totalAmount;
        uint256 supplySide;
        uint256 borrowSide;
    }

    address public immutable comptroller;
    bool public paused;
    MarketConfig[] private _configs;
    RewardInfo[] private _rewards;

    constructor(address comptroller_) {
        comptroller = comptroller_;
    }

    function setPaused(bool paused_) external {
        paused = paused_;
    }

    function addStream(address token, uint256 supplySpeed, uint256 endTime, uint256 supplyOutstanding) external {
        _configs.push(
            MarketConfig({
                owner: address(this),
                emissionToken: token,
                endTime: endTime,
                supplyGlobalIndex: 1e36,
                supplyGlobalTimestamp: uint32(block.timestamp),
                borrowGlobalIndex: 1e36,
                borrowGlobalTimestamp: uint32(block.timestamp),
                supplyEmissionsPerSec: supplySpeed,
                borrowEmissionsPerSec: 0
            })
        );
        _rewards.push(
            RewardInfo({
                emissionToken: token, totalAmount: supplyOutstanding, supplySide: supplyOutstanding, borrowSide: 0
            })
        );
    }

    function setSupplyOutstanding(address token, uint256 amount) external {
        for (uint256 i = 0; i < _rewards.length; ++i) {
            if (_rewards[i].emissionToken == token) {
                _rewards[i].totalAmount = amount;
                _rewards[i].supplySide = amount;
            }
        }
    }

    function getAllMarketConfigs(address) external view returns (MarketConfig[] memory) {
        return _configs;
    }

    function getOutstandingRewardsForUser(address, address) external view returns (RewardInfo[] memory) {
        return _rewards;
    }

    function claim(address holder) external {
        for (uint256 i = 0; i < _rewards.length; ++i) {
            uint256 amount = _rewards[i].supplySide;
            address token = _rewards[i].emissionToken;
            if (amount == 0 || _seenEarlier(token, i)) continue;

            uint256 aggregate = amount;
            _rewards[i].totalAmount = 0;
            _rewards[i].supplySide = 0;
            for (uint256 j = i + 1; j < _rewards.length; ++j) {
                if (_rewards[j].emissionToken == token) {
                    aggregate += _rewards[j].supplySide;
                    _rewards[j].totalAmount = 0;
                    _rewards[j].supplySide = 0;
                }
            }
            require(IERC20(token).transfer(holder, aggregate));
        }
    }

    function _seenEarlier(address token, uint256 beforeIndex) private view returns (bool) {
        for (uint256 i = 0; i < beforeIndex; ++i) {
            if (_rewards[i].emissionToken == token) return true;
        }
        return false;
    }
}

contract MockMoonwellComptroller {
    address public rewardDistributor;
    uint256 public claimCalls;

    constructor() {}

    function setRewardDistributor(address distributor) external {
        rewardDistributor = distributor;
    }

    function claimReward(address holder, address[] memory) external {
        ++claimCalls;
        MockMoonwellDistributor(rewardDistributor).claim(holder);
    }

    function markets(address) external pure returns (bool, uint256) {
        return (true, 0);
    }

    function mintGuardianPaused(address) external pure returns (bool) {
        return false;
    }

    function supplyCaps(address) external pure returns (uint256) {
        return 0;
    }
}

contract MockMoonwellInterestModel {
    function getSupplyRate(uint256, uint256, uint256, uint256) external pure returns (uint256) {
        return 0;
    }
}

contract MoonwellAdapterRewardsTest is Test {
    uint256 private constant ENDED = 1_700_000_000;

    address private vault = makeAddr("vault");
    address private allocator = makeAddr("allocator");
    address private recipient = makeAddr("recipient");

    MockMoonwellToken private usdc;
    MockMoonwellToken private wormholeWell;
    MockMoonwellToken private well;
    MockMoonwellComptroller private comptroller;
    MockMoonwellDistributor private distributor;
    MockMoonwellInterestModel private interestModel;
    MockMoonwellMToken private mUsdc;
    MoonwellAdapter private adapter;

    function setUp() external {
        vm.warp(1_800_000_000);
        usdc = new MockMoonwellToken("USD Coin", "USDC", 6);
        wormholeWell = new MockMoonwellToken("Wormhole WELL", "xWELL", 18);
        well = new MockMoonwellToken("Moonwell", "WELL", 18);
        comptroller = new MockMoonwellComptroller();
        distributor = new MockMoonwellDistributor(address(comptroller));
        comptroller.setRewardDistributor(address(distributor));
        interestModel = new MockMoonwellInterestModel();
        mUsdc = new MockMoonwellMToken(address(usdc), address(comptroller), address(interestModel));

        distributor.addStream(address(wormholeWell), 0, ENDED, 5e18);
        distributor.addStream(address(usdc), 24_801, ENDED, 10e6);
        distributor.addStream(address(well), 0.5e18, block.timestamp + 1 days, 100e18);
        wormholeWell.mint(address(distributor), 5e18);
        usdc.mint(address(distributor), 10e6);
        well.mint(address(distributor), 100e18);

        adapter =
            new MoonwellAdapter(vault, address(usdc), address(mUsdc), address(comptroller), address(interestModel));
    }

    function test_rewardTokensAdvertisesOnlyUniqueActiveFundedStreamWithOutstandingRewards() external view {
        address[] memory tokens = adapter.rewardTokens();
        assertEq(tokens.length, 1);
        assertEq(tokens[0], address(well));
    }

    function test_rewardTokensRequiresPositiveOutstandingAndFundingAndUnpausedDistributor() external {
        distributor.setSupplyOutstanding(address(well), 0);
        assertEq(adapter.rewardTokens().length, 0, "zero outstanding must not be advertised");

        distributor.setSupplyOutstanding(address(well), 100e18);
        vm.prank(address(distributor));
        well.transfer(makeAddr("fundingSink"), 100e18);
        assertEq(adapter.rewardTokens().length, 0, "unfunded rewards must not be advertised");

        well.mint(address(distributor), 100e18);
        distributor.setPaused(true);
        assertEq(adapter.rewardTokens().length, 0, "paused rewards must not be advertised");
    }

    function test_rewardTokensDeduplicatesDuplicateTokenConfigsAndOutstandingRows() external {
        distributor.addStream(address(well), 1e18, block.timestamp + 2 days, 25e18);
        well.mint(address(distributor), 25e18);

        address[] memory tokens = adapter.rewardTokens();
        assertEq(tokens.length, 1);
        assertEq(tokens[0], address(well));
        vm.prank(vault);
        assertEq(adapter.claimableReward(address(well)), 125e18);
    }

    function test_claimRewardMeasuresAllTokenDeltasBoundsRequestedTokenAndQuarantinesOthers() external {
        well.mint(address(adapter), 25e18); // unrelated pre-existing balance

        vm.prank(vault);
        uint256 claimed = adapter.claimReward(address(well), 40e18, recipient);

        assertEq(claimed, 40e18);
        assertEq(well.balanceOf(recipient), 40e18);
        assertEq(well.balanceOf(address(adapter)), 85e18, "pre-existing plus bounded remainder stays owned");
        assertEq(wormholeWell.balanceOf(address(adapter)), 5e18, "ended xWELL delta is quarantined");
        assertEq(usdc.balanceOf(address(adapter)), 10e6, "ended USDC delta is quarantined");
        assertEq(adapter.pendingRewards(address(well)), 60e18, "only newly claimed WELL remainder is tracked");
    }

    function test_claimRewardDrainsBoundedRemainderBeforeCallingUpstreamAgain() external {
        vm.prank(vault);
        adapter.claimReward(address(well), 40e18, recipient);
        assertEq(comptroller.claimCalls(), 1);

        vm.prank(vault);
        assertEq(adapter.claimReward(address(well), 100e18, recipient), 60e18);
        assertEq(comptroller.claimCalls(), 1, "bounded remainder must not trigger a second market-wide claim");
        assertEq(well.balanceOf(recipient), 100e18);
        assertEq(adapter.pendingRewards(address(well)), 0);
    }

    function test_claimRewardDoesNotExpropriatePreExistingRequestedTokenBalance() external {
        well.mint(address(adapter), 77e18);
        vm.prank(vault);
        assertEq(adapter.claimReward(address(well), type(uint256).max, recipient), 100e18);
        assertEq(well.balanceOf(address(adapter)), 77e18, "unrelated WELL must remain untouched");
    }

    function test_claimRewardRejectsNonVaultZeroRecipientAndUnknownToken() external {
        vm.expectRevert(MoonwellAdapter.NotVault.selector);
        adapter.claimReward(address(well), 1, recipient);

        vm.prank(vault);
        vm.expectRevert();
        adapter.claimReward(address(well), 1, address(0));

        vm.prank(vault);
        vm.expectRevert(MoonwellAdapter.UnsupportedRewardToken.selector);
        adapter.claimReward(makeAddr("unknown"), 1, recipient);
    }

    function test_rewardOperationsFailClosedAfterDistributorConfigurationDrift() external {
        bytes32 beforeDigest = adapter.configurationDigest();
        MockMoonwellDistributor replacement = new MockMoonwellDistributor(address(comptroller));
        comptroller.setRewardDistributor(address(replacement));

        assertTrue(adapter.configurationDigest() != beforeDigest);
        assertEq(adapter.rewardTokens().length, 0);
        vm.prank(vault);
        assertEq(adapter.claimableReward(address(well)), 0);
        vm.prank(vault);
        assertEq(adapter.claimReward(address(well), 100e18, recipient), 0);
    }

    function test_recoverUnsupportedRewardIsAdminOnlyRejectsZeroRecipientAndProtectsPrincipal() external {
        wormholeWell.mint(address(adapter), 9e18);
        deal(address(mUsdc), address(adapter), 1e8);
        usdc.mint(address(adapter), 1e6);

        vm.prank(allocator);
        vm.expectRevert(MoonwellAdapter.NotAdmin.selector);
        adapter.recoverUnsupportedReward(address(wormholeWell), recipient, 1e18);

        vm.expectRevert(MoonwellAdapter.InvalidRecipient.selector);
        adapter.recoverUnsupportedReward(address(wormholeWell), address(0), 1e18);

        vm.expectRevert(MoonwellAdapter.ProtectedRecoveryToken.selector);
        adapter.recoverUnsupportedReward(address(usdc), recipient, 1);

        vm.expectRevert(MoonwellAdapter.ProtectedRecoveryToken.selector);
        adapter.recoverUnsupportedReward(address(mUsdc), recipient, 1);

        adapter.recoverUnsupportedReward(address(wormholeWell), recipient, 9e18);
        assertEq(wormholeWell.balanceOf(recipient), 9e18);
    }

    function test_recoveryCannotConsumeTrackedBoundedRemainder() external {
        vm.prank(vault);
        adapter.claimReward(address(well), 40e18, recipient);

        vm.expectRevert(MoonwellAdapter.ProtectedRewardBalance.selector);
        adapter.recoverUnsupportedReward(address(well), recipient, 61e18);
    }
}
