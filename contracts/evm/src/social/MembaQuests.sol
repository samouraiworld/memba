// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title MembaQuests
 * @author Samouraï Coop
 * @notice On-chain attestation registry for quest completions.
 *         Backend verifier confirms criteria → records attestation on-chain.
 *         Port of the Gno `quest_attestation_v1` realm.
 */
contract MembaQuests is UUPSUpgradeable {
    struct Attestation {
        address user;
        string questId;
        uint256 xpValue;
        bytes32 proofHash;
        uint256 attestedAt;
    }

    /// @custom:storage-location erc7201:memba.storage.MembaQuests
    struct QuestsStorage {
        address verifier;
        uint256 attestationCount;
        mapping(uint256 => Attestation) attestations;
        mapping(bytes32 => bool) completed; // keccak256(user, questId)
        mapping(address => uint256) userXP;
        mapping(address => uint256[]) userAttestations;
    }

    bytes32 private constant STORAGE_LOCATION = 0xb5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a40000;
    function _getStorage() private pure returns (QuestsStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    error NotVerifier();
    error AlreadyCompleted();
    error InvalidParams();

    event QuestCompleted(uint256 indexed id, address indexed user, string questId, uint256 xp);

    modifier onlyVerifier() { if (msg.sender != _getStorage().verifier) revert NotVerifier(); _; }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _verifier) external initializer {
        if (_verifier == address(0)) revert InvalidParams();
        __UUPSUpgradeable_init();
        _getStorage().verifier = _verifier;
    }

    function attest(address user, string calldata questId, uint256 xpValue, bytes32 proofHash)
        external onlyVerifier returns (uint256 id)
    {
        QuestsStorage storage $ = _getStorage();
        bytes32 key = keccak256(abi.encodePacked(user, questId));
        if ($.completed[key]) revert AlreadyCompleted();

        id = $.attestationCount++;
        $.completed[key] = true;
        $.userXP[user] += xpValue;

        $.attestations[id] = Attestation(user, questId, xpValue, proofHash, block.timestamp);
        $.userAttestations[user].push(id);

        emit QuestCompleted(id, user, questId, xpValue);
    }

    function getAttestation(uint256 id) external view returns (Attestation memory) { return _getStorage().attestations[id]; }
    function getUserXP(address user) external view returns (uint256) { return _getStorage().userXP[user]; }
    function isCompleted(address user, string calldata questId) external view returns (bool) {
        return _getStorage().completed[keccak256(abi.encodePacked(user, questId))];
    }
    function getUserAttestations(address user) external view returns (uint256[] memory) { return _getStorage().userAttestations[user]; }
    function verifier() external view returns (address) { return _getStorage().verifier; }
    function attestationCount() external view returns (uint256) { return _getStorage().attestationCount; }
    function version() external pure returns (string memory) { return "1.0.0"; }

    function _authorizeUpgrade(address) internal override onlyVerifier { }
}
