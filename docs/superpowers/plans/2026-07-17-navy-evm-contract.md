# NavyPayments Contract (EVM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and test the `NavyPayments` Solidity contract on Ethereum Sepolia — the EVM replacement for the Anchor `navy_payments` program — using EIP-3009 `receiveWithAuthorization` so a single user EIP-712 signature authorizes a gasless, relayer-submitted USDC invoice payment with a 99/1 merchant/treasury split and on-chain pay-once replay protection.

**Architecture:** A Foundry project at `contract/`. `NavyPayments.payInvoice` reads an owner-registered merchant, pulls the exact USDC via the payer's `receiveWithAuthorization` signature (nonce bound to `keccak256(merchantId, invoiceId)`), splits merchant payout + treasury fee, guards replay with an `invoicePaid` mapping, and emits `InvoicePaid`. Only allowlisted relayers submit. A local `MockUSDC` implements EIP-3009 so tests can sign with `vm.sign`; a Sepolia-fork test exercises the real Circle USDC.

**Tech Stack:** Solidity 0.8.24, Foundry (`forge`), `forge-std`. No external contract libraries required (minimal, audit-friendly surface). Deploys against Circle USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` on Sepolia.

**Spec:** `docs/superpowers/specs/2026-07-17-navy-evm-migration-design.md` (§3, §8, §9).

---

## File Structure

- `contract/foundry.toml` — Foundry config (solc 0.8.24, optimizer, Sepolia RPC/etherscan endpoints).
- `contract/.gitignore` — ignore `out/`, `cache/`, `broadcast/`, `.env`.
- `contract/.env.example` — `SEPOLIA_RPC_URL`, `ETHERSCAN_API_KEY`, `DEPLOYER_PRIVATE_KEY`, `NAVY_USDC_ADDRESS`, `NAVY_TREASURY_ADDRESS`, `NAVY_OWNER_ADDRESS`, `NAVY_FEE_BPS`, `NAVY_RELAYER_ADDRESS`.
- `contract/src/interfaces/IEIP3009.sol` — minimal interface the contract depends on (`receiveWithAuthorization`, `transfer`, `balanceOf`).
- `contract/src/NavyPayments.sol` — the payment contract.
- `contract/test/mocks/MockUSDC.sol` — EIP-3009 test token (EIP-712 domain, `receiveWithAuthorization`, `transfer`, `mint`).
- `contract/test/NavyPayments.t.sol` — unit + revert tests.
- `contract/test/NavyPayments.fuzz.t.sol` — fuzz tests (fee flooring + value conservation).
- `contract/test/NavyPaymentsFork.t.sol` — Sepolia-fork test against real USDC (skipped without `SEPOLIA_RPC_URL`).
- `contract/script/Deploy.s.sol` — deploy + configure (register relayer) script.
- `contract/README.md` — build/test/deploy runbook.

---

### Task 1: Scaffold the Foundry project

**Files:**
- Create: `contract/foundry.toml`
- Create: `contract/.gitignore`
- Create: `contract/.env.example`

- [ ] **Step 1: Initialize Foundry in `contract/` without a git repo or template**

Run:
```bash
cd /home/khoa/Desktop/DATN && forge init contract --no-git --no-commit --force
```
Expected: creates `contract/` with `lib/forge-std`, plus sample `src/Counter.sol`, `test/Counter.t.sol`, `script/Counter.s.sol`.

(If `forge` is not installed, first run `curl -L https://foundry.paradigm.xyz | bash && foundryup`.)

- [ ] **Step 2: Remove the sample Counter files**

Run:
```bash
cd /home/khoa/Desktop/DATN/contract && rm -f src/Counter.sol test/Counter.t.sol script/Counter.s.sol
```
Expected: no output; the three sample files are gone.

- [ ] **Step 3: Write `contract/foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
solc = "0.8.24"
optimizer = true
optimizer_runs = 200
fs_permissions = [{ access = "read", path = "./"}]

[fmt]
line_length = 120

[rpc_endpoints]
sepolia = "${SEPOLIA_RPC_URL}"

[etherscan]
sepolia = { key = "${ETHERSCAN_API_KEY}" }
```

