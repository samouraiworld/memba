// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MembaUpgradeAuthority } from "../lib/MembaUpgradeAuthority.sol";

/**
 * @title MembaTokenOTC
 * @author Samouraï Coop
 * @notice Over-the-counter ERC-20 trading desk with partial fills.
 *         Port of the Gno `token_otc_v2` realm.
 * @dev UUPS-upgradeable. SafeERC20 for all token transfers. ReentrancyGuard on fill/cancel.
 */
contract MembaTokenOTC is UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable, MembaUpgradeAuthority {
    using SafeERC20 for IERC20;

    /// @dev Same 20% ceiling as MembaEscrow. An unbounded init parameter previously
    ///      let a fat-fingered deploy brick the desk permanently (no setter existed).
    uint16 public constant MAX_FEE_BPS = 2000;

    // ── Structs
    // ───────────────────────────────────────────────────
    struct OTCListing {
        address seller;
        address token;
        uint256 totalAmount; // base units actually escrowed (measured on receipt)
        uint256 filledAmount; // base units already sold
        uint256 unitPrice; // wei per WHOLE token (per 10**tokenDecimals base units)
        uint8 tokenDecimals; // snapshot of the token's decimals at listing time
        bool active;
        uint256 createdAt;
    }

    // ── Storage (ERC-7201)
    // ────────────────────────────────────────
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

    // ── Errors
    // ────────────────────────────────────────────────────
    error NotAdmin();
    error NotSeller();
    error ListingNotActive();
    error InsufficientPayment();
    error ExceedsAvailable();
    error InvalidParams();
    error TransferFailed();
    error ZeroQuantity();
    error InvalidFeeBps();

    // ── Events
    // ────────────────────────────────────────────────────
    event Listed(
        uint256 indexed listingId, address indexed seller, address indexed token, uint256 amount, uint256 unitPrice
    );
    event Filled(uint256 indexed listingId, address indexed buyer, uint256 qty, uint256 totalCost);
    event Cancelled(uint256 indexed listingId, uint256 returnedAmount);
    event FeeCollected(uint256 indexed listingId, uint256 feeAmount);
    event PlatformFeeUpdated(uint16 newFeeBps);

    // ── Modifiers
    // ─────────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != _getStorage().admin) revert NotAdmin();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _admin, address _feeRecipient, uint16 _feeBps) external initializer {
        if (_admin == address(0) || _feeRecipient == address(0)) revert InvalidParams();
        if (_feeBps > MAX_FEE_BPS) revert InvalidFeeBps();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        OTCStorage storage $ = _getStorage();
        $.admin = _admin;
        __MembaUpgradeAuthority_init(_admin);
        $.feeRecipient = _feeRecipient;
        $.platformFeeBps = _feeBps;
    }

    // ── Listing
    // ───────────────────────────────────────────────────

    function list(address token, uint256 amount, uint256 unitPrice)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 listingId)
    {
        if (token == address(0) || amount == 0 || unitPrice == 0) revert InvalidParams();

        OTCStorage storage $ = _getStorage();

        // Measure the amount ACTUALLY received. Fee-on-transfer/rebasing tokens deliver
        // less than `amount`; recording the requested figure would let this listing's
        // fills draw against tokens escrowed for a *different* seller (A-3). Every
        // listing's `totalAmount` is now backed by real balance, so the sum of open
        // escrows can never exceed the contract's holdings.
        IERC20 t = IERC20(token);
        uint256 balBefore = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = t.balanceOf(address(this)) - balBefore;
        if (received == 0) revert InvalidParams();

        listingId = $.listingCount++;

        $.listings[listingId] = OTCListing({
            seller: msg.sender,
            token: token,
            totalAmount: received,
            filledAmount: 0,
            unitPrice: unitPrice,
            tokenDecimals: _tokenDecimals(token),
            active: true,
            createdAt: block.timestamp
        });

        emit Listed(listingId, msg.sender, token, received, unitPrice);
    }

    /// @dev `decimals()` is an optional ERC-20 extension; fall back to 0 (per-base-unit
    ///      pricing) for tokens that do not implement it, matching the legacy behaviour.
    function _tokenDecimals(address token) private view returns (uint8) {
        try IERC20Metadata(token).decimals() returns (uint8 d) {
            return d;
        } catch {
            return 0;
        }
    }

    // ── Filling
    // ───────────────────────────────────────────────────

    function fill(uint256 listingId, uint256 qty) external payable nonReentrant whenNotPaused {
        if (qty == 0) revert ZeroQuantity();

        OTCStorage storage $ = _getStorage();
        OTCListing storage listing = $.listings[listingId];
        if (!listing.active) revert ListingNotActive();

        uint256 available = listing.totalAmount - listing.filledAmount;
        if (qty > available) revert ExceedsAvailable();

        // `unitPrice` is wei per WHOLE token; `qty` is base units. Convert through the
        // token's decimals, rounding UP so a sub-unit purchase can never round to a free
        // buy (A-4, the EVM twin of the Gno OTC bug fixed in memba#992).
        uint256 totalCost = Math.mulDiv(qty, listing.unitPrice, 10 ** listing.tokenDecimals, Math.Rounding.Ceil);
        if (msg.value < totalCost) revert InsufficientPayment();

        // CEI: state update BEFORE transfers
        listing.filledAmount += qty;
        if (listing.filledAmount == listing.totalAmount) {
            listing.active = false;
        }

        // Calculate fee
        uint256 fee = (totalCost * $.platformFeeBps) / 10_000;
        uint256 sellerProceeds = totalCost - fee;

        // Transfer tokens to buyer
        IERC20(listing.token).safeTransfer(msg.sender, qty);

        // Transfer ETH to seller
        (bool ok,) = payable(listing.seller).call{ value: sellerProceeds }("");
        if (!ok) revert TransferFailed();

        // Transfer fee
        if (fee > 0) {
            (bool feeOk,) = payable($.feeRecipient).call{ value: fee }("");
            if (!feeOk) revert TransferFailed();
        }

        // Refund excess ETH
        if (msg.value > totalCost) {
            (bool refundOk,) = payable(msg.sender).call{ value: msg.value - totalCost }("");
            if (!refundOk) revert TransferFailed();
        }

        emit Filled(listingId, msg.sender, qty, totalCost);
        if (fee > 0) emit FeeCollected(listingId, fee);
    }

    // ── Cancel
    // ────────────────────────────────────────────────────

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

    // ── View
    // ──────────────────────────────────────────────────────

    function getListing(uint256 id) external view returns (OTCListing memory) {
        return _getStorage().listings[id];
    }

    function listingCount() external view returns (uint256) {
        return _getStorage().listingCount;
    }

    function admin() external view returns (address) {
        return _getStorage().admin;
    }

    function feeRecipient() external view returns (address) {
        return _getStorage().feeRecipient;
    }

    function platformFeeBps() external view returns (uint16) {
        return _getStorage().platformFeeBps;
    }

    function setPlatformFee(uint16 newFeeBps) external onlyAdmin {
        if (newFeeBps > MAX_FEE_BPS) revert InvalidFeeBps();
        _getStorage().platformFeeBps = newFeeBps;
        emit PlatformFeeUpdated(newFeeBps);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    function _authorizeUpgrade(address) internal override onlyUpgrader { }
}
