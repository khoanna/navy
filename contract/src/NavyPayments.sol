// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEIP3009} from "./interfaces/IEIP3009.sol";

/// @title NavyPayments — EIP-3009 gasless invoice payments with an enforced fee split.
contract NavyPayments {
    uint16 public constant MAX_FEE_BPS = 1000; // 10% ceiling
    uint256 public constant MIN_INVOICE_AMOUNT = 10_000; // 0.01 USDC (6 decimals)

    address public owner;
    address public treasury;
    IEIP3009 public usdc;
    uint16 public feeBps;

    mapping(address => bool) public relayers;

    struct Merchant {
        address payout;
        bool active;
        bool exists;
    }

    mapping(bytes16 => Merchant) public merchants;
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

    error NotOwner();
    error NotRelayer();
    error FeeTooHigh();
    error MerchantExists();
    error MerchantInactive();
    error AmountTooSmall();
    error AlreadyPaid();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert NotRelayer();
        _;
    }

    constructor(address _usdc, address _treasury, uint16 _feeBps, address _owner) {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        usdc = IEIP3009(_usdc);
        treasury = _treasury;
        feeBps = _feeBps;
        owner = _owner;
    }

    function setConfig(uint16 _feeBps, address _treasury) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = _feeBps;
        treasury = _treasury;
        emit ConfigSet(_feeBps, _treasury);
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        relayers[relayer] = allowed;
        emit RelayerSet(relayer, allowed);
    }

    function registerMerchant(bytes16 merchantId, address payout) external onlyOwner {
        if (merchants[merchantId].exists) revert MerchantExists();
        merchants[merchantId] = Merchant({payout: payout, active: true, exists: true});
        emit MerchantRegistered(merchantId, payout);
    }

    function setMerchantActive(bytes16 merchantId, bool active) external onlyOwner {
        merchants[merchantId].active = active;
        emit MerchantActiveSet(merchantId, active);
    }

    function setMerchantPayout(bytes16 merchantId, address payout) external onlyOwner {
        merchants[merchantId].payout = payout;
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
        bytes32 key = keccak256(abi.encodePacked(merchantId, invoiceId));
        if (invoicePaid[key]) revert AlreadyPaid();

        Merchant memory m = merchants[merchantId];
        if (!m.exists || !m.active) revert MerchantInactive();
        if (amount < MIN_INVOICE_AMOUNT) revert AmountTooSmall();

        // Effects before interactions. `key` is the EIP-3009 nonce, binding the
        // payer's signature to this merchant + invoice + amount + expiry.
        invoicePaid[key] = true;
        usdc.receiveWithAuthorization(payer, address(this), amount, validAfter, validBefore, key, v, r, s);

        uint256 fee = (amount * feeBps) / 10000; // floors
        usdc.transfer(m.payout, amount - fee);
        if (fee > 0) {
            usdc.transfer(treasury, fee);
        }
        emit InvoicePaid(merchantId, invoiceId, payer, amount, fee, block.timestamp);
    }
}