- [ ] **Step 4: Write `contract/.gitignore`**

```gitignore
out/
cache/
broadcast/
.env
```

- [ ] **Step 5: Write `contract/.env.example`**

```bash
# JSON-RPC endpoint for Sepolia (Alchemy/Infura/public)
SEPOLIA_RPC_URL=
# Etherscan API key for verification (optional)
ETHERSCAN_API_KEY=
# Deployer EOA private key (funds deploy; can equal the owner)
DEPLOYER_PRIVATE_KEY=
# Circle USDC on Sepolia
NAVY_USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
# Fee sink + admin owner + initial relayer
NAVY_TREASURY_ADDRESS=
NAVY_OWNER_ADDRESS=
NAVY_RELAYER_ADDRESS=
# Fee in basis points (100 = 1%)
NAVY_FEE_BPS=100
```

- [ ] **Step 6: Verify the toolchain builds the empty project**

Run: `cd /home/khoa/Desktop/DATN/contract && forge build`
Expected: `Compiling ... ` then a success line (no contracts yet besides forge-std). No errors.

- [ ] **Step 7: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add contract/foundry.toml contract/.gitignore contract/.env.example contract/lib && git commit -m "chore(contract): scaffold Foundry project for NavyPayments"
```

---

### Task 2: `MockUSDC` — a local EIP-3009 token for tests

**Files:**
- Create: `contract/src/interfaces/IEIP3009.sol`
- Create: `contract/test/mocks/MockUSDC.sol`
- Test: `contract/test/mocks/MockUSDC.t.sol`

- [ ] **Step 1: Write the `IEIP3009` interface**

Create `contract/src/interfaces/IEIP3009.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal subset of USDC (FiatTokenV2_2) that NavyPayments depends on.
interface IEIP3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function transfer(address to, uint256 value) external returns (bool);

    function balanceOf(address account) external view returns (uint256);
}
```

- [ ] **Step 2: Write the failing `MockUSDC` test**

Create `contract/test/mocks/MockUSDC.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC usdc;
    uint256 payerPk = 0xA11CE;
    address payer;
    address payee = address(0xBEEF);

    function setUp() public {
        usdc = new MockUSDC();
        payer = vm.addr(payerPk);
        usdc.mint(payer, 1_000_000);
        vm.warp(1_700_000_000); // realistic timestamp so validAfter=0 passes
    }

    function _sign(uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                payer,
                payee,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(payerPk, digest);
    }

    function test_receiveWithAuthorization_movesFundsAndBurnsNonce() public {
        bytes32 nonce = keccak256("inv-1");
        (uint8 v, bytes32 r, bytes32 s) = _sign(500_000, 0, block.timestamp + 3600, nonce);

        vm.prank(payee);
        usdc.receiveWithAuthorization(payer, payee, 500_000, 0, block.timestamp + 3600, nonce, v, r, s);

        assertEq(usdc.balanceOf(payer), 500_000);
        assertEq(usdc.balanceOf(payee), 500_000);
        assertTrue(usdc.authorizationState(payer, nonce));
    }

    function test_receiveWithAuthorization_revertsWhenCallerNotPayee() public {
        bytes32 nonce = keccak256("inv-2");
        (uint8 v, bytes32 r, bytes32 s) = _sign(500_000, 0, block.timestamp + 3600, nonce);

        vm.expectRevert(bytes("caller must be the payee"));
        usdc.receiveWithAuthorization(payer, payee, 500_000, 0, block.timestamp + 3600, nonce, v, r, s);
    }
}
```

- [ ] **Step 3: Run the test to verify it fails to compile (MockUSDC missing)**

Run: `cd /home/khoa/Desktop/DATN/contract && forge test --match-contract MockUSDCTest`
Expected: compilation error — `Source "test/mocks/MockUSDC.sol" not found`.

- [ ] **Step 4: Write `MockUSDC`**

Create `contract/test/mocks/MockUSDC.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal EIP-3009 token mirroring Circle USDC's receiveWithAuthorization for local tests.
contract MockUSDC {
    string public constant name = "USDC";
    string public constant version = "2";
    uint8 public constant decimals = 6;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                address(this)
            )
        );
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(to == msg.sender, "caller must be the payee");
        require(block.timestamp > validAfter, "authorization not yet valid");
        require(block.timestamp < validBefore, "authorization expired");
        require(!authorizationState[from][nonce], "authorization used");

        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        require(ecrecover(digest, v, r, s) == from, "invalid signature");

        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/khoa/Desktop/DATN/contract && forge test --match-contract MockUSDCTest -vv`
Expected: `[PASS] test_receiveWithAuthorization_movesFundsAndBurnsNonce()` and `[PASS] test_receiveWithAuthorization_revertsWhenCallerNotPayee()`.

- [ ] **Step 6: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add contract/src/interfaces/IEIP3009.sol contract/test/mocks/MockUSDC.sol contract/test/mocks/MockUSDC.t.sol && git commit -m "test(contract): add IEIP3009 interface + EIP-3009 MockUSDC"
```

