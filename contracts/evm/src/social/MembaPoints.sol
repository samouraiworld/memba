// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { MembaUpgradeAuthority } from "../lib/MembaUpgradeAuthority.sol";

/**
 * @title MembaPoints
 * @author Samouraï Coop
 * @notice On-chain reputation points ledger with tier assignment.
 *         Points awarded by authorized awarders. Tier bands configurable.
 *         Port of the Gno `memba_points_v1` realm.
 */
contract MembaPoints is UUPSUpgradeable, MembaUpgradeAuthority {
    struct TierBand {
        string name;
        uint256 minPoints;
    }

    /// @custom:storage-location erc7201:memba.storage.MembaPoints
    struct PointsStorage {
        address admin;
        mapping(address => bool) awarders;
        mapping(address => uint256) points;
        address[] holders;
        mapping(address => bool) isHolder;
        TierBand[] tiers; // sorted ascending by minPoints
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("memba.storage.MembaPoints")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev Asserted against its derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant STORAGE_LOCATION = 0x71f7b67fd09da12e84a20be9ab8db0d779ae7ab777b5cef22bb5f7180653af00;

    function _getStorage() private pure returns (PointsStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    error NotAdmin();
    error NotAwarder();
    error InvalidParams();

    event PointsAwarded(address indexed user, uint256 amount, uint256 total);
    event AwarderUpdated(address indexed awarder, bool authorized);

    modifier onlyAdmin() {
        if (msg.sender != _getStorage().admin) revert NotAdmin();
        _;
    }
    modifier onlyAwarder() {
        if (!_getStorage().awarders[msg.sender]) revert NotAwarder();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _admin) external initializer {
        if (_admin == address(0)) revert InvalidParams();
        __UUPSUpgradeable_init();
        PointsStorage storage $ = _getStorage();
        $.admin = _admin;
        __MembaUpgradeAuthority_init(_admin);
        $.awarders[_admin] = true;

        // Default tiers
        $.tiers.push(TierBand("Bronze", 0));
        $.tiers.push(TierBand("Silver", 100));
        $.tiers.push(TierBand("Gold", 500));
        $.tiers.push(TierBand("Diamond", 2000));
    }

    function award(address user, uint256 amount) external onlyAwarder {
        if (user == address(0) || amount == 0) revert InvalidParams();
        PointsStorage storage $ = _getStorage();
        $.points[user] += amount;
        if (!$.isHolder[user]) $.holders.push(user);
        $.isHolder[user] = true;
        emit PointsAwarded(user, amount, $.points[user]);
    }

    function setAwarder(address awarder, bool authorized) external onlyAdmin {
        _getStorage().awarders[awarder] = authorized;
        emit AwarderUpdated(awarder, authorized);
    }

    function getPoints(address user) external view returns (uint256) {
        return _getStorage().points[user];
    }

    function getTier(address user) external view returns (string memory) {
        PointsStorage storage $ = _getStorage();
        uint256 pts = $.points[user];
        string memory tier = "";
        for (uint256 i = 0; i < $.tiers.length; i++) {
            if (pts >= $.tiers[i].minPoints) tier = $.tiers[i].name;
        }
        return tier;
    }

    function getHolderCount() external view returns (uint256) {
        return _getStorage().holders.length;
    }

    function admin() external view returns (address) {
        return _getStorage().admin;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    function _authorizeUpgrade(address) internal override onlyUpgrader { }
}
