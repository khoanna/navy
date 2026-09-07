// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "src/NavyVaultSRCLA.sol";
import {AaveV3Adapter} from "src/adapters/AaveV3Adapter.sol";
import {RewardExecutor} from "src/reward/RewardExecutor.sol";

/// @notice Live Base assertions for the intentionally disabled first-party reward flow.
contract RewardFlowForkTest is Test {
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address internal constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    address internal constant SWAP_ROUTER_02 = 0x2626664C2603336E57b271C5c0b26F42121e30D0;
    address internal constant FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address internal constant SEQUENCER_FEED = 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7;

    NavyVaultSRCLA internal vault;
    AaveV3Adapter internal aave;
    address internal allocator;
    bool internal forkCreated;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        forkCreated = true;
        vm.createSelectFork(rpc);
        allocator = makeAddr("allocator");
        vault = new NavyVaultSRCLA(IERC20(USDC));
        aave = new AaveV3Adapter(address(vault), USDC, AAVE_POOL, A_USDC);
        vault.registerAdapter(address(aave), 10_000, 100, "Aave");
        vault.setRewardExecutor(address(new RewardExecutor({
            _vault: address(vault),
            _admin: address(this),
            _canonicalUsdc: USDC,
            _factory: FACTORY,
            _swapRouter02: SWAP_ROUTER_02,
            _sequencerFeed: SEQUENCER_FEED,
            _recoveryGrace: 3600
        })));
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);
    }

    modifier withFork() {
        if (!forkCreated) {
            vm.skip(true);
            return;
        }
        _;
    }

    // test_firstPartyRewardClaimingIsExplicitlyNoop deleted: it called the
    // legacy 3-arg harvest(address,bytes32,uint256) — deleted per paper
    // §9.5 — to show that an adapter with zero configured reward tokens is
    // a safe no-op with no token argument required. The remaining atomic
    // harvest(address,address,uint256,bytes32,uint256,uint256) always
    // requires naming a token, so "harvest with nothing configured, no
    // token needed" has no equivalent call to port to.

    function test_unregisteredRewardSourceReverts() external withFork {
        AaveV3Adapter other = new AaveV3Adapter(address(vault), USDC, AAVE_POOL, A_USDC);
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotFound.selector);
        vault.harvest(address(other), address(0), 0, bytes32(uint256(1)), 0, type(uint256).max);
    }
}
