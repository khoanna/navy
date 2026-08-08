// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import {IRewardAccountant} from "../../src/interfaces/IRewardAccountant.sol";
import {IStrategyAdapter} from "../../src/interfaces/IStrategyAdapter.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";

contract StrategyInterfaceTest is Test {
    function test_actionTypehash_isStable() public pure {
        assertEq(
            VaultTypes.ACTION_TYPEHASH,
            keccak256("Action(uint256 planId,uint32 index,uint8 kind,address adapter,uint256 amount,uint256 minOut)")
        );
    }

    function test_strategyAdapterSelectors_areStable() public pure {
        assertEq(IStrategyAdapter.vault.selector, bytes4(keccak256("vault()")));
        assertEq(IStrategyAdapter.asset.selector, bytes4(keccak256("asset()")));
        assertEq(IStrategyAdapter.configurationDigest.selector, bytes4(keccak256("configurationDigest()")));
        assertEq(IStrategyAdapter.totalAssets.selector, bytes4(keccak256("totalAssets()")));
        assertEq(IStrategyAdapter.maxWithdrawable.selector, bytes4(keccak256("maxWithdrawable()")));
        assertEq(IStrategyAdapter.deposit.selector, bytes4(keccak256("deposit(uint256)")));
        assertEq(IStrategyAdapter.withdraw.selector, bytes4(keccak256("withdraw(uint256)")));
    }

    function test_rewardAccountantSelectors_areStable() public pure {
        assertEq(IRewardAccountant.recognizedRewardAssets.selector, bytes4(keccak256("recognizedRewardAssets()")));
        assertEq(IRewardAccountant.syncForShareAction.selector, bytes4(keccak256("syncForShareAction(bool)")));
    }

    function test_enums_areStable() public pure {
        assertEq(uint8(VaultTypes.ActionKind.Divest), 0);
        assertEq(uint8(VaultTypes.ActionKind.Deploy), 1);

        assertEq(uint8(VaultTypes.AdapterStatus.None), 0);
        assertEq(uint8(VaultTypes.AdapterStatus.Active), 1);
        assertEq(uint8(VaultTypes.AdapterStatus.Disabled), 2);
        assertEq(uint8(VaultTypes.AdapterStatus.Impaired), 3);
        assertEq(uint8(VaultTypes.AdapterStatus.Removed), 4);
    }
}
