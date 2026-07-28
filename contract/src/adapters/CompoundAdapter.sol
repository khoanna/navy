// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IComet} from "../interfaces/IComet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CompoundAdapter — supplies the vault's USDC to Compound III (Comet).
/// @dev The adapter is msg.sender to Comet, so Comet credits this contract. totalAssets reads the
/// Comet supplier balance. Only the vault may move funds.
contract CompoundAdapter is IYieldAdapter {
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    address public immutable vault;
    IERC20 public immutable usdc;
    IComet public immutable comet;

    error NotVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _usdc, address _comet) {
        vault = _vault;
        usdc = IERC20(_usdc);
        comet = IComet(_comet);
    }

    function deposit(uint256 amount) external onlyVault {
        usdc.approve(address(comet), amount);
        comet.supply(address(usdc), amount);
    }

    function withdraw(uint256 amount, address to) external onlyVault {
        comet.withdrawTo(to, address(usdc), amount);
    }

    function totalAssets() external view returns (uint256) {
        return comet.balanceOf(address(this));
    }

    function supplyRatePerYear() external view returns (uint256) {
        uint256 util = comet.getUtilization();
        uint64 ratePerSecond = comet.getSupplyRate(util); // 1e18-scaled per-second
        return uint256(ratePerSecond) * SECONDS_PER_YEAR;
    }

    function asset() external view returns (address) {
        return address(usdc);
    }
}
