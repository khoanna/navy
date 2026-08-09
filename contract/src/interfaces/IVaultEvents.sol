// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVaultEvents {
    // Note: Deposit and Withdraw events are inherited from IERCC4626

    event AdapterRegistered(address indexed adapter, string name, uint256 capBps, uint256 maxLossBps);

    event AdapterStateChanged(
        address indexed adapter,
        uint8 state // 0=Active, 1=Disabled, 2=Impaired, 3=Removed
    );

    event PlanCreated(bytes32 indexed planId, bytes32 indexed decisionHash, uint256 expiresAt);

    event PlanActionExecuted(bytes32 indexed planId, uint256 indexed actionIndex, bytes32 kind, uint256 amount);

    event PlanCompleted(bytes32 indexed planId);
    event PlanCancelled(bytes32 indexed planId);

    event EmergencyExit(address indexed adapter, uint256 amount);

    event Pause();
    event Unpause();
}
