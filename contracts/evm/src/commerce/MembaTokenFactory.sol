// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from
    "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import { MembaToken } from "./MembaToken.sol";

/**
 * @title MembaTokenFactory
 * @author Samouraï Coop
 * @notice ERC-20 token factory with creation fee. Deploys MembaToken via CREATE2.
 *         Port of the Gno `tokenfactory_v2` realm.
 * @dev UUPS-upgradeable. Fee recipient is the Samouraï Coop Safe multisig.
 */
contract MembaTokenFactory is UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    // ── Constants ─────────────────────────────────────────────────
    uint256 public constant MAX_SYMBOL_LENGTH = 10;
    uint256 public constant MAX_NAME_LENGTH = 64;
    uint8 public constant MAX_DECIMALS = 18;

    // ── Storage (ERC-7201) ────────────────────────────────────────
    /// @custom:storage-location erc7201:memba.storage.MembaTokenFactory
    struct TokenFactoryStorage {
        address admin;
        address feeRecipient;
        uint256 creationFee;      // flat ETH fee for creating a token
        uint256 tokenCount;
        mapping(uint256 => address) tokens;
        mapping(address => bool) isMembaToken;
        mapping(address => address) tokenCreator;
        mapping(bytes32 => bool) symbolUsed;
    }

    // keccak256(abi.encode(uint256(keccak256("memba.storage.MembaTokenFactory")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev keccak256(abi.encode(uint256(keccak256("memba.storage.MembaTokenFactory")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev Asserted against its derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant STORAGE_LOCATION = 0x3a6683e2357b6a0ba9e020627aa3272b6d3f4e20ff245486e869a996fdf39600;

    function _getStorage() private pure returns (TokenFactoryStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    // ── Errors ────────────────────────────────────────────────────
    error NotAdmin();
    error InvalidRecipient();
    error InvalidParams();
    error SymbolAlreadyUsed();
    error InsufficientFee();
    error FeeTransferFailed();

    // ── Events ────────────────────────────────────────────────────
    event TokenCreated(
        uint256 indexed tokenId,
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        uint8 decimals,
        uint256 initialSupply
    );
    event FeeCollected(address indexed payer, uint256 amount);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event CreationFeeUpdated(uint256 oldFee, uint256 newFee);

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
    function initialize(
        address _admin,
        address _feeRecipient,
        uint256 _creationFee
    ) external initializer {
        if (_admin == address(0) || _feeRecipient == address(0)) revert InvalidParams();

        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        TokenFactoryStorage storage $ = _getStorage();
        $.admin = _admin;
        $.feeRecipient = _feeRecipient;
        $.creationFee = _creationFee;
    }

    // ── Token Creation ────────────────────────────────────────────

    /**
     * @notice Deploy a new ERC-20 token via CREATE2.
     * @param name_ Token name (max 64 chars)
     * @param symbol_ Token symbol (max 10 chars, must be unique)
     * @param decimals_ Token decimals (0-18)
     * @param initialSupply Initial supply minted to msg.sender
     * @param salt CREATE2 salt for deterministic addressing
     * @return token The address of the deployed MembaToken
     */
    function createToken(
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        uint256 initialSupply,
        bytes32 salt
    ) external payable whenNotPaused nonReentrant returns (address token) {
        // Validation
        if (bytes(name_).length == 0 || bytes(name_).length > MAX_NAME_LENGTH) revert InvalidParams();
        if (bytes(symbol_).length == 0 || bytes(symbol_).length > MAX_SYMBOL_LENGTH) revert InvalidParams();
        if (decimals_ > MAX_DECIMALS) revert InvalidParams();

        TokenFactoryStorage storage $ = _getStorage();

        // Symbol uniqueness
        bytes32 symbolHash = keccak256(bytes(symbol_));
        if ($.symbolUsed[symbolHash]) revert SymbolAlreadyUsed();

        // Fee check
        if (msg.value < $.creationFee) revert InsufficientFee();

        // State updates BEFORE external operations (CEI)
        $.symbolUsed[symbolHash] = true;
        uint256 tokenId = $.tokenCount++;

        // Deploy token via CREATE2
        token = address(
            new MembaToken{salt: salt}(name_, symbol_, decimals_, initialSupply, msg.sender)
        );

        $.tokens[tokenId] = token;
        $.isMembaToken[token] = true;
        $.tokenCreator[token] = msg.sender;

        emit TokenCreated(tokenId, token, msg.sender, name_, symbol_, decimals_, initialSupply);

        // Collect fee (if any)
        if (msg.value > 0) {
            (bool ok,) = payable($.feeRecipient).call{value: msg.value}("");
            if (!ok) revert FeeTransferFailed();
            emit FeeCollected(msg.sender, msg.value);
        }
    }

    // ── Admin ─────────────────────────────────────────────────────

    function updateFeeRecipient(address newRecipient) external onlyAdmin {
        if (newRecipient == address(0)) revert InvalidRecipient();
        TokenFactoryStorage storage $ = _getStorage();
        address old = $.feeRecipient;
        $.feeRecipient = newRecipient;
        emit FeeRecipientUpdated(old, newRecipient);
    }

    function updateCreationFee(uint256 newFee) external onlyAdmin {
        TokenFactoryStorage storage $ = _getStorage();
        uint256 old = $.creationFee;
        $.creationFee = newFee;
        emit CreationFeeUpdated(old, newFee);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    // ── View Functions ────────────────────────────────────────────

    function getToken(uint256 index) external view returns (address) {
        return _getStorage().tokens[index];
    }

    function getTokenCount() external view returns (uint256) {
        return _getStorage().tokenCount;
    }

    function isRegistered(address token) external view returns (bool) {
        return _getStorage().isMembaToken[token];
    }

    function getTokenCreator(address token) external view returns (address) {
        return _getStorage().tokenCreator[token];
    }

    function admin() external view returns (address) {
        return _getStorage().admin;
    }

    function feeRecipient() external view returns (address) {
        return _getStorage().feeRecipient;
    }

    function creationFee() external view returns (uint256) {
        return _getStorage().creationFee;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // ── Internal ──────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyAdmin { }
}
