// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from
    "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title MembaTokenFactory
 * @author Samouraï Coop
 * @notice ERC-20 token factory with 2.5% platform mint fee.
 *         Port of the Gno `tokenfactory_v2` realm.
 *         Deploys new ERC-20 tokens via CREATE2 for deterministic addressing.
 * @dev UUPS-upgradeable. Fee recipient is the Samouraï Coop Safe multisig.
 *
 * TODO: Implement per docs/evm-migration/CONTRACT_SPECS/MembaTokenFactory.spec.md
 */
contract MembaTokenFactory is UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    // ── Constants ─────────────────────────────────────────────────
    /// @notice Platform fee: 250 basis points = 2.5%
    uint16 public constant PLATFORM_FEE_BPS = 250;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    // ── Storage ───────────────────────────────────────────────────
    address public feeRecipient;
    address public admin;
    uint256 public tokenCount;
    mapping(uint256 => address) public tokens;
    mapping(address => bool) public isMembaToken;

    // ── Events ────────────────────────────────────────────────────
    event TokenCreated(
        uint256 indexed tokenId, address indexed tokenAddress, address indexed creator, string name, string symbol
    );
    event FeeCollected(address indexed token, address indexed payer, uint256 feeAmount);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    // ── Errors ────────────────────────────────────────────────────
    error NotAdmin();
    error InvalidRecipient();
    error InvalidParams();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _admin, address _feeRecipient) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        if (_admin == address(0) || _feeRecipient == address(0)) revert InvalidParams();
        admin = _admin;
        feeRecipient = _feeRecipient;
    }

    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address) internal override {
        if (msg.sender != admin) revert NotAdmin();
    }

    /// @notice Returns the contract version.
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
