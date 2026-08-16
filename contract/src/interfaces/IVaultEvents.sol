// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVaultEvents {
    // Note: Deposit and Withdraw events are inherited from IERCC4626

    event AdapterRegistered(address indexed adapter, string name, uint256 capBps, uint256 maxLossBps);

    event AdapterStateChanged(
        address indexed adapter,
        uint8 state // 0=Active, 1=Disabled, 2=Impaired, 3=Removed
    );

    event AdapterRiskSet(address indexed adapter, uint16 capBps, uint256 absoluteCap, uint16 maxLossBps);

    event DependencyGroupSet(bytes32 indexed groupId, uint16 capBps, uint256 absoluteCap, address[] members);

    event AdminReserveSet(uint256 reserve);
    event DynamicReserveSet(uint256 reserve);
    event MaxSynchronousLossBpsSet(uint16 maxLossBps);

    event PlanCreated(bytes32 indexed planId, bytes32 indexed decisionHash, uint256 expiresAt);

    event PlanSubmitted(bytes32 indexed planId, bytes32 merkleRoot);

    event PlanActionExecuted(bytes32 indexed planId, uint256 indexed actionIndex, bytes32 kind, uint256 amount);

    event PlanCompleted(bytes32 indexed planId);
    event PlanCancelled(bytes32 indexed planId);

    event EmergencyExit(address indexed adapter, uint256 amount);

    event RewardExecutorSet(address indexed executor);

    event RewardTokenRouteSet(address indexed token, bytes32 indexed routeId);

    event RewardAccountantSet(address indexed accountant);

    event Harvested(address indexed adapter, uint256 usdcReceived);

    event Pause();
    event Unpause();
}
