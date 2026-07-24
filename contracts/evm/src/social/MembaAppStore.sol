// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/**
 * @title MembaAppStore
 * @author Samouraï Coop
 * @notice On-chain dApp registry with lifecycle: submit → review → live/rejected → delist.
 *         Port of the Gno `memba_appstore_v2` realm.
 */
contract MembaAppStore is UUPSUpgradeable, PausableUpgradeable {
    enum AppStatus { Pending, Live, Rejected, Delisted }

    struct AppInfo {
        address publisher;
        string name;
        string tagline;
        string category;
        string iconCID;
        string appURL;
        AppStatus status;
        string rejectReason;
        uint256 submittedAt;
        uint256 flags;
    }

    /// @custom:storage-location erc7201:memba.storage.MembaAppStore
    struct AppStoreStorage {
        address admin;
        uint256 creationFee;
        address feeRecipient;
        uint256 appCount;
        mapping(bytes32 => AppInfo) apps;
        bytes32[] appHashes;
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("memba.storage.MembaAppStore")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev Asserted against its derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant STORAGE_LOCATION = 0x1b76022bc8d05912a3da534c83104e9a39b1db879fc38932cb1a571eaa0a3c00;
    function _getStorage() private pure returns (AppStoreStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    error NotAdmin();
    error NotPublisher();
    error AppExists();
    error AppNotFound();
    error InvalidStatus();
    error InsufficientFee();
    error InvalidParams();
    error TransferFailed();

    event AppRegistered(bytes32 indexed appHash, string name, address indexed publisher);
    event AppApproved(bytes32 indexed appHash);
    event AppRejected(bytes32 indexed appHash, string reason);
    event AppDelisted(bytes32 indexed appHash);
    event AppFlagged(bytes32 indexed appHash, address indexed flagger);

    modifier onlyAdmin() { if (msg.sender != _getStorage().admin) revert NotAdmin(); _; }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _admin, address _feeRecipient, uint256 _creationFee) external initializer {
        if (_admin == address(0) || _feeRecipient == address(0)) revert InvalidParams();
        __UUPSUpgradeable_init();
        __Pausable_init();
        AppStoreStorage storage $ = _getStorage();
        $.admin = _admin;
        $.feeRecipient = _feeRecipient;
        $.creationFee = _creationFee;
    }

    function registerApp(
        string calldata pkgPath,
        string calldata name,
        string calldata tagline,
        string calldata category,
        string calldata iconCID,
        string calldata appURL
    ) external payable whenNotPaused {
        if (bytes(name).length == 0 || bytes(pkgPath).length == 0) revert InvalidParams();
        AppStoreStorage storage $ = _getStorage();
        if (msg.value < $.creationFee) revert InsufficientFee();

        bytes32 appHash = keccak256(bytes(pkgPath));
        if ($.apps[appHash].publisher != address(0)) revert AppExists();

        $.apps[appHash] = AppInfo({
            publisher: msg.sender,
            name: name,
            tagline: tagline,
            category: category,
            iconCID: iconCID,
            appURL: appURL,
            status: AppStatus.Pending,
            rejectReason: "",
            submittedAt: block.timestamp,
            flags: 0
        });
        $.appHashes.push(appHash);
        $.appCount++;

        if (msg.value > 0) {
            (bool ok,) = payable($.feeRecipient).call{value: msg.value}("");
            if (!ok) revert TransferFailed();
        }

        emit AppRegistered(appHash, name, msg.sender);
    }

    function approveApp(bytes32 appHash) external onlyAdmin {
        AppStoreStorage storage $ = _getStorage();
        if ($.apps[appHash].publisher == address(0)) revert AppNotFound();
        if ($.apps[appHash].status != AppStatus.Pending) revert InvalidStatus();
        $.apps[appHash].status = AppStatus.Live;
        emit AppApproved(appHash);
    }

    function rejectApp(bytes32 appHash, string calldata reason) external onlyAdmin {
        AppStoreStorage storage $ = _getStorage();
        if ($.apps[appHash].publisher == address(0)) revert AppNotFound();
        $.apps[appHash].status = AppStatus.Rejected;
        $.apps[appHash].rejectReason = reason;
        emit AppRejected(appHash, reason);
    }

    function delistApp(bytes32 appHash) external onlyAdmin {
        AppStoreStorage storage $ = _getStorage();
        if ($.apps[appHash].publisher == address(0)) revert AppNotFound();
        $.apps[appHash].status = AppStatus.Delisted;
        emit AppDelisted(appHash);
    }

    function flagApp(bytes32 appHash) external {
        AppStoreStorage storage $ = _getStorage();
        if ($.apps[appHash].publisher == address(0)) revert AppNotFound();
        $.apps[appHash].flags++;
        emit AppFlagged(appHash, msg.sender);
    }

    function getApp(bytes32 appHash) external view returns (AppInfo memory) { return _getStorage().apps[appHash]; }
    function listApps() external view returns (bytes32[] memory) { return _getStorage().appHashes; }
    function appCount() external view returns (uint256) { return _getStorage().appCount; }
    function admin() external view returns (address) { return _getStorage().admin; }
    function version() external pure returns (string memory) { return "1.0.0"; }

    function pause() external onlyAdmin { _pause(); }
    function unpause() external onlyAdmin { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyAdmin { }
}
