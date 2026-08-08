// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {NavyVault} from "../src/NavyVault.sol";
import {VaultTypes} from "../src/libraries/VaultTypes.sol";

/// @notice Runs one explicit owner administration action against a deployed Base vault.
/// @dev Set BASE_VAULT_ADMIN_ACTION to one of the documented action names. Action-specific addresses are never
///      embedded here because adapters and the reward executor are deployed by later plans.
contract AdminBaseVault is Script {
    using SafeCast for uint256;

    uint256 public constant BASE_CHAIN_ID = 8453;
    address public constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    bytes32 private constant ADD_ADAPTER = keccak256("ADD_ADAPTER");
    bytes32 private constant SET_ADAPTER_STATUS = keccak256("SET_ADAPTER_STATUS");
    bytes32 private constant SET_ADAPTER_LIMITS = keccak256("SET_ADAPTER_LIMITS");
    bytes32 private constant SET_DEPENDENCY_CAP = keccak256("SET_DEPENDENCY_CAP");
    bytes32 private constant SET_ADAPTER_DEPENDENCIES = keccak256("SET_ADAPTER_DEPENDENCIES");
    bytes32 private constant SET_ADMIN_IDLE_FLOOR = keccak256("SET_ADMIN_IDLE_FLOOR");
    bytes32 private constant SET_REWARD_ACCOUNTANT = keccak256("SET_REWARD_ACCOUNTANT");
    bytes32 private constant SET_WITHDRAWAL_ORDER = keccak256("SET_WITHDRAWAL_ORDER");
    bytes32 private constant SET_PAUSED = keccak256("SET_PAUSED");
    bytes32 private constant SET_ALLOCATOR = keccak256("SET_ALLOCATOR");
    bytes32 private constant TRANSFER_OWNERSHIP = keccak256("TRANSFER_OWNERSHIP");
    bytes32 private constant RECORD_IMPAIRMENT = keccak256("RECORD_IMPAIRMENT");

    error WrongChain();
    error WrongAsset();
    error InvalidVault();
    error NotVaultOwner();
    error UnknownAction();

    function run() external {
        (NavyVault vault, uint256 adminPk) = _validatedTarget();
        bytes32 action = keccak256(bytes(vm.envString("BASE_VAULT_ADMIN_ACTION")));

        vm.startBroadcast(adminPk);
        if (action == ADD_ADAPTER) {
            vault.addAdapter(vm.envAddress("BASE_STRATEGY_ADDRESS"));
        } else if (action == SET_ADAPTER_STATUS) {
            VaultTypes.AdapterStatus status = VaultTypes.AdapterStatus(vm.envUint("BASE_ADAPTER_STATUS").toUint8());
            vault.setAdapterStatus(vm.envAddress("BASE_STRATEGY_ADDRESS"), status);
        } else if (action == SET_ADAPTER_LIMITS) {
            vault.setAdapterLimits(
                vm.envAddress("BASE_STRATEGY_ADDRESS"),
                vm.envUint("BASE_ADAPTER_CAP_BPS").toUint16(),
                vm.envUint("BASE_ADAPTER_ABSOLUTE_CAP"),
                vm.envUint("BASE_ADAPTER_MAX_LOSS_BPS").toUint16(),
                vm.envUint("BASE_ADAPTER_ACCOUNTING_CAP")
            );
        } else if (action == SET_DEPENDENCY_CAP) {
            vault.setDependencyCap(
                vm.envBytes32("BASE_DEPENDENCY_ID"),
                vm.envUint("BASE_DEPENDENCY_CAP_BPS").toUint16(),
                vm.envUint("BASE_DEPENDENCY_ABSOLUTE_CAP")
            );
        } else if (action == SET_ADAPTER_DEPENDENCIES) {
            vault.setAdapterDependencies(
                vm.envAddress("BASE_STRATEGY_ADDRESS"), vm.envBytes32("BASE_DEPENDENCY_IDS", ",")
            );
        } else if (action == SET_ADMIN_IDLE_FLOOR) {
            vault.setAdminIdleFloor(vm.envUint("BASE_ADMIN_IDLE_FLOOR"));
        } else if (action == SET_REWARD_ACCOUNTANT) {
            vault.setRewardAccountant(vm.envAddress("BASE_REWARD_ACCOUNTANT_ADDRESS"));
        } else if (action == SET_WITHDRAWAL_ORDER) {
            vault.setWithdrawalOrder(vm.envAddress("BASE_WITHDRAWAL_ORDER", ","));
        } else if (action == SET_PAUSED) {
            vault.setPaused(vm.envBool("BASE_VAULT_PAUSED"));
        } else if (action == SET_ALLOCATOR) {
            vault.setAllocator(vm.envAddress("SRCLA_ALLOCATOR_ADDRESS"));
        } else if (action == TRANSFER_OWNERSHIP) {
            vault.transferOwnership(vm.envAddress("BASE_NEW_ADMIN_ADDRESS"));
        } else if (action == RECORD_IMPAIRMENT) {
            vault.recordImpairment(vm.envAddress("BASE_STRATEGY_ADDRESS"), vm.envUint("BASE_ADAPTER_IMPAIRMENT_AMOUNT"));
        } else {
            revert UnknownAction();
        }
        vm.stopBroadcast();
    }

    function _validatedTarget() internal view returns (NavyVault vault, uint256 adminPk) {
        if (block.chainid != BASE_CHAIN_ID) revert WrongChain();

        address vaultAddress = vm.envAddress("BASE_VAULT_ADDRESS");
        if (vaultAddress == address(0) || vaultAddress.code.length == 0) revert InvalidVault();
        vault = NavyVault(vaultAddress);
        if (vault.asset() != BASE_USDC) revert WrongAsset();

        adminPk = vm.envUint("BASE_ADMIN_PRIVATE_KEY");
        if (vm.addr(adminPk) != vault.owner()) revert NotVaultOwner();
    }
}
