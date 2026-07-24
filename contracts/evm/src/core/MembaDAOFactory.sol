// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { MembaDAO } from "./MembaDAO.sol";

/**
 * @title MembaDAOFactory
 * @author Samouraï Coop
 * @notice Deploys new MembaDAO instances behind UUPS proxies via CREATE2.
 *         Deterministic addresses enable off-chain pre-computation of DAO addresses.
 *
 * TODO: Implement per docs/evm-migration/CONTRACT_SPECS/MembaDAO.spec.md (factory section)
 */
contract MembaDAOFactory is Ownable {
    // ── Storage ───────────────────────────────────────────────────
    address public daoImplementation;
    uint256 public daoCount;
    mapping(uint256 => address) public daos;

    // ── Events ────────────────────────────────────────────────────
    event DAOCreated(uint256 indexed daoId, address indexed daoAddress, address indexed creator, string name);
    event ImplementationUpdated(address indexed oldImpl, address indexed newImpl);

    // ── Errors ────────────────────────────────────────────────────
    error InvalidImplementation();
    error DeploymentFailed();

    constructor(address _daoImplementation) Ownable(msg.sender) {
        if (_daoImplementation == address(0)) revert InvalidImplementation();
        daoImplementation = _daoImplementation;
    }

    /**
     * @notice Deploy a new MembaDAO behind a UUPS proxy.
     * @param name DAO name
     * @param description DAO description
     * @param admin Initial admin address
     * @param salt CREATE2 salt for deterministic addressing
     * @return dao The address of the newly deployed DAO proxy
     */
    function createDAO(string calldata name, string calldata description, address admin, bytes32 salt)
        external
        returns (address dao)
    {
        bytes memory initData = abi.encodeCall(MembaDAO.initialize, (name, description, admin));

        dao = address(new ERC1967Proxy{ salt: salt }(daoImplementation, initData));

        uint256 id = daoCount++;
        daos[id] = dao;

        emit DAOCreated(id, dao, msg.sender, name);
    }

    /// @notice Update the DAO implementation (for new DAOs only — existing DAOs upgrade independently).
    function setImplementation(address _newImplementation) external onlyOwner {
        if (_newImplementation == address(0)) revert InvalidImplementation();
        address old = daoImplementation;
        daoImplementation = _newImplementation;
        emit ImplementationUpdated(old, _newImplementation);
    }

    /// @notice Returns the contract version.
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
