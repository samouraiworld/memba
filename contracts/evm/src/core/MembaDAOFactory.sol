// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

import { MembaDAO } from "./MembaDAO.sol";

/**
 * @title MembaDAOFactory
 * @author Samouraï Coop
 * @notice Deploys new MembaDAO instances behind UUPS proxies via CREATE2.
 *         Deterministic addresses enable off-chain pre-computation of DAO addresses.
 * @dev Non-upgradeable by design (see DECISIONS.md): it holds no funds and no per-DAO
 *      authority, and CREATE2 pre-computation of DAO addresses depends on this factory's
 *      address staying fixed. The one "upgrade" it needs — swapping the DAO template — is
 *      served by `setImplementation` without proxying the factory. Ownership is the Safe via
 *      a two-step handover (C-4); `setImplementation` is `onlyOwner`, so until the Safe
 *      accepts, a compromised deployer key could repoint the template used by future DAOs.
 *      See DEPLOY_CEREMONY.md step 3.
 */
contract MembaDAOFactory is Ownable2Step {
    // ── Storage
    // ───────────────────────────────────────────────────
    address public daoImplementation;
    uint256 public daoCount;
    mapping(uint256 => address) public daos;

    // ── Events
    // ────────────────────────────────────────────────────
    event DAOCreated(uint256 indexed daoId, address indexed daoAddress, address indexed creator, string name);
    event ImplementationUpdated(address indexed oldImpl, address indexed newImpl);

    // ── Errors
    // ────────────────────────────────────────────────────
    error InvalidImplementation();
    error DeploymentFailed();
    error OwnershipCannotBeRenounced();

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

    /// @notice Total DAOs deployed (spec-named accessor; alias of the `daoCount` var).
    function getDaoCount() external view returns (uint256) {
        return daoCount;
    }

    /// @notice DAO address by index (spec-named accessor; alias of the `daos` mapping).
    function getDao(uint256 id) external view returns (address) {
        return daos[id];
    }

    /// @dev Ownership may be rotated (two-step) but never destroyed: renouncing to the zero
    ///      address would freeze `setImplementation` forever, permanently pinning the DAO
    ///      template. Mirrors MembaUpgradeAuthority, which has no renounce path.
    function renounceOwnership() public view override onlyOwner {
        revert OwnershipCannotBeRenounced();
    }

    /// @notice Returns the contract version.
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
