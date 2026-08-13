// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";
import {IAaveV3Pool, IAaveV3AToken} from "../interfaces/IAaveV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title AaveV3Adapter — supplies the vault's USDC to Aave V3 on Base.
/// @dev The adapter is msg.sender to Aave Pool, so Aave credits this contract.
/// totalAssets reads the aUSDC balance (indexed value). Only the vault may move funds.
/// Per SRCLA paper Section 6.3.
contract AaveV3Adapter is IStrategyAdapter {
    using SafeERC20 for IERC20;

    address public immutable vault;
    IERC20 public immutable usdc;
    IAaveV3Pool public immutable pool;
    IAaveV3AToken public immutable aUsdc;

    /// @dev COMP reward token on Base
    /// @notice From official compound-finance/comet roots: 0x9e1028F5F1D5eDE59748FFceE5532509976840E0
    address private constant COMP = 0x9e1028F5F1D5eDE59748FFceE5532509976840E0;

    /// @dev List of reward tokens this adapter can claim
    address[] private _rewardTokens = [COMP];

    error NotVault();
    error UnsupportedRewardToken();
    error ProtocolPaused();
    error DepositFailed();
    error WithdrawFailed();
    error InvalidConfiguration();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _usdc, address _pool, address _aUsdc) {
        if (_vault == address(0) || _usdc == address(0) || _pool == address(0) || _aUsdc == address(0)) {
            revert InvalidConfiguration();
        }
        if (_aUsdc.code.length != 0) {
            if (IAaveV3AToken(_aUsdc).UNDERLYING_ASSET_ADDRESS() != _usdc) revert InvalidConfiguration();
            if (IAaveV3Pool(_pool).getReserveData(_usdc).aTokenAddress != _aUsdc) revert InvalidConfiguration();
        }
        vault = _vault;
        usdc = IERC20(_usdc);
        pool = IAaveV3Pool(_pool);
        aUsdc = IAaveV3AToken(_aUsdc);
    }

    /// @notice Supply USDC to Aave V3 Pool
    /// @dev Approves pool to pull USDC, then calls supply
    /// @dev Uses try/catch for protocol pause resilience
    function deposit(uint256 amount) external onlyVault returns (uint256 credited) {
        uint256 beforeAssets = aUsdc.balanceOf(address(this));
        usdc.forceApprove(address(pool), amount);
        try pool.supply(address(usdc), amount, address(this), 0) {}
        catch {
            revert DepositFailed();
        }
        usdc.forceApprove(address(pool), 0);
        credited = aUsdc.balanceOf(address(this)) - beforeAssets;
    }

    /// @notice Withdraw USDC from Aave V3 Pool
    /// @dev Calls withdraw on the pool, sends to vault
    /// @dev Uses try/catch for protocol pause resilience
    function withdraw(uint256 amount) external onlyVault returns (uint256 returned) {
        uint256 beforeBalance = usdc.balanceOf(vault);
        try pool.withdraw(address(usdc), amount, vault) returns (uint256) {}
        catch {
            revert WithdrawFailed();
        }
        returned = usdc.balanceOf(vault) - beforeBalance;
    }

    /// @notice Current value of Aave position in USDC terms
    /// @dev Uses aToken balance which is already indexed to include accrued interest
    function totalAssets() external view returns (uint256) {
        return aUsdc.balanceOf(address(this));
    }

    function sync() external view returns (uint256) {
        return aUsdc.balanceOf(address(this));
    }

    /// @notice Annualized supply rate (APY) as 1e18-scaled integer
    /// @dev Reads current liquidity rate from pool reserve data.
    ///      currentLiquidityRate is already annualized in RAY (1e27).
    function supplyRatePerYear() external view returns (uint256) {
        IAaveV3Pool.ReserveData memory reserveData = pool.getReserveData(address(usdc));
        // Convert the annualized RAY value directly to WAD.
        return uint256(reserveData.currentLiquidityRate) / 1e9;
    }

    /// @notice Returns the vault asset (USDC)
    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice Returns the aToken address
    function aToken() external view returns (address) {
        return address(aUsdc);
    }

    /// @notice Returns the Aave Pool address
    function aavePool() external view returns (address) {
        return address(pool);
    }

    /// @notice Maximum amount withdrawable in same transaction
    /// @dev aUSDC is 1:1 mint/burn, always fully redeemable. Implements IStrategyAdapter.maxWithdrawable()
    /// @dev Note: Aave V3 allows instant withdrawals as aTokens are rebasing
    function maxWithdrawable() external view returns (uint256) {
        uint256 position = aUsdc.balanceOf(address(this));
        uint256 cash = usdc.balanceOf(address(aUsdc));
        return position < cash ? position : cash;
    }

    /// @notice Unique digest of current protocol configuration
    /// @dev Implements IStrategyAdapter.configurationDigest()
    function configurationDigest() external view returns (bytes32) {
        return keccak256(abi.encode(address(pool), address(aUsdc), address(usdc), block.chainid));
    }

    /// @notice List of reward tokens this strategy can claim
    /// @dev Implements IStrategyAdapter.rewardTokens()
    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    /// @notice Claimable reward amount for a given token
    /// @dev Implements IStrategyAdapter.claimableReward(). Returns 0 until rewards controller is integrated.
    function claimableReward(address token) external pure returns (uint256) {
        if (token != COMP) revert UnsupportedRewardToken();
        // Aave V3 rewards controller integration deferred for Phase 2
        return 0;
    }
}
