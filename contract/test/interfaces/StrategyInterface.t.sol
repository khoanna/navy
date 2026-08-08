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

    function test_adapterConfigLayout_isStable() public pure {
        VaultTypes.AdapterConfig memory config = VaultTypes.AdapterConfig({
            status: VaultTypes.AdapterStatus.Impaired,
            capBps: 1_111,
            absoluteCap: 2_222,
            maxLossBps: 3_333,
            accountingCap: 4_444
        });

        bytes memory encoded = abi.encode(config);

        assertEq(encoded.length, 5 * 32);
        assertEq(
            keccak256(encoded),
            keccak256(
                abi.encode(
                    uint8(VaultTypes.AdapterStatus.Impaired),
                    uint16(1_111),
                    uint256(2_222),
                    uint16(3_333),
                    uint256(4_444)
                )
            )
        );
    }

    function test_planHeaderLayout_isStable() public pure {
        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: 11,
            policyVersion: 22,
            createdAt: 33,
            expiresAt: 44,
            actionCount: 55,
            snapshotBlockNumber: 66,
            snapshotHash: bytes32(uint256(77)),
            decisionHash: bytes32(uint256(88)),
            configurationDigest: bytes32(uint256(99)),
            reserve: 111,
            minFinalAssets: 222,
            maxRecognizedLoss: 333,
            turnoverLimit: 444
        });

        bytes memory encoded = abi.encode(header);

        assertEq(encoded.length, 13 * 32);
        assertEq(
            keccak256(encoded),
            keccak256(
                abi.encode(
                    uint256(11),
                    uint64(22),
                    uint64(33),
                    uint64(44),
                    uint32(55),
                    uint256(66),
                    bytes32(uint256(77)),
                    bytes32(uint256(88)),
                    bytes32(uint256(99)),
                    uint256(111),
                    uint256(222),
                    uint256(333),
                    uint256(444)
                )
            )
        );
    }
}
