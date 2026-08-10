// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockChainlink {
    uint8 public decimals_;
    int256 public answer_;
    uint256 public updatedAt_;

    constructor(uint8 decimals, int256 answer) {
        decimals_ = decimals;
        answer_ = answer;
        updatedAt_ = block.timestamp;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, answer_, block.timestamp, updatedAt_, 1);
    }

    function setAnswer(int256 answer) external {
        answer_ = answer;
        updatedAt_ = block.timestamp;
    }

    function setStale() external {
        // Set updatedAt to be significantly in the past relative to current block.timestamp
        // Use a large value that will always be stale (maxAge in tests is 3600)
        updatedAt_ = block.timestamp < 5000 ? 1 : block.timestamp - 5000;
    }
}
