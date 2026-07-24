// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { MembaEscrow } from "../../src/commerce/MembaEscrow.sol";
import { MembaBadges } from "../../src/social/MembaBadges.sol";
import { MembaQuests } from "../../src/social/MembaQuests.sol";

/// @notice V2 stubs used to prove an upgrade actually happens and that storage
///         survives it.
/// @dev Each APPENDS one function and adds no storage of its own, which is the only
///      shape that is safe under ERC-7201 namespaced layout. Nothing in the repo had
///      ever executed `upgradeToAndCall`, so the entire upgrade path of an
///      upgradeable system was untested — including whether a non-authority is
///      rejected.
contract MembaEscrowV2 is MembaEscrow {
    function v2Marker() external pure returns (string memory) {
        return "escrow-v2";
    }
}

contract MembaBadgesV2 is MembaBadges {
    function v2Marker() external pure returns (string memory) {
        return "badges-v2";
    }
}

contract MembaQuestsV2 is MembaQuests {
    function v2Marker() external pure returns (string memory) {
        return "quests-v2";
    }
}
