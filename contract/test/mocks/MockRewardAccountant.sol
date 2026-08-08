// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRewardAccountant} from "../../src/interfaces/IRewardAccountant.sol";

contract MockRewardAccountant is IRewardAccountant {
    uint256 public recognized;
    bool public revertRecognizedRead;
    bool public revertSync;
    bool public lastIssuingShares;
    uint256 public syncCallCount;

    function setRecognized(uint256 recognized_) external {
        recognized = recognized_;
    }

    function setRevertRecognizedRead(bool shouldRevert) external {
        revertRecognizedRead = shouldRevert;
    }

    function setRevertSync(bool shouldRevert) external {
        revertSync = shouldRevert;
    }

    function recognizedRewardAssets() external view returns (uint256) {
        if (revertRecognizedRead) revert("mock recognized revert");
        return recognized;
    }

    function syncForShareAction(bool issuingShares) external returns (uint256 recognizedAssets) {
        if (revertSync) revert("mock sync revert");
        lastIssuingShares = issuingShares;
        syncCallCount += 1;
        return recognized;
    }
}
