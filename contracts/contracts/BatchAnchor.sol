// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {ActorRegistry} from "./ActorRegistry.sol";

/**
 * @title BatchAnchor
 * @notice One 32-byte commitment per 256+ sensor readings. This contract is why the
 *         product is affordable: anchoring is O(1) in leaf count, so tracing a crate costs
 *         about ₹1 instead of ₹260 (ADR-0003, PRD §10.2).
 * @dev Ticket S1-04.
 *
 *      Anchors chain to each other via `prevRoot`, so a gateway operator cannot quietly
 *      omit an entire batch — a missing anchor is as visible as a missing record is in the
 *      per-device hash chain, one level up.
 *
 *      GAS DESIGN (SC-06). Only the root is stored. `prevRoot` is checked but not written
 *      (it is already `_roots[i-1]`), and `leafCount`/`timestamp` live in the event rather
 *      than in storage, because neither is needed to verify a proof — verification needs
 *      the root and nothing else. Indexers and the gateway read the rest from logs. That is
 *      the difference between one new storage slot and three, and it is what keeps a live
 *      measured `anchor()` at ~53k gas instead of ~97k.
 */
contract BatchAnchor {
    bytes32 public constant ANCHOR_ROLE = keccak256("ANCHOR");

    ActorRegistry public immutable actors;

    /// @dev Index i is the root of batch i. The array order IS the anchor chain.
    bytes32[] private _roots;

    event Anchored(
        uint256 indexed index,
        bytes32 indexed root,
        bytes32 indexed prevRoot,
        uint32 leafCount,
        uint64 timestamp
    );

    error NotAnchorer(address caller);
    error EmptyBatch();
    error PrevRootMismatch(bytes32 expected, bytes32 provided);
    error NoSuchAnchor(uint256 index);

    constructor(ActorRegistry actors_) {
        actors = actors_;
    }

    /**
     * @notice Commit a Merkle root covering `leafCount` record digests.
     * @param prevRoot Root of the previous anchor, or bytes32(0) for the first. Checked,
     *        not stored — the check is what makes a dropped batch detectable.
     * @return index Position of this anchor, referenced by every inclusion proof in the batch.
     */
    function anchor(bytes32 root, uint32 leafCount, bytes32 prevRoot)
        external
        returns (uint256 index)
    {
        if (!actors.hasRole(ANCHOR_ROLE, msg.sender)) revert NotAnchorer(msg.sender);
        if (leafCount == 0) revert EmptyBatch();

        index = _roots.length;
        bytes32 expected = index == 0 ? bytes32(0) : _roots[index - 1];
        if (prevRoot != expected) revert PrevRootMismatch(expected, prevRoot);

        _roots.push(root);

        emit Anchored(index, root, prevRoot, leafCount, uint64(block.timestamp));
    }

    /**
     * @notice Verify that `leaf` was included in the batch at `index`.
     * @dev Sorted-pair keccak256 via OpenZeppelin, matching packages/core/src/merkle.ts and
     *      the browser-side verification. All three must agree or the demo's headline claim
     *      falls apart (PROTOCOL.md §4).
     */
    function verifyInclusion(uint256 index, bytes32 leaf, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        if (index >= _roots.length) revert NoSuchAnchor(index);
        return MerkleProof.verify(proof, _roots[index], leaf);
    }

    function getRoot(uint256 index) external view returns (bytes32) {
        if (index >= _roots.length) revert NoSuchAnchor(index);
        return _roots[index];
    }

    function latestRoot() external view returns (bytes32) {
        uint256 count = _roots.length;
        return count == 0 ? bytes32(0) : _roots[count - 1];
    }

    function anchorCount() external view returns (uint256) {
        return _roots.length;
    }
}
