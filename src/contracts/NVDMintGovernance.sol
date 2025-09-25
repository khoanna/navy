// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./NVDToken.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract NVDMintGovernance is Ownable {
    NVDToken public nvd;

    address public navy;
    address public bank;

    struct MintRequest {
        uint256 id;
        address to;
        uint256 amountSmallest;
        bool navyConfirm;
        bool bankConfirm;
        bool minted;
    }

    MintRequest[] public requests;

    event MintRequestCreated(
        uint256 indexed id,
        address indexed to,
        uint256 amountSmallest
    );
    event MintConfirmedByNavy(uint256 indexed id);
    event MintConfirmedByBank(uint256 indexed id);
    event MintExecuted(
        uint256 indexed id,
        address indexed to,
        uint256 amountSmallest
    );
    event MintRequestCancelled(uint256 indexed id);

    constructor(
        address _nvd,
        address _navy,
        address _bank
    ) Ownable(msg.sender) {
        require(_nvd != address(0), "nvd zero");
        require(_navy != address(0), "navy zero");
        require(_bank != address(0), "bank zero");

        nvd = NVDToken(_nvd);
        navy = _navy;
        bank = _bank;
    }

    function setNavy(address _navy) external onlyOwner {
        require(_navy != address(0), "zero");
        navy = _navy;
    }

    function setBank(address _bank) external onlyOwner {
        require(_bank != address(0), "zero");
        bank = _bank;
    }

    modifier onlyNavy() {
        require(msg.sender == navy, "Not navy");
        _;
    }

    modifier onlyBank() {
        require(msg.sender == bank, "Not bank");
        _;
    }

    modifier onlyBankOrNavy() {
        require(msg.sender == bank || msg.sender == navy, "Not bank or navy");
        _;
    }

    function createMintRequest(
        address to,
        uint256 amountSmallest
    ) external onlyBankOrNavy returns (uint256) {
        require(to != address(0), "to zero");
        require(amountSmallest > 0, "Invalid amount");

        requests.push(
            MintRequest({
                id: 0,
                to: to,
                amountSmallest: amountSmallest,
                navyConfirm: false,
                bankConfirm: false,
                minted: false
            })
        );
        uint256 id = requests.length - 1;
        requests[id].id = id;

        emit MintRequestCreated(id, to, amountSmallest);
        return id;
    }

    function confirmByNavy(uint256 id) external onlyNavy {
        require(id < requests.length, "Invalid id");
        MintRequest storage r = requests[id];
        require(!r.minted, "Already minted");
        r.navyConfirm = true;
        emit MintConfirmedByNavy(id);

        if (r.bankConfirm) _executeMint(id);
    }

    function confirmByBank(uint256 id) external onlyBank {
        require(id < requests.length, "Invalid id");
        MintRequest storage r = requests[id];
        require(!r.minted, "Already minted");
        r.bankConfirm = true;
        emit MintConfirmedByBank(id);

        if (r.navyConfirm) _executeMint(id);
    }

    function _executeMint(uint256 id) internal {
        MintRequest storage r = requests[id];
        require(!r.minted, "Already minted");
        require(r.navyConfirm && r.bankConfirm, "Not fully confirmed");

        r.minted = true;

        nvd.mint(r.to, r.amountSmallest);

        emit MintExecuted(id, r.to, r.amountSmallest);
    }

    function cancelRequest(uint256 id) external onlyBankOrNavy {
        require(id < requests.length, "Invalid id");
        MintRequest storage r = requests[id];
        require(!r.minted, "Already minted");
        r.minted = true;
        emit MintRequestCancelled(id);
    }

    function getNeedNavyConfirm()
        public
        view
        onlyNavy
        returns (MintRequest[] memory)
    {
        uint256 count = 0;
        for (uint256 i = 0; i < requests.length; i++) {
            if (!requests[i].navyConfirm && !requests[i].minted) {
                count++;
            }
        }
        MintRequest[] memory pending = new MintRequest[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < requests.length; i++) {
            if (!requests[i].navyConfirm && !requests[i].minted) {
                pending[index] = requests[i];
                index++;
            }
        }

        return pending;
    }

    function getNeedBankConfirm()
        public
        view
        onlyBank
        returns (MintRequest[] memory)
    {
        uint256 count = 0;
        for (uint256 i = 0; i < requests.length; i++) {
            if (!requests[i].bankConfirm && !requests[i].minted) {
                count++;
            }
        }
        MintRequest[] memory pending = new MintRequest[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < requests.length; i++) {
            if (!requests[i].bankConfirm && !requests[i].minted) {
                pending[index] = requests[i];
                index++;
            }
        }

        return pending;
    }

    function totalRequests() external view returns (uint256) {
        return requests.length;
    }
}
