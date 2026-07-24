// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC721Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import { ERC721URIStorageUpgradeable } from
    "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import { ERC2981Upgradeable } from
    "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/**
 * @title MembaNFT
 * @author Samouraï Coop
 * @notice ERC-721 NFT with sub-collections and ERC-2981 royalties.
 *         Port of the Gno `memba_nft_v2` realm.
 * @dev UUPS-upgradeable. Each collection has its own creator who controls minting.
 */
contract MembaNFT is ERC721URIStorageUpgradeable, ERC2981Upgradeable, UUPSUpgradeable, PausableUpgradeable {
    // ── Constants ─────────────────────────────────────────────────
    uint96 public constant MAX_ROYALTY_BPS = 1000;   // 10%
    uint256 public constant MAX_BATCH_MINT = 50;

    // ── Structs ───────────────────────────────────────────────────
    struct CollectionInfo {
        string collectionID;
        address creator;
        string name;
        string symbol;
        uint256 totalSupply;
        uint96 royaltyBps;
        address royaltyRecipient;
    }

    // ── Storage (ERC-7201) ────────────────────────────────────────
    /// @custom:storage-location erc7201:memba.storage.MembaNFT
    struct NFTStorage {
        address admin;
        uint256 nextTokenId;
        mapping(bytes32 => CollectionInfo) collections;
        mapping(uint256 => bytes32) tokenCollection;
        bytes32[] collectionHashes;
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("memba.storage.MembaNFT")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev Asserted against its derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant STORAGE_LOCATION = 0x1d310fecbad391109a38e0aceee48b95b8d8009517fb982ac3f0e464df30bb00;

    function _getStorage() private pure returns (NFTStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    // ── Errors ────────────────────────────────────────────────────
    error NotAdmin();
    error NotCollectionCreator();
    error CollectionAlreadyExists();
    error CollectionNotFound();
    error EmptyTokenURI();
    error RoyaltyTooHigh();
    error BatchTooLarge();
    error InvalidParams();

    // ── Events ────────────────────────────────────────────────────
    event CollectionCreated(bytes32 indexed collectionHash, string collectionID, address indexed creator);
    event NFTMinted(uint256 indexed tokenId, bytes32 indexed collectionHash, address indexed to);

    // ── Modifiers ─────────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != _getStorage().admin) revert NotAdmin();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ── Initializer ───────────────────────────────────────────────
    function initialize(address _admin) external initializer {
        if (_admin == address(0)) revert InvalidParams();
        __ERC721_init("Memba NFT", "MNFT");
        __ERC721URIStorage_init();
        __ERC2981_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        _getStorage().admin = _admin;
    }

    // ── Collections ───────────────────────────────────────────────

    function createCollection(
        string calldata collectionID,
        string calldata collName,
        string calldata collSymbol,
        uint96 royaltyBps
    ) external whenNotPaused {
        if (bytes(collectionID).length == 0) revert InvalidParams();
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();

        bytes32 collHash = keccak256(bytes(collectionID));
        NFTStorage storage $ = _getStorage();
        if ($.collections[collHash].creator != address(0)) revert CollectionAlreadyExists();

        $.collections[collHash] = CollectionInfo({
            collectionID: collectionID,
            creator: msg.sender,
            name: collName,
            symbol: collSymbol,
            totalSupply: 0,
            royaltyBps: royaltyBps,
            royaltyRecipient: msg.sender
        });
        $.collectionHashes.push(collHash);

        emit CollectionCreated(collHash, collectionID, msg.sender);
    }

    // ── Minting ───────────────────────────────────────────────────

    function mint(
        string calldata collectionID,
        address to,
        string calldata uri
    ) external whenNotPaused returns (uint256 tokenId) {
        if (bytes(uri).length == 0) revert EmptyTokenURI();

        bytes32 collHash = keccak256(bytes(collectionID));
        NFTStorage storage $ = _getStorage();
        CollectionInfo storage coll = $.collections[collHash];
        if (coll.creator == address(0)) revert CollectionNotFound();
        if (coll.creator != msg.sender) revert NotCollectionCreator();

        tokenId = $.nextTokenId++;
        $.tokenCollection[tokenId] = collHash;
        coll.totalSupply++;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        // Set per-token royalty
        if (coll.royaltyBps > 0) {
            _setTokenRoyalty(tokenId, coll.royaltyRecipient, coll.royaltyBps);
        }

        emit NFTMinted(tokenId, collHash, to);
    }

    function batchMint(
        string calldata collectionID,
        address to,
        string[] calldata uris
    ) external whenNotPaused returns (uint256 firstId) {
        if (uris.length == 0 || uris.length > MAX_BATCH_MINT) revert BatchTooLarge();

        bytes32 collHash = keccak256(bytes(collectionID));
        NFTStorage storage $ = _getStorage();
        CollectionInfo storage coll = $.collections[collHash];
        if (coll.creator == address(0)) revert CollectionNotFound();
        if (coll.creator != msg.sender) revert NotCollectionCreator();

        firstId = $.nextTokenId;

        for (uint256 i = 0; i < uris.length; i++) {
            if (bytes(uris[i]).length == 0) revert EmptyTokenURI();

            uint256 tokenId = $.nextTokenId++;
            $.tokenCollection[tokenId] = collHash;
            coll.totalSupply++;

            _safeMint(to, tokenId);
            _setTokenURI(tokenId, uris[i]);

            if (coll.royaltyBps > 0) {
                _setTokenRoyalty(tokenId, coll.royaltyRecipient, coll.royaltyBps);
            }

            emit NFTMinted(tokenId, collHash, to);
        }
    }

    // ── View Functions ────────────────────────────────────────────

    function getCollectionInfo(string calldata collectionID) external view returns (CollectionInfo memory) {
        bytes32 collHash = keccak256(bytes(collectionID));
        return _getStorage().collections[collHash];
    }

    function tokenCollection(uint256 tokenId) external view returns (bytes32) {
        return _getStorage().tokenCollection[tokenId];
    }

    function admin() external view returns (address) {
        return _getStorage().admin;
    }

    function nextTokenId() external view returns (uint256) {
        return _getStorage().nextTokenId;
    }

    function version() external pure returns (string memory) { return "1.0.0"; }

    // ── Internal overrides ────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyAdmin { }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorageUpgradeable, ERC2981Upgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721URIStorageUpgradeable)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }
}
