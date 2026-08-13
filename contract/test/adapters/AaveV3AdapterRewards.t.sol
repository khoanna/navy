// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AaveV3Adapter} from "../../src/adapters/AaveV3Adapter.sol";
import {IAaveV3Pool} from "../../src/interfaces/IAaveV3.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockAaveRewardToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockAaveRewardsController {
    struct RewardState {
        uint256 emissionPerSecond;
        uint256 distributionEnd;
        uint256 owed;
    }

    address[] private _rewards;
    mapping(address => RewardState) public state;
    bool public forceReturn;
    uint256 public forcedReturn;

    function setReward(address reward, uint256 emissionPerSecond, uint256 distributionEnd, uint256 owed) external {
        bool found;
        for (uint256 i = 0; i < _rewards.length; ++i) {
            if (_rewards[i] == reward) found = true;
        }
        if (!found) _rewards.push(reward);
        state[reward] = RewardState(emissionPerSecond, distributionEnd, owed);
    }

    function setForcedReturn(uint256 value) external {
        forceReturn = true;
        forcedReturn = value;
    }

    function getRewardsByAsset(address) external view returns (address[] memory) {
        return _rewards;
    }

    function getRewardsData(address, address reward)
        external
        view
        returns (uint256 index, uint256 emissionPerSecond, uint256 lastUpdateTimestamp, uint256 distributionEnd)
    {
        RewardState memory rewardState = state[reward];
        return (1e27, rewardState.emissionPerSecond, block.timestamp, rewardState.distributionEnd);
    }

    function getUserRewards(address[] calldata, address, address reward) external view returns (uint256) {
        return state[reward].owed;
    }

    function claimRewards(address[] calldata, uint256 amount, address to, address reward)
        external
        returns (uint256 claimed)
    {
        RewardState storage rewardState = state[reward];
        claimed = amount < rewardState.owed ? amount : rewardState.owed;
        rewardState.owed -= claimed;
        MockAaveRewardToken(reward).mint(to, claimed);
        if (forceReturn) return forcedReturn;
    }
}

