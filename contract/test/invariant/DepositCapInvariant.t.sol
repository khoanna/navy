// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {MockERC20} from "../../src/MockERC20.sol";

/// @notice Drives deposits, mints, yield, redemptions and cap changes, and
///         counts any successful deposit or mint that left totalAssets above
///         max(depositCap, totalAssets before the call).
contract DepositCapHandler is Test {
    NavyVaultSRCLA public immutable vault;
    MockERC20 public immutable usdc;
    address[] internal actors;

    uint256 public capViolations;
    uint256 public successfulDeposits;
    uint256 public capRejections;

    constructor(NavyVaultSRCLA vault_, MockERC20 usdc_) {
        vault = vault_;
        usdc = usdc_;
        for (uint256 i = 0; i < 3; i++) {
            actors.push(address(uint160(0xCA9 + i)));
        }
    }

    function setCap(uint256 newCap) external {
        newCap = bound(newCap, 0, 5_000_000e6);
        vault.setDepositCap(newCap);
    }

    function deposit(uint256 actorSeed, uint256 assets) external {
        address actor = actors[actorSeed % actors.length];
        assets = bound(assets, 1, 2_000_000e6);
        usdc.mint(actor, assets);
        uint256 before = vault.totalAssets();
        uint256 cap = vault.depositCap();

        vm.startPrank(actor);
        usdc.approve(address(vault), assets);
        try vault.deposit(assets, actor) {
            successfulDeposits++;
            _check(before, cap);
        } catch (bytes memory reason) {
            // Only the deposit cap may silently reject this call. The actor
            // was minted exactly the assets it spends and approved exactly
            // that amount, so no balance/allowance revert is expected here -
            // anything other than the cap's own error is a genuine finding
            // and must not be swallowed.
            if (_revertSelector(reason) == ERC4626.ERC4626ExceededMaxDeposit.selector) {
                capRejections++;
            } else {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
        }
        vm.stopPrank();
    }

    function mint(uint256 actorSeed, uint256 shares) external {
        address actor = actors[actorSeed % actors.length];
        shares = bound(shares, 1, 2_000_000e12);
        uint256 assets = vault.previewMint(shares);
        usdc.mint(actor, assets);
        uint256 before = vault.totalAssets();
        uint256 cap = vault.depositCap();

        vm.startPrank(actor);
        usdc.approve(address(vault), assets);
        try vault.mint(shares, actor) {
            successfulDeposits++;
            _check(before, cap);
        } catch (bytes memory reason) {
            if (_revertSelector(reason) == ERC4626.ERC4626ExceededMaxMint.selector) {
                capRejections++;
            } else {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
        }
        vm.stopPrank();
    }

    /// @dev Yield: a donation raises totalAssets without minting shares.
    function accrueYield(uint256 amount) external {
        amount = bound(amount, 0, 100_000e6);
        usdc.mint(address(vault), amount);
    }

    /// @dev Redemptions are never subject to the deposit cap. No try/catch:
    ///      any revert here is a genuine finding and fails the run outright.
    function redeem(uint256 actorSeed, uint256 shares) external {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = vault.balanceOf(actor);
        if (balance == 0) return;
        shares = bound(shares, 1, balance);
        vm.prank(actor);
        vault.redeem(shares, actor, actor);
    }

    function _check(uint256 before, uint256 cap) internal {
        uint256 ceiling = cap > before ? cap : before;
        if (vault.totalAssets() > ceiling) capViolations++;
    }

    function _revertSelector(bytes memory reason) private pure returns (bytes4 selector) {
        if (reason.length < 4) return bytes4(0);
        assembly {
            selector := mload(add(reason, 0x20))
        }
    }
}

contract DepositCapInvariantTest is Test {
    NavyVaultSRCLA internal vault;
    MockERC20 internal usdc;
    DepositCapHandler internal handler;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        handler = new DepositCapHandler(vault, usdc);
        vault.grantRole(vault.ADMIN_ROLE(), address(handler));
        vault.setDepositCap(1_000_000e6);

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = DepositCapHandler.setCap.selector;
        selectors[1] = DepositCapHandler.deposit.selector;
        selectors[2] = DepositCapHandler.mint.selector;
        selectors[3] = DepositCapHandler.accrueYield.selector;
        selectors[4] = DepositCapHandler.redeem.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_noDepositOrMintBreachesTheCap() public view {
        assertEq(handler.capViolations(), 0, "a deposit or mint carried totalAssets past the deposit cap");
    }

    function invariant_maxDepositIsTheRoomBelowTheCap() public view {
        uint256 cap = vault.depositCap();
        uint256 assets = vault.totalAssets();
        uint256 expected = cap > assets ? cap - assets : 0;
        assertEq(vault.maxDeposit(address(this)), expected, "maxDeposit must equal the room below the cap");
    }

    /// @notice The handler must prove it actually did something: at least one
    ///         deposit or mint succeeded during the campaign. Without this, a
    ///         handler where every call reverts would still report a green
    ///         invariant run with zero coverage.
    function afterInvariant() public view {
        console2.log("successfulDeposits", handler.successfulDeposits());
        console2.log("capRejections", handler.capRejections());
        assertGt(handler.successfulDeposits(), 0, "the handler never completed a deposit or mint");
    }
}
