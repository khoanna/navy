// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEIP3009} from "./interfaces/IEIP3009.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title NavyPayments — EIP-3009 gasless invoice payments with an enforced fee split.
/// @dev The payment token is Circle Sepolia USDC, which reverts on failed ERC-20 transfers,
/// so return values are intentionally unchecked (no SafeERC20 dependency).
contract NavyPayments {
    using SafeERC20 for IERC20;
    uint16 public constant MAX_FEE_BPS = 1000; // 10% ceiling
    uint256 public constant MIN_INVOICE_AMOUNT = 10_000; // 0.01 USDC (6 decimals)

    address public owner;
    address public treasury;
    IEIP3009 public usdc;
    uint16 public feeBps;
    uint64 public configVersion;

    mapping(address => bool) public relayers;

    struct Merchant {
        address payout;
        bool active;
        bool exists;
    }

    mapping(bytes16 => Merchant) public merchants;
    mapping(bytes16 => uint64) public merchantVersion;
    mapping(bytes32 => bool) public invoicePaid; // keccak256(merchantId, invoiceId) => paid

    event InvoicePaid(
        bytes16 indexed merchantId,
        bytes16 indexed invoiceId,
        address indexed payer,
        uint256 amount,
        uint256 fee,
        uint256 paidAt
    );
    event MerchantRegistered(bytes16 indexed merchantId, address payout);
    event MerchantPayoutSet(bytes16 indexed merchantId, address payout);
    event MerchantActiveSet(bytes16 indexed merchantId, bool active);
    event ConfigSet(uint16 feeBps, address treasury);
    event RelayerSet(address indexed relayer, bool allowed);
    event ExcessRecovered(address indexed to, uint256 amount);
    event NativeRecovered(address indexed to, uint256 amount);

    error NotOwner();
    error NotRelayer();
    error FeeTooHigh();
    error MerchantExists();
    error MerchantInactive();
    error MerchantUnknown();
    error AmountTooSmall();
    error AlreadyPaid();
    error ZeroAddress();
    error InvalidPayout();
    error NativeTransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert NotRelayer();
        _;
    }

    constructor(address _usdc, address _treasury, uint16 _feeBps, address _owner) {
        if (_usdc == address(0) || _treasury == address(0) || _owner == address(0)) revert ZeroAddress();
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        usdc = IEIP3009(_usdc);
        treasury = _treasury;
        feeBps = _feeBps;
        owner = _owner;
        configVersion = 1;
    }

    function setConfig(uint16 _feeBps, address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = _feeBps;
        treasury = _treasury;
        configVersion++;
        emit ConfigSet(_feeBps, _treasury);
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        relayers[relayer] = allowed;
        emit RelayerSet(relayer, allowed);
    }

    function registerMerchant(bytes16 merchantId, address payout) external onlyOwner {
        if (payout == address(0)) revert ZeroAddress();
        if (payout == address(this) || payout == address(usdc)) revert InvalidPayout();
        if (merchants[merchantId].exists) revert MerchantExists();
        merchants[merchantId] = Merchant({payout: payout, active: true, exists: true});
        merchantVersion[merchantId] = 1;
        emit MerchantRegistered(merchantId, payout);
    }

    function setMerchantActive(bytes16 merchantId, bool active) external onlyOwner {
        if (!merchants[merchantId].exists) revert MerchantUnknown();
        merchants[merchantId].active = active;
        emit MerchantActiveSet(merchantId, active);
    }

    function setMerchantPayout(bytes16 merchantId, address payout) external onlyOwner {
        if (payout == address(0)) revert ZeroAddress();
        if (payout == address(this) || payout == address(usdc)) revert InvalidPayout();
        if (!merchants[merchantId].exists) revert MerchantUnknown();
        merchants[merchantId].payout = payout;
        merchantVersion[merchantId]++;
        emit MerchantPayoutSet(merchantId, payout);
    }

    function payInvoice(
        bytes16 merchantId,
        bytes16 invoiceId,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        address payer,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRelayer {
        bytes32 key = invoiceKey(merchantId, invoiceId);
        if (invoicePaid[key]) revert AlreadyPaid();

        Merchant memory m = merchants[merchantId];
        if (!m.exists || !m.active) revert MerchantInactive();
        if (amount < MIN_INVOICE_AMOUNT) revert AmountTooSmall();

        // Effects before interactions. The stable invoice key prevents invoice replay, while the
        // EIP-3009 nonce also commits the currently selected payout and fee configuration.
        invoicePaid[key] = true;
        bytes32 nonce = authorizationNonce(merchantId, invoiceId);
        usdc.receiveWithAuthorization(payer, address(this), amount, validAfter, validBefore, nonce, v, r, s);

        uint256 fee = feeBps > 0 ? Math.mulDiv(amount, feeBps, 10_000, Math.Rounding.Ceil) : 0;
        IERC20(address(usdc)).safeTransfer(m.payout, amount - fee);
        if (fee > 0) {
            IERC20(address(usdc)).safeTransfer(treasury, fee);
        }
        emit InvoicePaid(merchantId, invoiceId, payer, amount, fee, block.timestamp);
    }

    function invoiceKey(bytes16 merchantId, bytes16 invoiceId) public pure returns (bytes32) {
        return keccak256(abi.encode(merchantId, invoiceId));
    }

    function authorizationNonce(bytes16 merchantId, bytes16 invoiceId) public view returns (bytes32) {
        Merchant memory merchant = merchants[merchantId];
        return keccak256(
            abi.encode(
                invoiceKey(merchantId, invoiceId),
                merchant.payout,
                treasury,
                feeBps,
                configVersion,
                merchantVersion[merchantId]
            )
        );
    }

    /// @notice Recover only USDC that was sent outside an atomic invoice call.
    function recoverExcess(address to) external onlyOwner returns (uint256 amount) {
        if (to == address(0) || to == address(this)) revert ZeroAddress();
        amount = usdc.balanceOf(address(this));
        if (amount > 0) IERC20(address(usdc)).safeTransfer(to, amount);
        emit ExcessRecovered(to, amount);
    }

    /// @notice Recover native currency forcibly sent to this non-payable contract.
    function recoverNative(address payable to) external onlyOwner returns (uint256 amount) {
        if (to == address(0) || to == address(this)) revert ZeroAddress();
        amount = address(this).balance;
        (bool success,) = to.call{value: amount}("");
        if (!success) revert NativeTransferFailed();
        emit NativeRecovered(to, amount);
    }
}
