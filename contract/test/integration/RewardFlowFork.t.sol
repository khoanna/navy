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
    address internal constant ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;

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
        vault.setRewardExecutor(address(new RewardExecutor(address(vault), ROUTER)));
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);
    }

    modifier withFork() {
        if (!forkCreated) {
            vm.skip(true);
            return;
        }
        _;
    }

    function test_firstPartyRewardClaimingIsExplicitlyNoop() external withFork {
        vm.prank(allocator);
        uint256 received = vault.harvest(address(aave), bytes32(uint256(1)), 0);
        assertEq(received, 0);
        assertEq(vault.recognizedRewards(), 0);
    }

    function test_unregisteredRewardSourceReverts() external withFork {
        AaveV3Adapter other = new AaveV3Adapter(address(vault), USDC, AAVE_POOL, A_USDC);
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotFound.selector);
        vault.harvest(address(other), bytes32(uint256(1)), 0);
    }
}
