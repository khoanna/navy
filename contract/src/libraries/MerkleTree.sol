// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library MerkleTree {
    function verifyProof(
        bytes32 leaf,
        bytes32[] memory proof,
        bytes32 root
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = computedHash < proof[i]
                ? keccak256(abi.encodePacked(computedHash, proof[i]))
                : keccak256(abi.encodePacked(proof[i], computedHash));
        }
        return computedHash == root;
    }

    function computeRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        if (leaves.length == 0) return bytes32(0);
        if (leaves.length == 1) return leaves[0];
        uint256 n = leaves.length;
        while (n > 1) {
            uint256 k = (n + 1) / 2;
            for (uint256 i = 0; i < k; i++) {
                uint256 j = i * 2;
                if (j + 1 < n) {
                    // Sort the pair to match verifyProof behavior
                    leaves[i] = leaves[j] < leaves[j + 1]
                        ? keccak256(abi.encodePacked(leaves[j], leaves[j + 1]))
                        : keccak256(abi.encodePacked(leaves[j + 1], leaves[j]));
                } else {
                    leaves[i] = leaves[j];
                }
            }
            n = k;
        }
        return leaves[0];
    }
}
