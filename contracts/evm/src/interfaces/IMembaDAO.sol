// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IMembaDAO
 * @author Samouraï Coop
 * @notice The subset of MembaDAO that peer contracts depend on.
 * @dev Consolidated from per-contract local declarations (C-7): MembaCandidature declared its
 *      own `IMembaDAO` and MembaChannels its own `IMembaDAOMember`, each redeclaring
 *      `isMember`. Two hand-copied declarations of one on-chain signature drift; this is the
 *      single source. `MembaChannels` uses only `isMember` — the superset is harmless.
 */
interface IMembaDAO {
    function isMember(address addr) external view returns (bool);
    function addMember(address member, uint256 votingPower, string[] calldata roles) external;
}