---

### Task 3: `NavyPayments` state, config & merchant admin

**Files:**
- Create: `contract/src/NavyPayments.sol`
- Test: `contract/test/NavyPayments.t.sol`

- [ ] **Step 1: Write the failing admin test**

Create `contract/test/NavyPayments.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyPayments} from "../src/NavyPayments.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract NavyPaymentsTest is Test {
    NavyPayments navy;
    MockUSDC usdc;

    address owner = address(0x0111);
    address treasury = address(0x7EA5);
    address relayer = address(0x0333);
    bytes16 constant MID = bytes16(hex"11111111111111111111111111111111");
    address merchantPayout = address(0x0444);

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(owner);
        navy = new NavyPayments(address(usdc), treasury, 100, owner);
    }

    function test_constructor_setsConfig() public view {
        assertEq(navy.owner(), owner);
        assertEq(navy.treasury(), treasury);
        assertEq(address(navy.usdc()), address(usdc));
        assertEq(navy.feeBps(), 100);
    }

    function test_constructor_revertsOnFeeTooHigh() public {
        vm.expectRevert(NavyPayments.FeeTooHigh.selector);
        new NavyPayments(address(usdc), treasury, 1001, owner);
    }

    function test_registerMerchant_onlyOwner() public {
        vm.expectRevert(NavyPayments.NotOwner.selector);
        navy.registerMerchant(MID, merchantPayout);
    }

    function test_registerMerchant_storesAndRejectsDuplicate() public {
        vm.prank(owner);
        navy.registerMerchant(MID, merchantPayout);
        (address payout, bool active, bool exists) = navy.merchants(MID);
        assertEq(payout, merchantPayout);
        assertTrue(active);
        assertTrue(exists);

        vm.prank(owner);
        vm.expectRevert(NavyPayments.MerchantExists.selector);
        navy.registerMerchant(MID, merchantPayout);
    }

    function test_setMerchantActiveAndPayout() public {
        vm.startPrank(owner);
        navy.registerMerchant(MID, merchantPayout);
        navy.setMerchantActive(MID, false);
        navy.setMerchantPayout(MID, address(0x0555));
        vm.stopPrank();
        (address payout, bool active,) = navy.merchants(MID);
        assertEq(payout, address(0x0555));
        assertFalse(active);
    }

    function test_setRelayer_onlyOwner() public {
        vm.expectRevert(NavyPayments.NotOwner.selector);
        navy.setRelayer(relayer, true);

        vm.prank(owner);
        navy.setRelayer(relayer, true);
        assertTrue(navy.relayers(relayer));
    }

    function test_setConfig_boundsFee() public {
        vm.prank(owner);
        vm.expectRevert(NavyPayments.FeeTooHigh.selector);
        navy.setConfig(1001, treasury);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails to compile (NavyPayments missing)**

Run: `cd /home/khoa/Desktop/DATN/contract && forge test --match-contract NavyPaymentsTest`
Expected: compilation error — `Source "src/NavyPayments.sol" not found`.

- [ ] **Step 3: Write `NavyPayments` (state, modifiers, constructor, admin fns)**

Create `contract/src/NavyPayments.sol`:
```solidity
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
}
```

- [ ] **Step 4: Run the admin tests to verify they pass**

Run: `cd /home/khoa/Desktop/DATN/contract && forge test --match-contract NavyPaymentsTest -vv`
Expected: all seven `test_*` admin cases `[PASS]`.

- [ ] **Step 5: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add contract/src/NavyPayments.sol contract/test/NavyPayments.t.sol && git commit -m "feat(contract): NavyPayments state, config, and merchant admin"
```

