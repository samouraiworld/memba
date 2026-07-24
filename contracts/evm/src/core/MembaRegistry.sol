// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title MembaRegistry
 * @author Samouraï Coop
 * @notice Global directory of all deployed Memba DAOs and platform configuration.
 *         Cross-DAO discovery, search, and platform-wide fee/treasury settings.
 */
contract MembaRegistry is UUPSUpgradeable {
    enum DAOCategory { Governance, Community, Treasury, DeFi, Infrastructure }

    struct DAOEntry {
        address daoContract;
        string name;
        DAOCategory category;
        address creator;
        uint256 registeredAt;
        bool verified;
    }

    /// @custom:storage-location erc7201:memba.storage.MembaRegistry
    struct RegistryStorage {
        address admin;
        uint256 entryCount;
        mapping(uint256 => DAOEntry) entries;
        mapping(address => uint256) daoToId; // dao address → entry ID
        uint256[] entryIds;
        // Platform config
        address treasury;
        uint16 defaultFeeBps;
    }

    bytes32 private constant STORAGE_LOCATION = 0xe8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d70000;
    function _getStorage() private pure returns (RegistryStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    error NotAdmin();
    error AlreadyRegistered();
    error NotFound();
    error InvalidParams();

    event DAORegistered(uint256 indexed id, address indexed daoContract, string name, DAOCategory category);
    event DAOVerified(uint256 indexed id);
    event ConfigUpdated(address treasury, uint16 feeBps);

    modifier onlyAdmin() { if (msg.sender != _getStorage().admin) revert NotAdmin(); _; }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _admin, address _treasury, uint16 _defaultFeeBps) external initializer {
        if (_admin == address(0)) revert InvalidParams();
        __UUPSUpgradeable_init();
        RegistryStorage storage $ = _getStorage();
        $.admin = _admin;
        $.treasury = _treasury;
        $.defaultFeeBps = _defaultFeeBps;
    }

    function registerDAO(
        address daoContract,
        string calldata name,
        DAOCategory category
    ) external returns (uint256 id) {
        if (daoContract == address(0) || bytes(name).length == 0) revert InvalidParams();
        RegistryStorage storage $ = _getStorage();
        if ($.daoToId[daoContract] != 0 && $.entries[$.daoToId[daoContract]].daoContract != address(0)) {
            revert AlreadyRegistered();
        }

        id = ++$.entryCount; // 1-indexed to distinguish from default 0
        $.entries[id] = DAOEntry({
            daoContract: daoContract,
            name: name,
            category: category,
            creator: msg.sender,
            registeredAt: block.timestamp,
            verified: false
        });
        $.daoToId[daoContract] = id;
        $.entryIds.push(id);

        emit DAORegistered(id, daoContract, name, category);
    }

    function verifyDAO(uint256 id) external onlyAdmin {
        RegistryStorage storage $ = _getStorage();
        if ($.entries[id].daoContract == address(0)) revert NotFound();
        $.entries[id].verified = true;
        emit DAOVerified(id);
    }

    function updateConfig(address _treasury, uint16 _feeBps) external onlyAdmin {
        RegistryStorage storage $ = _getStorage();
        $.treasury = _treasury;
        $.defaultFeeBps = _feeBps;
        emit ConfigUpdated(_treasury, _feeBps);
    }

    function getDAO(uint256 id) external view returns (DAOEntry memory) { return _getStorage().entries[id]; }
    function getDAOByAddress(address dao) external view returns (DAOEntry memory) {
        return _getStorage().entries[_getStorage().daoToId[dao]];
    }
    function listDAOs() external view returns (uint256[] memory) { return _getStorage().entryIds; }
    function entryCount() external view returns (uint256) { return _getStorage().entryCount; }
    function treasury() external view returns (address) { return _getStorage().treasury; }
    function defaultFeeBps() external view returns (uint16) { return _getStorage().defaultFeeBps; }
    function admin() external view returns (address) { return _getStorage().admin; }
    function version() external pure returns (string memory) { return "1.0.0"; }

    function _authorizeUpgrade(address) internal override onlyAdmin { }
}
