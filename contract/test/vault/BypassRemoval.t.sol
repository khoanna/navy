// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {MockERC20} from "../../src/MockERC20.sol";

/// @dev Paper §9.5 requires every plan action to pass the configuration-digest
///      recheck, the plan risk limits, turnover accounting and plan completion.
///      Only executeNextActionWithProof does that, so the weaker paths must not
///      exist at all — a disabled-but-present path is one upgrade away from live.
///
///      A selector-absence check done by calling `address(vault).call(...)` and
///      inspecting `ok`/returndata is unsound here: `abi.encodeWithSignature`
///      with no arguments produces only the 4-byte selector with no argument
///      words behind it. If the selector dispatch matches (function EXISTS),
///      the generated calldata-decoding step reverts on the truncated
///      calldata. If the selector dispatch does NOT match (function ABSENT)
///      and there is no fallback, the call also reverts. Both cases yield
///      `ok == false` and empty/short returndata, so that approach cannot
///      distinguish "selector exists but decoding failed" from "selector was
///      never in the dispatcher" — it would pass identically before and
///      after the deletion in this task. Instead we scan the vault's
///      deployed runtime bytecode directly for the 4-byte selector, which a
///      standard solc dispatcher embeds as literal PUSH4 immediates, and we
///      prove the scan itself is meaningful with a positive control
///      (a selector we know still exists).
contract BypassRemovalTest is Test {
    NavyVaultSRCLA internal vault;
    MockERC20 internal usdc;

    // cast sig "executeAction(uint256,uint32,uint8,address,uint256,uint256,bytes32,bytes32[])"
    bytes4 internal constant EXECUTE_ACTION_SEL = 0x38ede2f0;
    // cast sig "executePlan(bytes32,bytes32,uint64,(uint256,uint32,uint8,address,uint256,uint256,bytes32)[])"
    bytes4 internal constant EXECUTE_PLAN_SEL = 0x5ab3a21c;
    // cast sig "executeNextAction()"
    bytes4 internal constant EXECUTE_NEXT_ACTION_SEL = 0xbfe2e236;
    // cast sig "harvest(address,bytes32,uint256)" (legacy 3-arg overload)
    bytes4 internal constant LEGACY_HARVEST_SEL = 0x41ee7a93;
    // cast sig "executeNextActionWithProof(bytes32[],(uint256,uint32,uint8,address,uint256,uint256,bytes32))"
    bytes4 internal constant EXECUTE_NEXT_ACTION_WITH_PROOF_SEL = 0xb33e940c;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vault = new NavyVaultSRCLA(usdc);
    }

    /// @dev Scans the vault's deployed runtime bytecode for a literal 4-byte
    ///      selector match. A standard solc function dispatcher embeds each
    ///      selector as a PUSH4 immediate, so a genuinely removed function
    ///      leaves no occurrence of its selector bytes anywhere in the code.
    function _codeContainsSelector(bytes4 sel) internal view returns (bool) {
        bytes memory code = address(vault).code;
        for (uint256 i = 0; i + 4 <= code.length; i++) {
            if (code[i] == sel[0] && code[i + 1] == sel[1] && code[i + 2] == sel[2] && code[i + 3] == sel[3]) {
                return true;
            }
        }
        return false;
    }

    function test_positiveControl_survivingSelectorIsFoundByScan() public view {
        // Proves the scan itself is meaningful: if it always returned false,
        // every "absent" assertion below would pass vacuously.
        assertTrue(
            _codeContainsSelector(EXECUTE_NEXT_ACTION_WITH_PROOF_SEL),
            "sanctioned executeNextActionWithProof selector must be found in bytecode"
        );
    }

    function test_weakExecuteActionSelectorIsGone() public view {
        assertFalse(_codeContainsSelector(EXECUTE_ACTION_SEL), "weak executeAction selector must not be in bytecode");
    }

    function test_legacyExecutePlanSelectorIsGone() public view {
        assertFalse(
            _codeContainsSelector(EXECUTE_PLAN_SEL), "legacy executePlan selector must not be in bytecode"
        );
    }

    function test_legacyExecuteNextActionSelectorIsGone() public view {
        assertFalse(
            _codeContainsSelector(EXECUTE_NEXT_ACTION_SEL), "legacy executeNextAction selector must not be in bytecode"
        );
    }

    function test_legacyHarvestSelectorIsGone() public view {
        assertFalse(
            _codeContainsSelector(LEGACY_HARVEST_SEL), "legacy 3-arg harvest selector must not be in bytecode"
        );
    }

    function test_sanctionedProofPathStillExists() public {
        // Belt-and-suspenders behavioural check alongside the bytecode scan:
        // a call that reverts for a POLICY reason (no active plan) rather
        // than for selector absence still returns nonzero returndata (the
        // custom error's selector + any args), whereas a truncated call to a
        // genuinely absent selector reverts with zero returndata.
        (bool ok, bytes memory ret) = address(vault).call(
            abi.encodeWithSignature(
                "executeNextActionWithProof(bytes32[],(uint256,uint32,uint8,address,uint256,uint256,bytes32))",
                new bytes32[](0),
                NavyVaultSRCLA.Action({
                    planId: 0,
                    index: 0,
                    kind: NavyVaultSRCLA.ActionKind.Deploy,
                    adapter: address(0),
                    amount: 0,
                    minOut: 0,
                    dataHash: bytes32(0)
                })
            )
        );
        assertFalse(ok, "call should revert (no active plan)");
        assertGt(ret.length, 0, "should revert with data, proving the function exists and decoded its calldata");
    }
}