---

### Task 4: `payInvoice` happy path (pull, split, event)

**Files:**
- Modify: `contract/src/NavyPayments.sol`
- Modify: `contract/test/NavyPayments.t.sol`

- [ ] **Step 1: Add a signing helper + happy-path test to `NavyPayments.t.sol`**

Append these members inside `contract/test/NavyPayments.t.sol` (before the closing brace). It adds a payer keypair, a relayer registration helper, an EIP-3009 signer bound to the invoice key, and the happy-path assertions:
```solidity
    uint256 payerPk = 0xA11CE;

    function _payer() internal view returns (address) {
        return vm.addr(payerPk);
    }

    function _invoiceKey(bytes16 merchantId, bytes16 invoiceId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(merchantId, invoiceId));
    }

    function _signInvoice(bytes16 merchantId, bytes16 invoiceId, uint256 amount, uint256 validBefore)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 nonce = _invoiceKey(merchantId, invoiceId);
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                _payer(),
                address(navy),
                amount,
                uint256(0),
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(payerPk, digest);
    }

    function _setup_merchant_relayer_funds() internal {
        vm.startPrank(owner);
        navy.registerMerchant(MID, merchantPayout);
        navy.setRelayer(relayer, true);
        vm.stopPrank();
        usdc.mint(_payer(), 1_000_000);
        vm.warp(1_700_000_000);
    }

    function test_payInvoice_splitsAndEmits() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"22222222222222222222222222222222");
        uint256 amount = 1_000_000; // 1 USDC
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(MID, invoiceId, amount, validBefore);

        vm.expectEmit(true, true, true, true);
        emit NavyPayments.InvoicePaid(MID, invoiceId, _payer(), amount, 10_000, block.timestamp);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, _payer(), v, r, s);

        assertEq(usdc.balanceOf(merchantPayout), 990_000);
        assertEq(usdc.balanceOf(treasury), 10_000);
        assertEq(usdc.balanceOf(_payer()), 0);
        assertTrue(navy.invoicePaid(_invoiceKey(MID, invoiceId)));
    }

    function test_payInvoice_zeroFeeWhenFeeBpsZero() public {
        vm.prank(owner);
        navy.setConfig(0, treasury);
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"33333333333333333333333333333333");
        uint256 amount = 500_000;
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(MID, invoiceId, amount, validBefore);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, _payer(), v, r, s);

        assertEq(usdc.balanceOf(merchantPayout), 500_000);
        assertEq(usdc.balanceOf(treasury), 0);
    }
```

- [ ] **Step 2: Run to verify it fails (payInvoice not defined)**

Run: `cd /home/khoa/Desktop/DATN/contract && forge test --match-test test_payInvoice_splitsAndEmits`
Expected: compilation error — member `payInvoice` not found on `NavyPayments`.

- [ ] **Step 3: Implement `payInvoice` in `NavyPayments.sol`**

Add this function to `contract/src/NavyPayments.sol` (after `setMerchantPayout`, before the closing brace):
```solidity
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
```

- [ ] **Step 4: Run the happy-path tests to verify they pass**

