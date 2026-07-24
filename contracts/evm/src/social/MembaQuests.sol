// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { MembaUpgradeAuthority } from "../lib/MembaUpgradeAuthority.sol";

/**
 * @title MembaQuests
 * @author Samouraï Coop
 * @notice On-chain attestation registry for quest completions.
 *         Backend verifier confirms criteria → records attestation on-chain.
 *         Port of the Gno `quest_attestation_v1` realm.
 */
contract MembaQuests is UUPSUpgradeable, MembaUpgradeAuthority {
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

    /// @dev keccak256(abi.encode(uint256(keccak256("memba.storage.MembaQuests")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev Asserted against its derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant STORAGE_LOCATION = 0x6b0fac96b9921adf0380192087ba83f39c3b18a2ac3fa6dff545fd8aeb875500;

    function _getStorage() private pure returns (QuestsStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    error NotVerifier();
    error AlreadyCompleted();
    error InvalidParams();

    event QuestCompleted(uint256 indexed id, address indexed user, string questId, uint256 xp);

    modifier onlyVerifier() {
        if (msg.sender != _getStorage().verifier) revert NotVerifier();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param _verifier Operational key (server-side). Must NOT be the upgrade authority.
    /// @param _upgrader Address permitted to replace the implementation — the Safe,
    ///        or a TimelockController in front of it. Separated because this used to
    ///        be the same key, so a backend compromise meant contract takeover.
    function initialize(address _verifier, address _upgrader) external initializer {
        if (_verifier == address(0)) revert InvalidParams();
        __UUPSUpgradeable_init();
        _getStorage().verifier = _verifier;
        __MembaUpgradeAuthority_init(_upgrader);
    }

    function attest(address user, string calldata questId, uint256 xpValue, bytes32 proofHash)
        external
        onlyVerifier
        returns (uint256 id)
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

    function getAttestation(uint256 id) external view returns (Attestation memory) {
        return _getStorage().attestations[id];
    }

    function getUserXP(address user) external view returns (uint256) {
        return _getStorage().userXP[user];
    }

    function isCompleted(address user, string calldata questId) external view returns (bool) {
        return _getStorage().completed[keccak256(abi.encodePacked(user, questId))];
    }

    function getUserAttestations(address user) external view returns (uint256[] memory) {
        return _getStorage().userAttestations[user];
    }

    function verifier() external view returns (address) {
        return _getStorage().verifier;
    }

    function attestationCount() external view returns (uint256) {
        return _getStorage().attestationCount;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    function _authorizeUpgrade(address) internal override onlyUpgrader { }
}
