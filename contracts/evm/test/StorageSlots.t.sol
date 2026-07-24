// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

/// @title StorageSlots
/// @notice Pins every ERC-7201 `STORAGE_LOCATION` constant to its documented derivation.
///
/// @dev Why this test exists.
///
/// All 14 namespaced constants originally shipped as fabricated values: 13 were hand-typed
/// hex patterns, and `MembaDAO`'s was produced with `cast index bytes32 <v> 0` — which computes
/// a *mapping* slot, `keccak256(key ++ slot)` over 64 bytes, rather than ERC-7201's
/// `keccak256(key)` over 32. The output looked plausible and every test passed, because
/// `_getStorage()` uses whatever constant it is given, consistently.
///
/// That is what made it dangerous. A contract whose comment states a derivation its value does
/// not satisfy invites a future maintainer, linter, or upgrade-plugin run to "correct" it. On a
/// deployed, value-bearing proxy that correction relocates the entire storage struct: `admin`
/// reads `address(0)` (so `_authorizeUpgrade` becomes permanently unreachable — no later upgrade
/// can repair it) and counters reset to zero, so the next write overwrites live state.
///
/// These constants are therefore append-only facts once deployed. This test asserts the source
/// literal still equals the derivation, so the two can never silently diverge again.
///
/// The assertion reads the source file rather than the constant because `STORAGE_LOCATION` is
/// `private`. That is deliberate: it pins the *literal a reviewer sees*, which is precisely the
/// thing that drifted.
contract StorageSlotsTest is Test {
    /// @dev The ERC-7201 formula, in one place.
    function _erc7201(string memory namespace) internal pure returns (bytes32) {
        return keccak256(abi.encode(uint256(keccak256(bytes(namespace))) - 1)) & ~bytes32(uint256(0xff));
    }

    /// @dev Substring search — forge-std has no portable `contains` for strings.
    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function _assertSlot(string memory path, string memory namespace) internal view {
        string memory src = vm.readFile(path);
        string memory expected = vm.toString(_erc7201(namespace));
        assertTrue(
            _contains(src, expected),
            string.concat(
                "STORAGE_LOCATION in ",
                path,
                " does not match erc7201:",
                namespace,
                " (expected ",
                expected,
                "). Do NOT edit this on a deployed contract - see the note at the top of this file."
            )
        );
    }

    function test_AllStorageSlotsMatchTheirDerivation() public view {
        _assertSlot("src/core/MembaDAO.sol", "memba.storage.MembaDAO");
        _assertSlot("src/core/MembaCandidature.sol", "memba.storage.MembaCandidature");
        _assertSlot("src/core/MembaChannels.sol", "memba.storage.MembaChannels");
        _assertSlot("src/core/MembaRegistry.sol", "memba.storage.MembaRegistry");
        _assertSlot("src/commerce/MembaEscrow.sol", "memba.storage.MembaEscrow");
        _assertSlot("src/commerce/MembaTokenFactory.sol", "memba.storage.MembaTokenFactory");
        _assertSlot("src/commerce/MembaTokenOTC.sol", "memba.storage.MembaTokenOTC");
        _assertSlot("src/commerce/MembaNFT.sol", "memba.storage.MembaNFT");
        _assertSlot("src/commerce/MembaCollections.sol", "memba.storage.MembaCollections");
        _assertSlot("src/social/MembaReviews.sol", "memba.storage.MembaReviews");
        _assertSlot("src/social/MembaBadges.sol", "memba.storage.MembaBadges");
        _assertSlot("src/social/MembaQuests.sol", "memba.storage.MembaQuests");
        _assertSlot("src/social/MembaPoints.sol", "memba.storage.MembaPoints");
        _assertSlot("src/social/MembaAppStore.sol", "memba.storage.MembaAppStore");
        // Shared base: upgrade authority lives in its own namespace so that adopting
        // it did not have to disturb any existing contract's storage struct.
        _assertSlot("src/lib/MembaUpgradeAuthority.sol", "memba.storage.MembaUpgradeAuthority");
    }

    /// @dev A namespace collision would silently alias two contracts' storage onto the
    ///      same slot. Cheap to assert, catastrophic to miss.
    function test_AllNamespacesAreDistinct() public pure {
        string[15] memory namespaces = [
            "memba.storage.MembaDAO",
            "memba.storage.MembaCandidature",
            "memba.storage.MembaChannels",
            "memba.storage.MembaRegistry",
            "memba.storage.MembaEscrow",
            "memba.storage.MembaTokenFactory",
            "memba.storage.MembaTokenOTC",
            "memba.storage.MembaNFT",
            "memba.storage.MembaCollections",
            "memba.storage.MembaReviews",
            "memba.storage.MembaBadges",
            "memba.storage.MembaQuests",
            "memba.storage.MembaPoints",
            "memba.storage.MembaAppStore",
            "memba.storage.MembaUpgradeAuthority"
        ];
        for (uint256 i = 0; i < namespaces.length; i++) {
            for (uint256 j = i + 1; j < namespaces.length; j++) {
                assertTrue(_erc7201(namespaces[i]) != _erc7201(namespaces[j]), "two namespaces derive to the same slot");
            }
        }
    }

    /// @dev Negative control: proves the assertion can actually fail.
    ///      A gate never observed failing is not a gate.
    function test_DerivationRejectsAWrongSlot() public pure {
        bytes32 correct = _erc7201("memba.storage.MembaEscrow");
        // The original fabricated value.
        bytes32 fabricated = 0xb4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a50000;
        assertTrue(correct != fabricated, "derivation must not reproduce the fabricated constant");
    }

    /// @dev Pins the formula itself against a known-good third-party value, so a mistake in
    ///      `_erc7201` cannot make the whole suite vacuously green.
    function test_FormulaMatchesOpenZeppelinsPublishedSlot() public pure {
        assertEq(
            _erc7201("openzeppelin.storage.Initializable"),
            0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00,
            "erc7201 formula is wrong"
        );
    }
}
