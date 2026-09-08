// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ActorRegistry} from "./ActorRegistry.sol";

/**
 * @title DeviceRegistry
 * @notice The allowlist of commissioned sensor nodes. A device that is not here cannot
 *         inject data into the system (ARCHITECTURE §2.3, step 2).
 * @dev Ticket S1-03.
 *
 *      The important design choice is that revocation is BLOCK-SCOPED, not a boolean.
 *      If a node's key is extracted on Tuesday, records it signed on Monday are still
 *      genuine and records signed on Wednesday are not. A plain `bool active` forces you
 *      to either invalidate the device's entire history or none of it, and both answers
 *      are wrong. Hence `isActiveAt(device, blockNumber)`.
 */
contract DeviceRegistry {
    struct Device {
        /// @dev The actor accountable for this node.
        address owner;
        /// @dev Device class, e.g. keccak256("TRANSIT_V1").
        bytes32 class_;
        /// @dev Digest of the commissioning payload: pubkey, firmware hash, calibration, seal ID.
        bytes32 metaHash;
        uint64 commissionedBlock;
        /// @dev 0 means never revoked.
        uint64 revokedBlock;
    }

    ActorRegistry public immutable actors;

    mapping(address => Device) private _devices;
    address[] private _deviceList;

    event DeviceRegistered(
        address indexed device, address indexed owner, bytes32 indexed class_, bytes32 metaHash
    );
    event DeviceRevoked(address indexed device, uint64 atBlock, bytes32 reason);

    error NotCommissioner(address caller);
    error DeviceAlreadyRegistered(address device);
    error DeviceNotRegistered(address device);
    error DeviceAlreadyRevoked(address device);
    error ZeroAddress();

    constructor(ActorRegistry actors_) {
        actors = actors_;
    }

    modifier onlyCommissioner() {
        if (!actors.hasRole(actors.COMMISSIONER_ROLE(), msg.sender)) revert NotCommissioner(msg.sender);
        _;
    }

    /**
     * @notice Commission a node.
     * @param device The 20-byte address derived on-device as keccak256(pubkey[1:])[12:].
     * @param metaHash Digest of the commissioning payload (PROTOCOL.md §5) — binds the
     *        firmware hash, calibration record and physical seal ID to this device.
     */
    function registerDevice(address device, bytes32 class_, bytes32 metaHash)
        external
        onlyCommissioner
    {
        if (device == address(0)) revert ZeroAddress();
        if (_devices[device].commissionedBlock != 0) revert DeviceAlreadyRegistered(device);

        _devices[device] = Device({
            owner: msg.sender,
            class_: class_,
            metaHash: metaHash,
            commissionedBlock: uint64(block.number),
            revokedBlock: 0
        });
        _deviceList.push(device);

        emit DeviceRegistered(device, msg.sender, class_, metaHash);
    }

    /// @notice Revoke a device from this block onward. Earlier records remain valid.
    function revokeDevice(address device, bytes32 reason) external onlyCommissioner {
        Device storage record = _devices[device];
        if (record.commissionedBlock == 0) revert DeviceNotRegistered(device);
        if (record.revokedBlock != 0) revert DeviceAlreadyRevoked(device);

        record.revokedBlock = uint64(block.number);
        emit DeviceRevoked(device, uint64(block.number), reason);
    }

    /**
     * @notice Was this device trusted at `blockNumber`?
     * @dev This is the function the gateway calls before accepting a record, and the one an
     *      auditor calls when re-checking history years later.
     */
    function isActiveAt(address device, uint256 blockNumber) external view returns (bool) {
        Device memory record = _devices[device];
        if (record.commissionedBlock == 0) return false;
        if (blockNumber < record.commissionedBlock) return false;
        if (record.revokedBlock != 0 && blockNumber >= record.revokedBlock) return false;
        return true;
    }

    function isActive(address device) external view returns (bool) {
        Device memory record = _devices[device];
        return record.commissionedBlock != 0 && record.revokedBlock == 0;
    }

    function getDevice(address device) external view returns (Device memory) {
        return _devices[device];
    }

    function deviceCount() external view returns (uint256) {
        return _deviceList.length;
    }

    function deviceAt(uint256 index) external view returns (address) {
        return _deviceList[index];
    }
}
