// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeployBaseVault} from "./DeployBaseVault.s.sol";

/// @notice Deprecated compatibility target. New commands should select DeployBaseVault directly.
/// @dev This alias deliberately uses the Base-only core deployment and exposes no legacy relayer configuration.
contract DeployVault is DeployBaseVault {}
