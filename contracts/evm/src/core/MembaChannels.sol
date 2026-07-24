// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

interface IMembaDAOMember {
    function isMember(address addr) external view returns (bool);
}

/**
 * @title MembaChannels
 * @author Samouraï Coop
 * @notice On-chain message anchoring for DAO communication channels.
 *         Hybrid model: off-chain messages + on-chain Merkle root anchoring.
 *         Port of the Gno `memba_dao_channels_v2` realm.
 * @dev UUPS-upgradeable. Periodic Merkle roots anchor message batches on-chain.
 */
contract MembaChannels is UUPSUpgradeable, PausableUpgradeable {
    // ── Constants
    // ─────────────────────────────────────────────────
    uint256 public constant MAX_CHANNELS = 100;

    // ── Enums
    // ─────────────────────────────────────────────────────
    enum ChannelType {
        Text,
        Announcements,
        ReadOnly
    }

    // ── Structs
    // ───────────────────────────────────────────────────
    struct ChannelConfig {
        string name;
        ChannelType channelType;
        bytes32 aclHash;
        bool active;
        uint256 createdAt;
    }

    // ── Storage (ERC-7201)
    // ────────────────────────────────────────
    /// @custom:storage-location erc7201:memba.storage.MembaChannels
    struct ChannelsStorage {
        address daoContract;
        address admin;
        uint256 channelCount;
        mapping(uint256 => ChannelConfig) channels;
        mapping(uint256 => bytes32[]) messageRoots;
        mapping(uint256 => uint256[]) rootTimestamps;
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("memba.storage.MembaChannels")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev Asserted against its derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant STORAGE_LOCATION = 0xefd4cc714872068fcaf50e6e4816644d1ecf737c25c131dd17e94515be9e4d00;

    function _getStorage() private pure returns (ChannelsStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    // ── Errors
    // ────────────────────────────────────────────────────
    error NotAdmin();
    error NotMember();
    error ChannelNotFound();
    error ChannelInactive();
    error TooManyChannels();
    error InvalidParams();

    // ── Events
    // ────────────────────────────────────────────────────
    event ChannelCreated(uint256 indexed channelId, string name, ChannelType channelType);
    event ChannelArchived(uint256 indexed channelId);
    event MessagesAnchored(uint256 indexed channelId, bytes32 merkleRoot, uint256 timestamp);

    // ── Modifiers
    // ─────────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != _getStorage().admin) revert NotAdmin();
        _;
    }

    modifier onlyMember() {
        ChannelsStorage storage $ = _getStorage();
        if (!IMembaDAOMember($.daoContract).isMember(msg.sender)) revert NotMember();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _daoContract, address _admin) external initializer {
        if (_daoContract == address(0) || _admin == address(0)) revert InvalidParams();
        __UUPSUpgradeable_init();
        __Pausable_init();

        ChannelsStorage storage $ = _getStorage();
        $.daoContract = _daoContract;
        $.admin = _admin;
    }

    // ── Channel Management
    // ────────────────────────────────────────

    function createChannel(string calldata name, ChannelType channelType, bytes32 aclHash)
        external
        onlyAdmin
        whenNotPaused
        returns (uint256 channelId)
    {
        if (bytes(name).length == 0) revert InvalidParams();

        ChannelsStorage storage $ = _getStorage();
        if ($.channelCount >= MAX_CHANNELS) revert TooManyChannels();

        channelId = $.channelCount++;
        $.channels[channelId] = ChannelConfig({
            name: name, channelType: channelType, aclHash: aclHash, active: true, createdAt: block.timestamp
        });

        emit ChannelCreated(channelId, name, channelType);
    }

    function archiveChannel(uint256 channelId) external onlyAdmin {
        ChannelsStorage storage $ = _getStorage();
        if (channelId >= $.channelCount) revert ChannelNotFound();
        $.channels[channelId].active = false;
        emit ChannelArchived(channelId);
    }

    // ── Message Anchoring
    // ─────────────────────────────────────────

    function anchorMessages(uint256 channelId, bytes32 merkleRoot) external onlyMember whenNotPaused {
        ChannelsStorage storage $ = _getStorage();
        if (channelId >= $.channelCount) revert ChannelNotFound();
        if (!$.channels[channelId].active) revert ChannelInactive();

        $.messageRoots[channelId].push(merkleRoot);
        $.rootTimestamps[channelId].push(block.timestamp);

        emit MessagesAnchored(channelId, merkleRoot, block.timestamp);
    }

    // ── Verification
    // ──────────────────────────────────────────────

    function verifyMessage(uint256 channelId, uint256 rootIndex, bytes32[] calldata proof, bytes32 leaf)
        external
        view
        returns (bool)
    {
        ChannelsStorage storage $ = _getStorage();
        bytes32[] storage roots = $.messageRoots[channelId];
        if (rootIndex >= roots.length) return false;
        return MerkleProof.verify(proof, roots[rootIndex], leaf);
    }

    // ── View
    // ──────────────────────────────────────────────────────

    function getChannel(uint256 channelId) external view returns (ChannelConfig memory) {
        return _getStorage().channels[channelId];
    }

    function getMessageRoots(uint256 channelId) external view returns (bytes32[] memory) {
        return _getStorage().messageRoots[channelId];
    }

    function getRootTimestamps(uint256 channelId) external view returns (uint256[] memory) {
        return _getStorage().rootTimestamps[channelId];
    }

    function channelCount() external view returns (uint256) {
        return _getStorage().channelCount;
    }

    function admin() external view returns (address) {
        return _getStorage().admin;
    }

    function daoContract() external view returns (address) {
        return _getStorage().daoContract;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyAdmin { }
}
