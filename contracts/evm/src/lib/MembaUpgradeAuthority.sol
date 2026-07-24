// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title MembaUpgradeAuthority
 * @author Samouraï Coop
 * @notice Holds the single address permitted to replace a proxy's implementation,
 *         and the two-step ceremony for moving that right.
 *
 * @dev Why this exists as a separate base rather than another field on each contract.
 *
 *      Upgrade authority was previously whatever operational role each contract
 *      happened to have. On `MembaBadges` that was `onlyMinter` and on `MembaQuests`
 *      `onlyVerifier` — both set from BACKEND_VERIFIER, the Fly.io server key. A
 *      server compromise therefore let an attacker replace those contracts wholesale.
 *      Conflating "may mint a badge" with "may replace all the code" is the actual
 *      defect; giving upgrade authority its own home is what stops it recurring.
 *
 *      No contract had any way to rotate that authority either, so a lost or stolen
 *      key was permanent — it would simultaneously brick upgrades and, on several
 *      contracts, dispute resolution. Rotation here is deliberately two-step: a
 *      single-step transfer to a typo'd or unreachable address is unrecoverable, and
 *      unrecoverable is exactly the failure mode being removed.
 *
 *      The authority is expected to be a `TimelockController` in production, with the
 *      Safe as its proposer/executor. That is a deployment concern — this contract
 *      only has to make the address rotatable so the handoff is possible.
 *
 *      Storage lives in its own ERC-7201 namespace so that adopting this base does not
 *      disturb any existing contract's storage struct.
 */
abstract contract MembaUpgradeAuthority is Initializable {
    /// @custom:storage-location erc7201:memba.storage.MembaUpgradeAuthority
    struct UpgradeAuthorityStorage {
        address upgrader;
        address pendingUpgrader;
    }

    // Derivation:
    //   keccak256(abi.encode(uint256(keccak256("memba.storage.MembaUpgradeAuthority")) - 1))
    //     & ~bytes32(uint256(0xff))
    // Asserted against that derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant UPGRADE_AUTHORITY_STORAGE_LOCATION =
        0x8ea3794335f90ee0b732cebf8c5a97e428d9d49867d8dcf09199228935f18c00;

    function _getUpgradeAuthorityStorage() private pure returns (UpgradeAuthorityStorage storage $) {
        bytes32 loc = UPGRADE_AUTHORITY_STORAGE_LOCATION;
        assembly {
            $.slot := loc
        }
    }

    error NotUpgrader();
    error NotPendingUpgrader();
    error InvalidUpgrader();

    event UpgraderTransferStarted(address indexed currentUpgrader, address indexed pendingUpgrader);
    event UpgraderTransferred(address indexed oldUpgrader, address indexed newUpgrader);

    modifier onlyUpgrader() {
        if (msg.sender != _getUpgradeAuthorityStorage().upgrader) revert NotUpgrader();
        _;
    }

    // solhint-disable-next-line func-name-mixedcase
    function __MembaUpgradeAuthority_init(address initialUpgrader) internal onlyInitializing {
        if (initialUpgrader == address(0)) revert InvalidUpgrader();
        _getUpgradeAuthorityStorage().upgrader = initialUpgrader;
        emit UpgraderTransferred(address(0), initialUpgrader);
    }

    /// @notice The only address that may authorise an implementation change.
    function upgrader() external view returns (address) {
        return _getUpgradeAuthorityStorage().upgrader;
    }

    /// @notice The nominated successor, if a rotation is in flight.
    function pendingUpgrader() external view returns (address) {
        return _getUpgradeAuthorityStorage().pendingUpgrader;
    }

    /// @notice Nominate a new upgrade authority. Takes effect only once the nominee
    ///         calls `acceptUpgrader`, so a wrong address cannot strand the contract.
    /// @dev Passing `address(0)` cancels an in-flight rotation.
    function transferUpgrader(address newUpgrader) external onlyUpgrader {
        UpgradeAuthorityStorage storage $ = _getUpgradeAuthorityStorage();
        $.pendingUpgrader = newUpgrader;
        emit UpgraderTransferStarted($.upgrader, newUpgrader);
    }

    /// @notice Accept a nominated transfer. Callable only by the nominee.
    function acceptUpgrader() external {
        UpgradeAuthorityStorage storage $ = _getUpgradeAuthorityStorage();
        if (msg.sender != $.pendingUpgrader || msg.sender == address(0)) revert NotPendingUpgrader();

        address old = $.upgrader;
        $.upgrader = msg.sender;
        $.pendingUpgrader = address(0);
        emit UpgraderTransferred(old, msg.sender);
    }
}
