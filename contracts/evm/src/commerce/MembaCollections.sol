// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import { MembaNFT } from "./MembaNFT.sol";

/**
 * @title MembaCollections
 * @author Samouraï Coop
 * @notice NFT launchpad: collection registration, sale phases (Draft→Allowlist→Public→Closed),
 *         Merkle-proof allowlist minting, creation fee. Port of Gno `memba_collections`.
 * @dev UUPS-upgradeable. Deploys a MembaNFT sub-collection per registered collection.
 */
contract MembaCollections is UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    // ── Constants
    // ─────────────────────────────────────────────────
    uint8 public constant PHASE_DRAFT = 0;
    uint8 public constant PHASE_ALLOWLIST = 1;
    uint8 public constant PHASE_PUBLIC = 2;
    uint8 public constant PHASE_CLOSED = 3;
    uint96 public constant MAX_ROYALTY_BPS = 1000; // 10%

    // ── Structs
    // ───────────────────────────────────────────────────
    struct Collection {
        address creator;
        string slug;
        string name;
        string symbol;
        string description;
        uint256 maxSupply; // 0 = unlimited
        uint256 mintPrice; // wei
        uint96 royaltyBps;
        uint8 phase;
        bytes32 allowlistRoot;
        bool verified;
        uint256 mintCount;
        address nftContract; // MembaNFT used for this collection
    }

    // ── Storage (ERC-7201)
    // ────────────────────────────────────────
    /// @custom:storage-location erc7201:memba.storage.MembaCollections
    struct CollectionsStorage {
        address admin;
        address feeRecipient;
        uint256 creationFee;
        address nftContract; // Shared MembaNFT for all collections
        uint256 collectionCount;
        mapping(bytes32 => Collection) collections;
        bytes32[] collectionHashes;
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("memba.storage.MembaCollections")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev Asserted against its derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant STORAGE_LOCATION = 0x9305ff2aa454f75116534abd4793b2e16ee5ef40558ef36715bb229960c11d00;

    function _getStorage() private pure returns (CollectionsStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    // ── Errors
    // ────────────────────────────────────────────────────
    error NotAdmin();
    error NotCreator();
    error CollectionExists();
    error CollectionNotFound();
    error InvalidPhase();
    error MintNotOpen();
    error MaxSupplyReached();
    error InsufficientPayment();
    error InvalidAllowlistProof();
    error InvalidParams();
    error RoyaltyTooHigh();
    error TransferFailed();

    // ── Events
    // ────────────────────────────────────────────────────
    event CollectionRegistered(bytes32 indexed collectionHash, string slug, address indexed creator);
    event PhaseChanged(bytes32 indexed collectionHash, uint8 phase);
    event NFTMintedFromLaunchpad(bytes32 indexed collectionHash, address indexed minter, uint256 tokenId);
    event CollectionVerified(bytes32 indexed collectionHash);

    // ── Modifiers
    // ─────────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != _getStorage().admin) revert NotAdmin();
        _;
    }

    // ── Constructor
    // ───────────────────────────────────────────────
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ── Initializer
    // ───────────────────────────────────────────────
    function initialize(address _admin, address _feeRecipient, uint256 _creationFee, address _nftContract)
        external
        initializer
    {
        if (_admin == address(0) || _feeRecipient == address(0) || _nftContract == address(0)) {
            revert InvalidParams();
        }
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        CollectionsStorage storage $ = _getStorage();
        $.admin = _admin;
        $.feeRecipient = _feeRecipient;
        $.creationFee = _creationFee;
        $.nftContract = _nftContract;
    }

    // ── Collection Registration
    // ───────────────────────────────────

    function createCollection(
        string calldata slug,
        string calldata name,
        string calldata symbol,
        string calldata description,
        uint256 maxSupply,
        uint256 mintPrice,
        uint96 royaltyBps
    ) external payable whenNotPaused {
        if (bytes(slug).length == 0 || bytes(name).length == 0) revert InvalidParams();
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();

        CollectionsStorage storage $ = _getStorage();
        if (msg.value < $.creationFee) revert InsufficientPayment();

        bytes32 collHash = keccak256(bytes(slug));
        if ($.collections[collHash].creator != address(0)) revert CollectionExists();

        $.collections[collHash] = Collection({
            creator: msg.sender,
            slug: slug,
            name: name,
            symbol: symbol,
            description: description,
            maxSupply: maxSupply,
            mintPrice: mintPrice,
            royaltyBps: royaltyBps,
            phase: PHASE_DRAFT,
            allowlistRoot: bytes32(0),
            verified: false,
            mintCount: 0,
            nftContract: $.nftContract
        });
        $.collectionHashes.push(collHash);
        $.collectionCount++;

        // Collect creation fee
        if (msg.value > 0) {
            (bool ok,) = payable($.feeRecipient).call{ value: msg.value }("");
            if (!ok) revert TransferFailed();
        }

        emit CollectionRegistered(collHash, slug, msg.sender);
    }

    // ── Phase Management
    // ──────────────────────────────────────────

    function setPhase(bytes32 collectionHash, uint8 phase) external {
        CollectionsStorage storage $ = _getStorage();
        Collection storage coll = $.collections[collectionHash];
        if (coll.creator == address(0)) revert CollectionNotFound();
        if (coll.creator != msg.sender) revert NotCreator();
        if (phase > PHASE_CLOSED) revert InvalidPhase();

        coll.phase = phase;
        emit PhaseChanged(collectionHash, phase);
    }

    function setAllowlistRoot(bytes32 collectionHash, bytes32 root) external {
        CollectionsStorage storage $ = _getStorage();
        Collection storage coll = $.collections[collectionHash];
        if (coll.creator == address(0)) revert CollectionNotFound();
        if (coll.creator != msg.sender) revert NotCreator();

        coll.allowlistRoot = root;
    }

    // ── Minting
    // ───────────────────────────────────────────────────

    function mintNFT(bytes32 collectionHash, string calldata tokenURI, bytes32[] calldata proof)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        CollectionsStorage storage $ = _getStorage();
        Collection storage coll = $.collections[collectionHash];
        if (coll.creator == address(0)) revert CollectionNotFound();

        // Phase check
        if (coll.phase == PHASE_DRAFT || coll.phase == PHASE_CLOSED) revert MintNotOpen();

        // Allowlist check
        if (coll.phase == PHASE_ALLOWLIST) {
            bytes32 leaf = keccak256(abi.encodePacked(msg.sender));
            if (!MerkleProof.verify(proof, coll.allowlistRoot, leaf)) revert InvalidAllowlistProof();
        }

        // Supply check
        if (coll.maxSupply > 0 && coll.mintCount >= coll.maxSupply) revert MaxSupplyReached();

        // Price check
        if (msg.value < coll.mintPrice) revert InsufficientPayment();

        coll.mintCount++;

        // Mint via the shared MembaNFT contract
        // The collection creator must have pre-created the sub-collection on MembaNFT
        uint256 tokenId = MembaNFT(coll.nftContract).mint(coll.slug, msg.sender, tokenURI);

        // Send mint revenue to collection creator
        if (msg.value > 0) {
            (bool ok,) = payable(coll.creator).call{ value: msg.value }("");
            if (!ok) revert TransferFailed();
        }

        emit NFTMintedFromLaunchpad(collectionHash, msg.sender, tokenId);
        return tokenId;
    }

    // ── Admin
    // ─────────────────────────────────────────────────────

    function verifyCollection(bytes32 collectionHash) external onlyAdmin {
        CollectionsStorage storage $ = _getStorage();
        Collection storage coll = $.collections[collectionHash];
        if (coll.creator == address(0)) revert CollectionNotFound();
        coll.verified = true;
        emit CollectionVerified(collectionHash);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    // ── View
    // ──────────────────────────────────────────────────────

    function getCollection(bytes32 collectionHash) external view returns (Collection memory) {
        return _getStorage().collections[collectionHash];
    }

    function listCollections() external view returns (bytes32[] memory) {
        return _getStorage().collectionHashes;
    }

    function admin() external view returns (address) {
        return _getStorage().admin;
    }

    function collectionCount() external view returns (uint256) {
        return _getStorage().collectionCount;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    function _authorizeUpgrade(address) internal override onlyAdmin { }
}