Run: `cd /home/khoa/Desktop/DATN/contract && forge test --match-test "test_payInvoice_splitsAndEmits|test_payInvoice_zeroFeeWhenFeeBpsZero" -vv`
Expected: both `[PASS]`. Merchant gets 990_000, treasury 10_000 (and 500_000/0 for the zero-fee case).

- [ ] **Step 5: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add contract/src/NavyPayments.sol contract/test/NavyPayments.t.sol && git commit -m "feat(contract): payInvoice pull-split-emit happy path"
```

---

### Task 5: `payInvoice` guards (replay, merchant, min amount, expiry, binding, relayer)

**Files:**
- Modify: `contract/test/NavyPayments.t.sol`

All behavior already exists in the contract from Task 4 + Task 3; these tests lock the invariants. No contract change is expected — if a test fails, fix the contract to satisfy it.

- [ ] **Step 1: Append the guard tests to `NavyPayments.t.sol`**

```solidity
    function test_payInvoice_onlyRelayer() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"44444444444444444444444444444444");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(MID, invoiceId, 500_000, validBefore);

        vm.expectRevert(NavyPayments.NotRelayer.selector);
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsReplay() public {
        _setup_merchant_relayer_funds();
        usdc.mint(_payer(), 1_000_000); // top up for the (never-completed) second attempt
        bytes16 invoiceId = bytes16(hex"55555555555555555555555555555555");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(MID, invoiceId, 500_000, validBefore);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);

        vm.prank(relayer);
        vm.expectRevert(NavyPayments.AlreadyPaid.selector);
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsInactiveMerchant() public {
        _setup_merchant_relayer_funds();
        vm.prank(owner);
        navy.setMerchantActive(MID, false);
        bytes16 invoiceId = bytes16(hex"66666666666666666666666666666666");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(MID, invoiceId, 500_000, validBefore);

        vm.prank(relayer);
        vm.expectRevert(NavyPayments.MerchantInactive.selector);
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsUnknownMerchant() public {
        _setup_merchant_relayer_funds();
        bytes16 unknown = bytes16(hex"99999999999999999999999999999999");
        bytes16 invoiceId = bytes16(hex"77777777777777777777777777777777");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(unknown, invoiceId, 500_000, validBefore);

        vm.prank(relayer);
        vm.expectRevert(NavyPayments.MerchantInactive.selector);
        navy.payInvoice(unknown, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsBelowMinimum() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"88888888888888888888888888888888");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(MID, invoiceId, 9_999, validBefore);

        vm.prank(relayer);
        vm.expectRevert(NavyPayments.AmountTooSmall.selector);
        navy.payInvoice(MID, invoiceId, 9_999, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsExpired() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(MID, invoiceId, 500_000, validBefore);

        vm.warp(validBefore + 1); // now past expiry
        vm.prank(relayer);
        vm.expectRevert(bytes("authorization expired"));
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsAmountTamper() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        uint256 validBefore = block.timestamp + 3600;
        // Sign for 500_000 but submit 900_000: USDC signature verification must reject.
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(MID, invoiceId, 500_000, validBefore);

        vm.prank(relayer);
        vm.expectRevert(bytes("invalid signature"));
        navy.payInvoice(MID, invoiceId, 900_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsWrongMerchantBinding() public {
        _setup_merchant_relayer_funds();
        bytes16 other = bytes16(hex"cccccccccccccccccccccccccccccccc");
        vm.prank(owner);
        navy.registerMerchant(other, address(0xABCD));
        bytes16 invoiceId = bytes16(hex"dddddddddddddddddddddddddddddddd");
        uint256 validBefore = block.timestamp + 3600;
        // Sign the authorization bound to `other`, but submit it against MID.
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(other, invoiceId, 500_000, validBefore);

        vm.prank(relayer);
        vm.expectRevert(bytes("invalid signature"));
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }
```

- [ ] **Step 2: Run the full unit suite**

Run: `cd /home/khoa/Desktop/DATN/contract && forge test --match-contract NavyPaymentsTest -vv`
Expected: every admin, happy-path, and guard test `[PASS]`. The tamper/binding tests revert inside `MockUSDC` with `invalid signature` (proving the nonce binds merchant+invoice+amount); expiry reverts with `authorization expired`.

- [ ] **Step 3: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add contract/test/NavyPayments.t.sol && git commit -m "test(contract): payInvoice replay/merchant/min/expiry/binding/relayer guards"
```

---

### Task 6: Fuzz tests (fee flooring + value conservation)

**Files:**
- Create: `contract/test/NavyPayments.fuzz.t.sol`

- [ ] **Step 1: Write the fuzz test**

Create `contract/test/NavyPayments.fuzz.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyPayments} from "../src/NavyPayments.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract NavyPaymentsFuzzTest is Test {
    NavyPayments navy;
    MockUSDC usdc;
    address owner = address(0x0111);
    address treasury = address(0x7EA5);
    address relayer = address(0x0333);
    address merchantPayout = address(0x0444);
    bytes16 constant MID = bytes16(hex"11111111111111111111111111111111");
    uint256 payerPk = 0xA11CE;

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(owner);
        navy = new NavyPayments(address(usdc), treasury, 100, owner);
        vm.startPrank(owner);
        navy.registerMerchant(MID, merchantPayout);
        navy.setRelayer(relayer, true);
        vm.stopPrank();
        vm.warp(1_700_000_000);
    }

    function _sign(bytes16 invoiceId, uint256 amount, uint256 validBefore)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 nonce = keccak256(abi.encodePacked(MID, invoiceId));
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                vm.addr(payerPk),
                address(navy),
                amount,
                uint256(0),
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(payerPk, digest);
    }

    /// @dev Fee floors and merchant+treasury exactly conserve the amount, for any valid amount.
    function testFuzz_splitConservesValue(uint256 amount, uint16 feeBps) public {
        amount = bound(amount, navy.MIN_INVOICE_AMOUNT(), 1_000_000_000_000); // 0.01 .. 1M USDC
        feeBps = uint16(bound(feeBps, 0, navy.MAX_FEE_BPS()));
        vm.prank(owner);
        navy.setConfig(feeBps, treasury);

        address payer = vm.addr(payerPk);
        usdc.mint(payer, amount);
        bytes16 invoiceId = bytes16(uint128(amount)); // unique per amount
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(invoiceId, amount, validBefore);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, payer, v, r, s);

        uint256 expectedFee = (amount * feeBps) / 10000;
        assertEq(usdc.balanceOf(treasury), expectedFee);
        assertEq(usdc.balanceOf(merchantPayout), amount - expectedFee);
        assertEq(usdc.balanceOf(merchantPayout) + usdc.balanceOf(treasury), amount);
    }
}
```

- [ ] **Step 2: Run the fuzz test**

Run: `cd /home/khoa/Desktop/DATN/contract && forge test --match-contract NavyPaymentsFuzzTest -vv`
Expected: `[PASS] testFuzz_splitConservesValue(uint256,uint16) (runs: 256, ...)`.

- [ ] **Step 3: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add contract/test/NavyPayments.fuzz.t.sol && git commit -m "test(contract): fuzz fee flooring + value conservation"
```

---

### Task 7: Sepolia-fork test against real Circle USDC

**Files:**
- Create: `contract/test/NavyPaymentsFork.t.sol`

- [ ] **Step 1: Write the fork test (auto-skips without `SEPOLIA_RPC_URL`)**

Create `contract/test/NavyPaymentsFork.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyPayments} from "../src/NavyPayments.sol";
import {IEIP3009} from "../src/interfaces/IEIP3009.sol";

/// @dev Exercises the REAL Circle USDC receiveWithAuthorization on a Sepolia fork.
/// Skips automatically when SEPOLIA_RPC_URL is not set.
contract NavyPaymentsForkTest is Test {
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    NavyPayments navy;
    address owner = address(0x0111);
    address treasury = address(0x7EA5);
    address relayer = address(0x0333);
    address merchantPayout = address(0x0444);
    bytes16 constant MID = bytes16(hex"11111111111111111111111111111111");
    uint256 payerPk = 0xA11CE;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        vm.prank(owner);
        navy = new NavyPayments(USDC, treasury, 100, owner);
        vm.startPrank(owner);
        navy.registerMerchant(MID, merchantPayout);
        navy.setRelayer(relayer, true);
        vm.stopPrank();
    }

    function _domainSeparator() internal view returns (bytes32) {
        // FiatTokenV2_2 exposes DOMAIN_SEPARATOR().
        (bool ok, bytes memory out) = USDC.staticcall(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        require(ok, "no DOMAIN_SEPARATOR");
        return abi.decode(out, (bytes32));
    }

    function test_fork_realUsdcReceiveWithAuthorization() public {
        if (address(navy) == address(0)) {
            emit log("SKIP: set SEPOLIA_RPC_URL to run the fork test");
            return;
        }
        address payer = vm.addr(payerPk);
        uint256 amount = 1_000_000;
        // Give the payer USDC by cheating balance via `deal` (works on forked ERC-20s).
        deal(USDC, payer, amount);

        bytes16 invoiceId = bytes16(hex"22222222222222222222222222222222");
        uint256 validBefore = block.timestamp + 3600;
        bytes32 nonce = keccak256(abi.encodePacked(MID, invoiceId));
        bytes32 typeHash = keccak256(
            "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );
        bytes32 structHash =
            keccak256(abi.encode(typeHash, payer, address(navy), amount, uint256(0), validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerPk, digest);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, payer, v, r, s);

        assertEq(IEIP3009(USDC).balanceOf(merchantPayout), 990_000);
        assertEq(IEIP3009(USDC).balanceOf(treasury), 10_000);
    }
}
```

- [ ] **Step 2: Run without an RPC (verifies clean skip)**

Run: `cd /home/khoa/Desktop/DATN/contract && forge test --match-contract NavyPaymentsForkTest -vv`
Expected: `[PASS]` with the `SKIP: set SEPOLIA_RPC_URL ...` log line (no fork attempted).

- [ ] **Step 3: (Optional, when an RPC is available) run against the fork**

Run: `cd /home/khoa/Desktop/DATN/contract && SEPOLIA_RPC_URL=<your-rpc> forge test --match-contract NavyPaymentsForkTest -vv`
Expected: `[PASS]` with merchant balance 990_000 and treasury 10_000 — proving the contract works against the real Circle USDC `receiveWithAuthorization` and confirming its EIP-712 domain matches our `keccak256(merchantId, invoiceId)` nonce scheme.

Note: if this reverts with `invalid signature`, the deployed USDC's EIP-712 domain `name`/`version` differs from our assumption — read `name()`/`version()` from the contract and this test's `_domainSeparator()` already sources the separator from chain, so a revert points to a `chainId`/`verifyingContract` mismatch to investigate before mainnet.

- [ ] **Step 4: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add contract/test/NavyPaymentsFork.t.sol && git commit -m "test(contract): Sepolia-fork test against real Circle USDC"
```

---

### Task 8: Deploy script + runbook

**Files:**
- Create: `contract/script/Deploy.s.sol`
- Create: `contract/README.md`

- [ ] **Step 1: Write the deploy script**

Create `contract/script/Deploy.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {NavyPayments} from "../src/NavyPayments.sol";

/// @dev Deploys NavyPayments and allowlists the relayer. Env-driven.
contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("NAVY_USDC_ADDRESS");
        address treasury = vm.envAddress("NAVY_TREASURY_ADDRESS");
        address ownerAddr = vm.envAddress("NAVY_OWNER_ADDRESS");
        address relayer = vm.envAddress("NAVY_RELAYER_ADDRESS");
        uint16 feeBps = uint16(vm.envUint("NAVY_FEE_BPS"));

        vm.startBroadcast(deployerPk);
        NavyPayments navy = new NavyPayments(usdc, treasury, feeBps, ownerAddr);
        // If the deployer is the owner, allowlist the relayer in the same run.
        if (vm.addr(deployerPk) == ownerAddr) {
            navy.setRelayer(relayer, true);
        }
        vm.stopBroadcast();

        console2.log("NavyPayments deployed at:", address(navy));
        console2.log("owner:", ownerAddr);
        console2.log("relayer allowlisted:", vm.addr(deployerPk) == ownerAddr);
    }
}
```

- [ ] **Step 2: Verify the script compiles**

Run: `cd /home/khoa/Desktop/DATN/contract && forge build`
Expected: success, `Deploy` among compiled contracts.

- [ ] **Step 3: Write the runbook**

Create `contract/README.md`:
```markdown
# NavyPayments (EVM)

EIP-3009 gasless invoice payments on Ethereum Sepolia. Replaces the Anchor `navy_payments` program. See `docs/superpowers/specs/2026-07-17-navy-evm-migration-design.md`.

## Build & test

```bash
forge build
forge test                 # unit + fuzz; fork test auto-skips
SEPOLIA_RPC_URL=<rpc> forge test   # also runs the real-USDC fork test
forge fmt                  # format
```

## Deploy to Sepolia

1. `cp .env.example .env` and fill `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `NAVY_TREASURY_ADDRESS`, `NAVY_OWNER_ADDRESS`, `NAVY_RELAYER_ADDRESS` (keep `NAVY_USDC_ADDRESS` = Circle Sepolia USDC).
2. Fund the deployer and relayer EOAs with Sepolia ETH.
3. Deploy:
   ```bash
   source .env
   forge script script/Deploy.s.sol:Deploy --rpc-url sepolia --broadcast --verify
   ```
4. Record the printed `NavyPayments deployed at:` address → set it as `NAVY_PAYMENTS_ADDRESS` for the backend (Plan 2).
5. If the deployer is NOT the owner, have the owner call `setRelayer(relayerAddr, true)` before payments can be relayed.

## Admin ops (owner)

`registerMerchant(bytes16 merchantId, address payout)` is called by the backend on merchant approval; `merchantId` is the 16-byte id derived from the merchant DB uuid. Also: `setMerchantActive`, `setMerchantPayout`, `setConfig(feeBps, treasury)`, `setRelayer`.

## Mainnet gates

Professional audit; owner → multisig/timelock; relayer/owner keys → KMS/HSM. See spec §9.
```

- [ ] **Step 4: Final full-suite run**

Run: `cd /home/khoa/Desktop/DATN/contract && forge test -vv`
Expected: all unit, fuzz, and fork-skip tests `[PASS]`.

- [ ] **Step 5: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add contract/script/Deploy.s.sol contract/README.md && git commit -m "feat(contract): deploy script + runbook"
```

---

## Self-Review Notes

- **Spec coverage (§3):** state/config/merchant admin (Task 3), `payInvoice` split + `InvoicePaid` (Task 4), all guards incl. `receiveWithAuthorization` `msg.sender==to` and nonce binding (Task 5), fuzz fee flooring (Task 6), real-USDC fork (Task 7), relayer gating (Task 3/5), deploy/admin (Task 8). `MAX_FEE_BPS`, `MIN_INVOICE_AMOUNT`, and the event shape all match the spec.
- **Deferred to later plans (by design):** the backend ethers layer + EIP-712 endpoints (Plan 2), farming (Plan 3), frontends (Plan 4). The `bytes16 merchantId` ↔ DB-uuid derivation is exercised on-chain here and consumed by Plan 2.
- **Type consistency:** the EIP-3009 typehash string, the `keccak256(abi.encodePacked(merchantId, invoiceId))` nonce, and the `ReceiveWithAuthorization` field order are identical across `MockUSDC`, every test signer, and the fork test.
- **Known placeholder addresses:** test files use `address(0xMEC)` etc. — Foundry accepts these `0x`-prefixed hex literals; they are deterministic test fixtures, not production values.
```
