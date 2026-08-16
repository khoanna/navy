// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RewardExecutor} from "../../src/reward/RewardExecutor.sol";
import {IRewardExecutor} from "../../src/interfaces/IRewardExecutor.sol";

/// @title RewardExecutorForkTest - Fork tests for RewardExecutor on Base
/// @notice Tests RewardExecutor against real Base chain state
contract RewardExecutorForkTest is Test {
    // Base Mainnet addresses
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant SWAP_ROUTER02 = 0x2626664C2603336E57b271C5c0b26F42121e30D0;
    address constant UNISWAP_V3_FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address constant SEQUENCER_FEED = 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7;
    uint256 constant RECOVERY_GRACE_PERIOD = 3600;

    // Sample token addresses on Base
    address constant CBTC = 0x2ae3F1eC7F1f5012cFeaB0185BFc9AaA8FCCE060;
    address constant DAI = 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    // Chainlink feeds (would need real addresses for production)
    // For testing, we'll use the FeedRegistry or specific pair feeds

    function setUp() public {
        // Fork Base mainnet
        vm.createSelectFork("https://mainnet.base.org");
    }

    function test_fork_rewardExecutorDeployment() public {
        // Deploy a new RewardExecutor
        address vault = address(0x123); // Mock vault address for testing

        RewardExecutor executor = new RewardExecutor({
            _vault: vault,
            _admin: msg.sender,
            _canonicalUsdc: BASE_USDC,
            _factory: UNISWAP_V3_FACTORY,
            _swapRouter02: SWAP_ROUTER02,
            _sequencerFeed: SEQUENCER_FEED,
            _recoveryGrace: RECOVERY_GRACE_PERIOD
        });

        assertEq(executor.vault(), vault);
        assertEq(executor.canonicalUsdc(), BASE_USDC);
        assertEq(executor.factory(), UNISWAP_V3_FACTORY);
    }

    function test_fork_usdcDecimals() public {
        // Verify USDC has 6 decimals
        assertEq(IERC20Metadata(BASE_USDC).decimals(), 6, "USDC should have 6 decimals");
    }

    function test_fork_uniswapFactoryHasPools() public {
        // Check that the Uniswap factory exists and has pools
        // CBTC/USDC 0.01% pool
        address pool001 = IUniswapV3Factory(UNISWAP_V3_FACTORY).getPool(CBTC, BASE_USDC, 100);
        console.log("CBTC/USDC 0.01% pool:", pool001);

        // DAI/USDC 0.01% pool
        address daiUsdcPool = IUniswapV3Factory(UNISWAP_V3_FACTORY).getPool(DAI, BASE_USDC, 100);
        console.log("DAI/USDC 0.01% pool:", daiUsdcPool);

        // WETH/USDC 0.05% pool
        address wethUsdcPool = IUniswapV3Factory(UNISWAP_V3_FACTORY).getPool(WETH, BASE_USDC, 500);
        console.log("WETH/USDC 0.05% pool:", wethUsdcPool);

        // At least one pool should exist
        assertTrue(pool001 != address(0) || daiUsdcPool != address(0) || wethUsdcPool != address(0),
                   "At least one pool should exist");
    }

    function test_fork_sequencerFeedExists() public {
        // Skip if sequencer feed is not available
        if (SEQUENCER_FEED.code.length == 0) {
            console.log("Sequencer feed not available at this address");
            return;
        }

        // Verify sequencer feed returns valid data
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            IChainlinkFeed(SEQUENCER_FEED).latestRoundData();

        console.log("Sequencer round:", roundId);
        console.log("Sequencer answer:", answer);
        console.log("Started at:", startedAt);
        console.log("Updated at:", updatedAt);

        // Answer should be 0 (UP) or 1 (DOWN)
        assertTrue(answer == 0 || answer == 1, "Sequencer answer should be 0 or 1");
        assertTrue(updatedAt > 0, "Updated at should be non-zero");
    }
}

// Minimal interfaces for fork testing
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IChainlinkFeed {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}
