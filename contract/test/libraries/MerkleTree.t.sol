// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MerkleTree} from "../../src/libraries/MerkleTree.sol";

contract MerkleTreeTest is Test {
    // Helper to compute sorted hash of two nodes
    function sortedHash(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    function test_verifyProof_singleNode() public {
        bytes32 leaf = keccak256("leaf");
        bytes32[] memory proof = new bytes32[](0);
        bool result = MerkleTree.verifyProof(leaf, proof, leaf);
        assertTrue(result);
    }

    function test_verifyProof_twoLeaves() public {
        bytes32 leaf0 = keccak256("leaf0");
        bytes32 leaf1 = keccak256("leaf1");
        // Note: verifyProof sorts pair order, so root uses sorted hash
        bytes32 root = sortedHash(leaf0, leaf1);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf1;
        bool result = MerkleTree.verifyProof(leaf0, proof, root);
        assertTrue(result);
    }

    function test_verifyProof_invalidProof() public {
        bytes32 leaf = keccak256("leaf");
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256("wrong");
        bool result = MerkleTree.verifyProof(leaf, proof, keccak256("different"));
        assertFalse(result);
    }

    function test_verifyProof_threeLeaves() public {
        bytes32 l0 = keccak256("leaf0");
        bytes32 l1 = keccak256("leaf1");
        bytes32 l2 = keccak256("leaf2");
        // l0 < l1 < l2, so sorted pairs: (l0,l1), (h01,l2)
        bytes32 h01 = sortedHash(l0, l1);
        bytes32 root = sortedHash(h01, l2);

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = l1;
        proof[1] = l2;

        bool result = MerkleTree.verifyProof(l0, proof, root);
        assertTrue(result);
    }

    function test_verifyProof_fourLeaves() public {
        bytes32 l0 = keccak256("leaf0");
        bytes32 l1 = keccak256("leaf1");
        bytes32 l2 = keccak256("leaf2");
        bytes32 l3 = keccak256("leaf3");

        bytes32 h01 = sortedHash(l0, l1);
        bytes32 h23 = sortedHash(l2, l3);
        bytes32 root = sortedHash(h01, h23);

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = l1;
        proof[1] = h23;

        bool result = MerkleTree.verifyProof(l0, proof, root);
        assertTrue(result);
    }

    function test_verifyProof_leafOnRight() public {
        bytes32 leaf0 = keccak256("left");
        bytes32 leaf1 = keccak256("right");
        // leaf0 < leaf1, so root uses sorted hash
        bytes32 root = sortedHash(leaf0, leaf1);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf1;

        bool result = MerkleTree.verifyProof(leaf0, proof, root);
        assertTrue(result);
    }

    function test_verifyProof_leafOnRightSwapOrder() public {
        bytes32 leaf0 = keccak256("zzz");
        bytes32 leaf1 = keccak256("aaa");
        // leaf1 < leaf0, so root uses sorted hash
        bytes32 root = sortedHash(leaf1, leaf0);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf1;

        bool result = MerkleTree.verifyProof(leaf0, proof, root);
        assertTrue(result);
    }

    function test_verifyProof_wrongLeaf() public {
        bytes32 leaf0 = keccak256("leaf0");
        bytes32 leaf1 = keccak256("leaf1");
        bytes32 root = sortedHash(leaf0, leaf1);

        bytes32 wrongLeaf = keccak256("wrong");
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf1;

        bool result = MerkleTree.verifyProof(wrongLeaf, proof, root);
        assertFalse(result);
    }

    function test_computeRoot_empty() public {
        bytes32[] memory leaves = new bytes32[](0);
        bytes32 root = MerkleTree.computeRoot(leaves);
        assertEq(root, bytes32(0));
    }

    function test_computeRoot_singleLeaf() public {
        bytes32 leaf = keccak256("single");
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = leaf;
        bytes32 root = MerkleTree.computeRoot(leaves);
        assertEq(root, leaf);
    }

    function test_computeRoot_twoLeaves() public {
        bytes32 leaf0 = keccak256("leaf0");
        bytes32 leaf1 = keccak256("leaf1");
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = leaf0;
        leaves[1] = leaf1;

        bytes32 expectedRoot = sortedHash(leaf0, leaf1);
        bytes32 root = MerkleTree.computeRoot(leaves);
        assertEq(root, expectedRoot);
    }

    function test_computeRoot_threeLeaves() public {
        bytes32 l0 = keccak256("leaf0");
        bytes32 l1 = keccak256("leaf1");
        bytes32 l2 = keccak256("leaf2");
        bytes32[] memory leaves = new bytes32[](3);
        leaves[0] = l0;
        leaves[1] = l1;
        leaves[2] = l2;

        bytes32 h01 = sortedHash(l0, l1);
        bytes32 expectedRoot = sortedHash(h01, l2);

        bytes32 root = MerkleTree.computeRoot(leaves);
        assertEq(root, expectedRoot);
    }

    function test_computeRoot_fourLeaves() public {
        bytes32 l0 = keccak256("leaf0");
        bytes32 l1 = keccak256("leaf1");
        bytes32 l2 = keccak256("leaf2");
        bytes32 l3 = keccak256("leaf3");
        bytes32[] memory leaves = new bytes32[](4);
        leaves[0] = l0;
        leaves[1] = l1;
        leaves[2] = l2;
        leaves[3] = l3;

        bytes32 h01 = sortedHash(l0, l1);
        bytes32 h23 = sortedHash(l2, l3);
        bytes32 expectedRoot = sortedHash(h01, h23);

        bytes32 root = MerkleTree.computeRoot(leaves);
        assertEq(root, expectedRoot);
    }

    function test_computeRoot_fiveLeaves() public {
        bytes32 l0 = keccak256("leaf0");
        bytes32 l1 = keccak256("leaf1");
        bytes32 l2 = keccak256("leaf2");
        bytes32 l3 = keccak256("leaf3");
        bytes32 l4 = keccak256("leaf4");
        bytes32[] memory leaves = new bytes32[](5);
        leaves[0] = l0;
        leaves[1] = l1;
        leaves[2] = l2;
        leaves[3] = l3;
        leaves[4] = l4;

        // Tree structure for 5 leaves:
        // Round 1: h0=sorted(l0,l1), h1=sorted(l2,l3), h2=l4
        // Round 2: h0=sorted(h0,h1), h1=h2
        // Round 3: root=sorted(h0,h1)
        bytes32 h01 = sortedHash(l0, l1);
        bytes32 h23 = sortedHash(l2, l3);
        bytes32 h0123 = sortedHash(h01, h23);
        bytes32 expectedRoot = sortedHash(h0123, l4);

        bytes32 root = MerkleTree.computeRoot(leaves);
        assertEq(root, expectedRoot);
    }

    function test_verifyProof_and_computeRoot_consistency() public {
        // Use values we know are in ascending order
        bytes32 l0 = bytes32(uint256(1));
        bytes32 l1 = bytes32(uint256(2));
        bytes32 l2 = bytes32(uint256(3));
        bytes32 l3 = bytes32(uint256(4));

        bytes32[] memory leaves = new bytes32[](4);
        leaves[0] = l0;
        leaves[1] = l1;
        leaves[2] = l2;
        leaves[3] = l3;

        bytes32 root = MerkleTree.computeRoot(leaves);

        // Build proofs for each leaf using sorted hashing
        bytes32 h23 = sortedHash(l2, l3);
        bytes32 h01 = sortedHash(l0, l1);

        bytes32[] memory proof0 = new bytes32[](2);
        proof0[0] = l1;
        proof0[1] = h23;

        bytes32[] memory proof1 = new bytes32[](2);
        proof1[0] = l0;
        proof1[1] = h23;

        bytes32[] memory proof2 = new bytes32[](2);
        proof2[0] = l3;
        proof2[1] = h01;

        bytes32[] memory proof3 = new bytes32[](2);
        proof3[0] = l2;
        proof3[1] = h01;

        assertTrue(MerkleTree.verifyProof(l0, proof0, root));
        assertTrue(MerkleTree.verifyProof(l1, proof1, root));
        assertTrue(MerkleTree.verifyProof(l2, proof2, root));
        assertTrue(MerkleTree.verifyProof(l3, proof3, root));
    }

    function test_verifyProof_emptyProofSingleNode() public {
        bytes32 leaf = keccak256("single");

        bytes32[] memory emptyProof = new bytes32[](0);
        assertTrue(MerkleTree.verifyProof(leaf, emptyProof, leaf));
        assertFalse(MerkleTree.verifyProof(leaf, emptyProof, bytes32(0)));
    }

    function test_verifyProof_eightLeaves() public {
        bytes32[8] memory leaves;
        leaves[0] = keccak256("leaf0");
        leaves[1] = keccak256("leaf1");
        leaves[2] = keccak256("leaf2");
        leaves[3] = keccak256("leaf3");
        leaves[4] = keccak256("leaf4");
        leaves[5] = keccak256("leaf5");
        leaves[6] = keccak256("leaf6");
        leaves[7] = keccak256("leaf7");

        bytes32[] memory leafArray = new bytes32[](8);
        for (uint256 i = 0; i < 8; i++) {
            leafArray[i] = leaves[i];
        }

        bytes32 root = MerkleTree.computeRoot(leafArray);

        // Build proof for leaf[3] (index 3)
        // Level 1: h01=h(0,1), h23=h(2,3), h45=h(4,5), h67=h(6,7)
        // Level 2: h0123=h(h01,h23), h4567=h(h45,h67)
        // Level 3: root=h(h0123,h4567)
        bytes32 h01 = sortedHash(leaves[0], leaves[1]);
        bytes32 h23 = sortedHash(leaves[2], leaves[3]);
        bytes32 h45 = sortedHash(leaves[4], leaves[5]);
        bytes32 h67 = sortedHash(leaves[6], leaves[7]);
        bytes32 h0123 = sortedHash(h01, h23);
        bytes32 h4567 = sortedHash(h45, h67);

        bytes32[] memory proof = new bytes32[](3);
        proof[0] = leaves[2]; // sibling at level 1
        proof[1] = h01;       // sibling at level 2
        proof[2] = h4567;     // sibling at level 3

        bool result = MerkleTree.verifyProof(leaves[3], proof, root);
        assertTrue(result);
    }
}