contract MockAaveAToken is ERC20 {
    address private immutable _underlying;
    address private immutable _controller;

    constructor(address underlying_, address controller_) ERC20("Aave USDC", "aUSDC") {
        _underlying = underlying_;
        _controller = controller_;
    }

    function UNDERLYING_ASSET_ADDRESS() external view returns (address) {
        return _underlying;
    }

    function getIncentivesController() external view returns (address) {
        return _controller;
    }

    function scaledBalanceOf(address user) external view returns (uint256) {
        return balanceOf(user);
    }

    function getScaledUserBalanceAndSupply(address user) external view returns (uint256, uint256) {
        return (balanceOf(user), totalSupply());
    }

    function scaledTotalSupply() external view returns (uint256) {
        return totalSupply();
    }

    function mintForTest(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockAavePool {
    address public immutable aToken;
    uint256 public configurationData;
    uint128 public accruedToTreasury;
    uint256 public normalizedIncome = 1e27;

    constructor(address aToken_) {
        aToken = aToken_;
    }

    function setReserve(uint256 configurationData_, uint128 accruedToTreasury_) external {
        configurationData = configurationData_;
        accruedToTreasury = accruedToTreasury_;
    }

    function getReserveData(address) external view returns (IAaveV3Pool.ReserveData memory data) {
        data.configuration.data = configurationData;
        data.aTokenAddress = aToken;
        data.accruedToTreasury = accruedToTreasury;
    }

    function getReserveNormalizedIncome(address) external view returns (uint256) {
        return normalizedIncome;
    }

    function supply(address, uint256, address, uint16) external {}

    function withdraw(address, uint256, address) external pure returns (uint256) {
        return 0;
    }
}

contract AaveV3AdapterRewardsTest is Test {
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    address internal vault;
    address internal recipient;
    MockAaveRewardsController internal controller;
    MockAaveAToken internal aUsdc;
    MockAavePool internal pool;
    AaveV3Adapter internal adapter;
    MockAaveRewardToken internal activeReward;
    MockAaveRewardToken internal endedReward;
    MockAaveRewardToken internal zeroEmissionReward;

    function setUp() public {
        vm.warp(1_000);
        vault = makeAddr("vault");
        recipient = makeAddr("recipient");
        controller = new MockAaveRewardsController();
        aUsdc = new MockAaveAToken(USDC, address(controller));
        pool = new MockAavePool(address(aUsdc));
        adapter = new AaveV3Adapter(vault, USDC, address(pool), address(aUsdc));
        activeReward = new MockAaveRewardToken("Active", "ACTIVE");
        endedReward = new MockAaveRewardToken("Ended", "ENDED");
        zeroEmissionReward = new MockAaveRewardToken("Zero", "ZERO");
    }

    function test_constructorDerivesControllerAndBindsItInConfigurationDigest() external view {
        assertEq(address(adapter.incentivesController()), address(controller));
        bytes32 expected =
            keccak256(abi.encode(address(pool), address(aUsdc), USDC, address(controller), block.chainid));
        assertEq(adapter.configurationDigest(), expected);
    }

    function test_rewardTokensReturnsOnlyExactActiveEmissions() external {
        controller.setReward(address(endedReward), 5e18, block.timestamp, 100e18);
        controller.setReward(address(zeroEmissionReward), 0, block.timestamp + 1 days, 100e18);
        controller.setReward(address(activeReward), 5e18, block.timestamp + 1 days, 100e18);

        address[] memory tokens = adapter.rewardTokens();

        assertEq(tokens.length, 1);
        assertEq(tokens[0], address(activeReward));
    }

    function test_claimableRewardReturnsControllerOwedAmountForActiveToken() external {
        controller.setReward(address(activeReward), 5e18, block.timestamp + 1 days, 73e18);

        assertEq(adapter.claimableReward(address(activeReward)), 73e18);
    }

    function test_claimableRewardReturnsZeroForEndedStream() external {
        controller.setReward(address(endedReward), 5e18, block.timestamp, 73e18);

        assertEq(adapter.claimableReward(address(endedReward)), 0);
    }

    function test_claimableRewardRejectsTokenNotDiscoveredByController() external {
        vm.expectRevert(AaveV3Adapter.UnsupportedRewardToken.selector);
        adapter.claimableReward(makeAddr("unsupported"));
    }

    function test_claimRewardRejectsNonVaultCaller() external {
        controller.setReward(address(activeReward), 5e18, block.timestamp + 1 days, 73e18);

        vm.expectRevert(AaveV3Adapter.NotVault.selector);
        adapter.claimReward(address(activeReward), 50e18, recipient);
    }

    function test_claimRewardRejectsTokenNotDiscoveredByController() external {
        vm.prank(vault);
        vm.expectRevert(AaveV3Adapter.UnsupportedRewardToken.selector);
        adapter.claimReward(makeAddr("unsupported"), 50e18, recipient);
    }

    function test_claimRewardBoundsClaimByMaximumAndMeasuresRecipientDelta() external {
        controller.setReward(address(activeReward), 5e18, block.timestamp + 1 days, 100e18);

        vm.prank(vault);
        uint256 claimed = adapter.claimReward(address(activeReward), 40e18, recipient);

        assertEq(claimed, 40e18);
        assertEq(activeReward.balanceOf(recipient), 40e18);
        assertEq(activeReward.balanceOf(address(adapter)), 0);
        (,, uint256 owed) = controller.state(address(activeReward));
        assertEq(owed, 60e18);
    }

    function test_claimRewardReturnsZeroWithoutCallingEndedStream() external {
        controller.setReward(address(endedReward), 5e18, block.timestamp, 100e18);

        vm.prank(vault);
        uint256 claimed = adapter.claimReward(address(endedReward), 40e18, recipient);

        assertEq(claimed, 0);
        assertEq(endedReward.balanceOf(recipient), 0);
        (,, uint256 owed) = controller.state(address(endedReward));
        assertEq(owed, 100e18);
    }

    function test_claimRewardRejectsControllerReturnThatDiffersFromRecipientDelta() external {
        controller.setReward(address(activeReward), 5e18, block.timestamp + 1 days, 100e18);
        controller.setForcedReturn(39e18);

        vm.prank(vault);
        vm.expectRevert(AaveV3Adapter.RewardClaimMismatch.selector);
        adapter.claimReward(address(activeReward), 40e18, recipient);

        assertEq(activeReward.balanceOf(recipient), 0, "claim must revert atomically");
    }

    function test_maxDeployablePreservesLiveSupplyCapAndTreasuryAccounting() external {
        pool.setReserve((uint256(6) << 48) | (uint256(1) << 56) | (uint256(1_000) << 116), 10e6);
        aUsdc.mintForTest(makeAddr("supplier"), 600e6);

        assertEq(adapter.maxDeployable(), 390e6);
    }

    function test_maxDeployableIsZeroWhenReserveInactive() external {
        pool.setReserve((uint256(6) << 48) | (uint256(1_000) << 116), 0);

        assertEq(adapter.maxDeployable(), 0);
    }
}
