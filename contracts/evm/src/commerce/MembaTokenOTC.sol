// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from
    "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MembaTokenOTC
 * @author Samouraï Coop
 * @notice Over-the-counter ERC-20 trading desk with partial fills.
 *         Port of the Gno `token_otc_v2` realm.
 * @dev UUPS-upgradeable. SafeERC20 for all token transfers. ReentrancyGuard on fill/cancel.
 */
contract MembaTokenOTC is UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ── Structs ───────────────────────────────────────────────────
    struct OTCListing {
        address seller;
        address token;
        uint256 totalAmount;
        uint256 filledAmount;
        uint256 unitPrice;        // wei per token unit
        bool active;
        uint256 createdAt;
    }

    // ── Storage (ERC-7201) ────────────────────────────────────────
    /// @custom:storage-location erc7201:memba.storage.MembaTokenOTC
    struct OTCStorage {
        address admin;
        address feeRecipient;
        uint16 platformFeeBps;
        uint256 listingCount;
        mapping(uint256 => OTCListing) listings;
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("memba.storage.MembaTokenOTC")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev Asserted against its derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant STORAGE_LOCATION = 0x37b065187fc8458ae381b5d52727638a8bd9b05a56240683996fd8d298840700;

    function _getStorage() private pure returns (OTCStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    // ── Errors ────────────────────────────────────────────────────
    error NotAdmin();
    error NotSeller();
    error ListingNotActive();
    error InsufficientPayment();
    error ExceedsAvailable();
    error InvalidParams();
    error TransferFailed();
    error ZeroQuantity();

    // ── Events ────────────────────────────────────────────────────
    event Listed(uint256 indexed listingId, address indexed seller, address indexed token, uint256 amount, uint256 unitPrice);
    event Filled(uint256 indexed listingId, address indexed buyer, uint256 qty, uint256 totalCost);
    event Cancelled(uint256 indexed listingId, uint256 returnedAmount);
    event FeeCollected(uint256 indexed listingId, uint256 feeAmount);

    // ── Modifiers ─────────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != _getStorage().admin) revert NotAdmin();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _admin, address _feeRecipient, uint16 _feeBps) external initializer {
        if (_admin == address(0) || _feeRecipient == address(0)) revert InvalidParams();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        OTCStorage storage $ = _getStorage();
        $.admin = _admin;
        $.feeRecipient = _feeRecipient;
        $.platformFeeBps = _feeBps;
    }

    // ── Listing ───────────────────────────────────────────────────

    function list(address token, uint256 amount, uint256 unitPrice) external whenNotPaused returns (uint256 listingId) {
        if (token == address(0) || amount == 0 || unitPrice == 0) revert InvalidParams();

        OTCStorage storage $ = _getStorage();
        listingId = $.listingCount++;

        $.listings[listingId] = OTCListing({
            seller: msg.sender,
            token: token,
            totalAmount: amount,
            filledAmount: 0,
            unitPrice: unitPrice,
            active: true,
            createdAt: block.timestamp
        });

        // Transfer tokens to contract (requires prior approval)
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit Listed(listingId, msg.sender, token, amount, unitPrice);
    }

    // ── Filling ───────────────────────────────────────────────────

    function fill(uint256 listingId, uint256 qty) external payable nonReentrant whenNotPaused {
        if (qty == 0) revert ZeroQuantity();

        OTCStorage storage $ = _getStorage();
        OTCListing storage listing = $.listings[listingId];
        if (!listing.active) revert ListingNotActive();

        uint256 available = listing.totalAmount - listing.filledAmount;
        if (qty > available) revert ExceedsAvailable();

        uint256 totalCost = qty * listing.unitPrice;
        if (msg.value < totalCost) revert InsufficientPayment();

        // CEI: state update BEFORE transfers
        listing.filledAmount += qty;
        if (listing.filledAmount == listing.totalAmount) {
            listing.active = false;
        }

        // Calculate fee
        uint256 fee = (totalCost * $.platformFeeBps) / 10000;
        uint256 sellerProceeds = totalCost - fee;

        // Transfer tokens to buyer
        IERC20(listing.token).safeTransfer(msg.sender, qty);

        // Transfer ETH to seller
        (bool ok,) = payable(listing.seller).call{value: sellerProceeds}("");
        if (!ok) revert TransferFailed();

        // Transfer fee
        if (fee > 0) {
            (bool feeOk,) = payable($.feeRecipient).call{value: fee}("");
            if (!feeOk) revert TransferFailed();
        }

        // Refund excess ETH
        if (msg.value > totalCost) {
            (bool refundOk,) = payable(msg.sender).call{value: msg.value - totalCost}("");
            if (!refundOk) revert TransferFailed();
        }

        emit Filled(listingId, msg.sender, qty, totalCost);
        if (fee > 0) emit FeeCollected(listingId, fee);
    }

    // ── Cancel ────────────────────────────────────────────────────

    function cancel(uint256 listingId) external nonReentrant {
        OTCStorage storage $ = _getStorage();
        OTCListing storage listing = $.listings[listingId];
        if (listing.seller != msg.sender) revert NotSeller();
        if (!listing.active) revert ListingNotActive();

        uint256 remaining = listing.totalAmount - listing.filledAmount;

        // CEI: state update BEFORE transfer
        listing.active = false;

        // Return unsold tokens
        if (remaining > 0) {
            IERC20(listing.token).safeTransfer(msg.sender, remaining);
        }

        emit Cancelled(listingId, remaining);
    }

    // ── View ──────────────────────────────────────────────────────

    function getListing(uint256 id) external view returns (OTCListing memory) {
        return _getStorage().listings[id];
    }

    function listingCount() external view returns (uint256) {
        return _getStorage().listingCount;
    }

    function admin() external view returns (address) { return _getStorage().admin; }
    function feeRecipient() external view returns (address) { return _getStorage().feeRecipient; }
    function platformFeeBps() external view returns (uint16) { return _getStorage().platformFeeBps; }

    function pause() external onlyAdmin { _pause(); }
    function unpause() external onlyAdmin { _unpause(); }
    function version() external pure returns (string memory) { return "1.0.0"; }

    function _authorizeUpgrade(address) internal override onlyAdmin { }
}
