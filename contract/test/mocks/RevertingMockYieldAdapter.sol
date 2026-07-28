// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "../../src/interfaces/IYieldAdapter.sol";

/// @dev Test double whose `totalAssets` (and state-changing methods) always revert, simulating an
/// underlying market that has been paused/bricked. Used to prove the vault isolates a bad adapter.
contract RevertingMockYieldAdapter is IYieldAdapter {
    address public immutable assetToken;

    constructor(address _asset) {
        assetToken = _asset;
    }

    function deposit(uint256) external pure {
        revert("boom");
    }

    function withdraw(uint256, address) external pure {
        revert("boom");
    }

    function totalAssets() external pure returns (uint256) {
        revert("boom");
    }

    function supplyRatePerYear() external pure returns (uint256) {
        return 0;
    }

    function asset() external view returns (address) {
        return assetToken;
    }
}
