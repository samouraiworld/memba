// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC721Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title IERC5192
 * @notice Minimal ERC-5192 Soulbound Token interface.
 */
interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}

/**
 * @title MembaBadges
 * @author Samouraï Coop
 * @notice Non-transferable achievement tokens (Soulbound per ERC-5192).
 *         Port of the Gno `gnobuilders_badges_v2` realm.
 */
contract MembaBadges is ERC721Upgradeable, UUPSUpgradeable, IERC5192 {
    // ── Constants ─────────────────────────────────────────────────
    uint256 public constant MAX_BATCH = 50;

    // ── Structs ───────────────────────────────────────────────────
    struct BadgeInfo {
        string questId;
        string tokenURI;
        bool soulbound;
        uint256 mintedAt;
    }

    // ── Storage (ERC-7201) ────────────────────────────────────────
    /// @custom:storage-location erc7201:memba.storage.MembaBadges
    struct BadgeStorage {
        address minter;
        uint256 nextTokenId;
        mapping(uint256 => BadgeInfo) badges;
        mapping(address => uint256[]) userBadges;
        mapping(bytes32 => bool) minted; // keccak256(abi.encodePacked(addr, questId))
    }

    bytes32 private constant STORAGE_LOCATION = 0xa5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f40000;

    function _getStorage() private pure returns (BadgeStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    // ── Errors ────────────────────────────────────────────────────
    error NotMinter();
    error AlreadyMinted();
    error SoulboundTransfer();
    error BatchTooLarge();
    error ArrayLengthMismatch();
    error InvalidParams();

    // ── Events ────────────────────────────────────────────────────
    event BadgeMinted(uint256 indexed tokenId, address indexed to, string questId, bool soulbound);

    modifier onlyMinter() {
        if (msg.sender != _getStorage().minter) revert NotMinter();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _minter) external initializer {
        if (_minter == address(0)) revert InvalidParams();
        __ERC721_init("Memba Badges", "BADGE");
        __UUPSUpgradeable_init();
        _getStorage().minter = _minter;
    }

    // ── Minting ───────────────────────────────────────────────────

    function mint(
        address to,
        string calldata questId,
        string calldata uri,
        bool soulbound
    ) external onlyMinter returns (uint256 tokenId) {
        BadgeStorage storage $ = _getStorage();

        bytes32 dedupKey = keccak256(abi.encodePacked(to, questId));
        if ($.minted[dedupKey]) revert AlreadyMinted();

        tokenId = $.nextTokenId++;
        $.minted[dedupKey] = true;

        $.badges[tokenId] = BadgeInfo({
            questId: questId,
            tokenURI: uri,
            soulbound: soulbound,
            mintedAt: block.timestamp
        });
        $.userBadges[to].push(tokenId);

        _safeMint(to, tokenId);

        if (soulbound) {
            emit Locked(tokenId);
        }
        emit BadgeMinted(tokenId, to, questId, soulbound);
    }

    function batchMint(
        address[] calldata recipients,
        string[] calldata questIds,
        string[] calldata uris,
        bool soulbound
    ) external onlyMinter {
        if (recipients.length != questIds.length || questIds.length != uris.length) revert ArrayLengthMismatch();
        if (recipients.length > MAX_BATCH) revert BatchTooLarge();

        BadgeStorage storage $ = _getStorage();

        for (uint256 i = 0; i < recipients.length; i++) {
            bytes32 dedupKey = keccak256(abi.encodePacked(recipients[i], questIds[i]));
            if ($.minted[dedupKey]) revert AlreadyMinted();

            uint256 tokenId = $.nextTokenId++;
            $.minted[dedupKey] = true;

            $.badges[tokenId] = BadgeInfo({
                questId: questIds[i],
                tokenURI: uris[i],
                soulbound: soulbound,
                mintedAt: block.timestamp
            });
            $.userBadges[recipients[i]].push(tokenId);

            _safeMint(recipients[i], tokenId);

            if (soulbound) emit Locked(tokenId);
            emit BadgeMinted(tokenId, recipients[i], questIds[i], soulbound);
        }
    }

    // ── ERC-5192 ──────────────────────────────────────────────────

    function locked(uint256 tokenId) external view override returns (bool) {
        return _getStorage().badges[tokenId].soulbound;
    }

    // ── View ──────────────────────────────────────────────────────

    function getUserBadges(address user) external view returns (uint256[] memory) {
        return _getStorage().userBadges[user];
    }

    function getBadgeInfo(uint256 tokenId) external view returns (BadgeInfo memory) {
        return _getStorage().badges[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _getStorage().badges[tokenId].tokenURI;
    }

    function minter() external view returns (address) { return _getStorage().minter; }
    function nextTokenId() external view returns (uint256) { return _getStorage().nextTokenId; }
    function version() external pure returns (string memory) { return "1.0.0"; }

    // ── Internal ──────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyMinter { }

    /// @dev Block transfers of soulbound tokens.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        // Allow minting (from=0) and burning (to=0), block transfers of soulbound
        if (from != address(0) && to != address(0)) {
            if (_getStorage().badges[tokenId].soulbound) revert SoulboundTransfer();
        }
        return super._update(to, tokenId, auth);
    }
}
