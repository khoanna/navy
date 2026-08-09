// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal EIP-3009 token mirroring Circle Sepolia USDC (name "USDC", version "2")
/// for local tests. Uses plain ecrecover (mirrors Circle's FiatTokenV2), so a 7702 account signer works.
contract MockUSDC {
    string public constant name = "USDC";
    string public constant version = "2";
    uint8 public constant decimals = 6;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event Approval(address indexed owner, address indexed spender, uint256 value);

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

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= value, "insufficient allowance");
            allowance[from][msg.sender] -= value;
        }
        _transfer(from, to, value);
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
        require(ecrecover(digest, v, r, s) == from, "invalid authorization signature");

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
