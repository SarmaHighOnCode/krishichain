// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ActorRegistry
 * @notice Who is allowed to claim what. Every actor in the supply chain — farmer,
 *         aggregator, transporter, processor, retailer, auditor — is an address with a role.
 * @dev Ticket S1-03. The point of this contract is attribution: KrishiChain cannot make a
 *      party honest, but it can make every claim non-repudiably theirs (PRD §3).
 */
contract ActorRegistry is AccessControl {
    bytes32 public constant COMMISSIONER_ROLE = keccak256("COMMISSIONER");
    bytes32 public constant FARMER_ROLE = keccak256("FARMER");
    bytes32 public constant AGGREGATOR_ROLE = keccak256("AGGREGATOR");
    bytes32 public constant TRANSPORTER_ROLE = keccak256("TRANSPORTER");
    bytes32 public constant PROCESSOR_ROLE = keccak256("PROCESSOR");
    bytes32 public constant RETAILER_ROLE = keccak256("RETAILER");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR");

    struct Actor {
        string name;
        bytes32 role;
        uint64 registeredAt;
        bool active;
    }

    mapping(address => Actor) private _actors;
    address[] private _actorList;

    event ActorRegistered(address indexed actor, bytes32 indexed role, string name);
    event ActorRevoked(address indexed actor, uint64 at);

    error ActorAlreadyRegistered(address actor);
    error ActorNotRegistered(address actor);
    error EmptyName();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMMISSIONER_ROLE, admin);
    }

    /// @notice Register a supply-chain participant and grant them their role.
    function registerActor(address actor, bytes32 role, string calldata name)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (_actors[actor].registeredAt != 0) revert ActorAlreadyRegistered(actor);
        if (bytes(name).length == 0) revert EmptyName();

        _actors[actor] = Actor({name: name, role: role, registeredAt: uint64(block.timestamp), active: true});
        _actorList.push(actor);
        _grantRole(role, actor);

        emit ActorRegistered(actor, role, name);
    }

    /// @notice Deactivate an actor. History stays; future claims stop.
    function revokeActor(address actor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Actor storage record = _actors[actor];
        if (record.registeredAt == 0) revert ActorNotRegistered(actor);

        record.active = false;
        _revokeRole(record.role, actor);

        emit ActorRevoked(actor, uint64(block.timestamp));
    }

    function getActor(address actor) external view returns (Actor memory) {
        return _actors[actor];
    }

    function isActive(address actor) external view returns (bool) {
        return _actors[actor].active;
    }

    function actorCount() external view returns (uint256) {
        return _actorList.length;
    }

    function actorAt(uint256 index) external view returns (address) {
        return _actorList[index];
    }
}
