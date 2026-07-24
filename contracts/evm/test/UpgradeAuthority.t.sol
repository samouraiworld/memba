// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { MembaEscrow } from "../src/commerce/MembaEscrow.sol";
import { MembaUpgradeAuthority } from "../src/lib/MembaUpgradeAuthority.sol";
import { MembaBadges } from "../src/social/MembaBadges.sol";
import { MembaQuests } from "../src/social/MembaQuests.sol";
import { MembaEscrowV2, MembaBadgesV2, MembaQuestsV2 } from "./mocks/UpgradeV2.sol";

/// @title UpgradeAuthority
/// @notice Who may replace the code behind a proxy, and how that right is moved.
///
/// @dev Two defects motivate this file.
///
///      ISSUE-003: `MembaBadges._authorizeUpgrade` was gated on `onlyMinter` and
///      `MembaQuests._authorizeUpgrade` on `onlyVerifier`, and the deploy script set
///      both from BACKEND_VERIFIER — the Fly.io operational key. A server compromise
///      therefore handed an attacker the right to replace those contracts outright.
///      The fallback was no better: leave the variable unset and it defaults to the
///      Safe, so the backend cannot mint and the feature simply does not work.
///
///      ISSUE-004: no contract had any way to rotate its upgrade authority, and
///      `grep -ri timelock src/` returned nothing at all — while §17.2 of the plan
///      makes a 48h timelock on upgrades a mandatory requirement. A lost or stolen
///      key was permanent, and an upgrade could land with no warning and no exit
///      window for users holding funds in escrow.
contract UpgradeAuthorityTest is Test {
    MembaEscrow public escrow;
    MembaBadges public badges;
    MembaQuests public quests;

    address public adminAddr = makeAddr("admin");
    address public feeWallet = makeAddr("feeWallet");
    address public backendKey = makeAddr("backendHotKey");
    address public safe = makeAddr("safe");
    address public attacker = makeAddr("attacker");

    uint256 public constant TIMELOCK_DELAY = 48 hours;

    function setUp() public {
        MembaEscrow eImpl = new MembaEscrow();
        escrow = MembaEscrow(
            address(
                new ERC1967Proxy(
                    address(eImpl), abi.encodeCall(MembaEscrow.initialize, (adminAddr, feeWallet, 200, 500, 30 days))
                )
            )
        );

        // The backend key is the minter/verifier — its legitimate operational role.
        MembaBadges bImpl = new MembaBadges();
        badges = MembaBadges(
            address(new ERC1967Proxy(address(bImpl), abi.encodeCall(MembaBadges.initialize, (backendKey, safe))))
        );

        MembaQuests qImpl = new MembaQuests();
        quests = MembaQuests(
            address(new ERC1967Proxy(address(qImpl), abi.encodeCall(MembaQuests.initialize, (backendKey, safe))))
        );

        vm.warp(1_000_000);
    }

    // ══════════════════════════════════════════════════════════
    // ISSUE-003 — the operational hot key is not an upgrade key
    // ══════════════════════════════════════════════════════════

    function test_BadgesMinterCannotUpgrade() public {
        address v2 = address(new MembaBadgesV2());
        vm.prank(backendKey);
        vm.expectRevert();
        UUPSUpgradeable(address(badges)).upgradeToAndCall(v2, "");
    }

    function test_QuestsVerifierCannotUpgrade() public {
        address v2 = address(new MembaQuestsV2());
        vm.prank(backendKey);
        vm.expectRevert();
        UUPSUpgradeable(address(quests)).upgradeToAndCall(v2, "");
    }

    /// The minter must keep working — separating the roles must not break the feature.
    function test_MinterStillMints() public {
        vm.prank(backendKey);
        badges.mint(attacker, "quest-1", "ipfs://badge", true);
        assertEq(badges.balanceOf(attacker), 1);
    }

    function test_UpgraderCanUpgradeBadges() public {
        address v2 = address(new MembaBadgesV2());
        vm.prank(safe);
        UUPSUpgradeable(address(badges)).upgradeToAndCall(v2, "");
        assertEq(MembaBadgesV2(address(badges)).v2Marker(), "badges-v2");
    }

    function test_RandomAddressCannotUpgrade() public {
        address v2 = address(new MembaEscrowV2());
        vm.prank(attacker);
        vm.expectRevert();
        UUPSUpgradeable(address(escrow)).upgradeToAndCall(v2, "");
    }

    // ══════════════════════════════════════════════════════════
    // ISSUE-003 — rotation is two-step and cannot be done alone
    // ══════════════════════════════════════════════════════════

    function test_TransferAloneDoesNotMoveAuthority() public {
        address newUpgrader = makeAddr("newUpgrader");

        vm.prank(adminAddr);
        escrow.transferUpgrader(newUpgrader);

        // Until accepted, the old authority still holds and the new one does not.
        address v2 = address(new MembaEscrowV2());
        vm.prank(newUpgrader);
        vm.expectRevert();
        UUPSUpgradeable(address(escrow)).upgradeToAndCall(v2, "");
        assertEq(escrow.upgrader(), adminAddr, "authority moved without acceptance");
    }

    function test_AcceptCompletesRotation() public {
        address newUpgrader = makeAddr("newUpgrader");

        vm.prank(adminAddr);
        escrow.transferUpgrader(newUpgrader);
        vm.prank(newUpgrader);
        escrow.acceptUpgrader();

        assertEq(escrow.upgrader(), newUpgrader);

        address v2 = address(new MembaEscrowV2());
        vm.prank(newUpgrader);
        UUPSUpgradeable(address(escrow)).upgradeToAndCall(v2, "");
        assertEq(MembaEscrowV2(address(escrow)).v2Marker(), "escrow-v2");
    }

    /// A typo'd address must not be able to strand the contract: only the nominated
    /// account can accept, and the old authority keeps working until it does.
    function test_OnlyPendingUpgraderCanAccept() public {
        vm.prank(adminAddr);
        escrow.transferUpgrader(makeAddr("intended"));

        vm.prank(attacker);
        vm.expectRevert();
        escrow.acceptUpgrader();
    }

    function test_NonUpgraderCannotInitiateTransfer() public {
        vm.prank(attacker);
        vm.expectRevert();
        escrow.transferUpgrader(attacker);
    }

    // ══════════════════════════════════════════════════════════
    // H-2 — storage must survive an upgrade
    // ══════════════════════════════════════════════════════════

    /// No test in the repo had ever called `upgradeToAndCall`, so nothing verified
    /// that live state survives one. This is also the regression test for the
    /// fabricated-storage-slot class: a V2 whose namespace moved would read zeroes.
    function test_StorageSurvivesUpgrade() public {
        address buyer = makeAddr("buyer");
        address seller = makeAddr("seller");
        vm.deal(buyer, 100 ether);

        string[] memory titles = new string[](1);
        titles[0] = "m";
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 5 ether;

        vm.prank(buyer);
        uint256 id = escrow.createContract(seller, "Project", titles, amounts);
        vm.prank(buyer);
        escrow.fundMilestone{ value: 5 ether }(id, 0);

        // Deploy V2 BEFORE the prank: a contract creation on the pranked line
        // consumes the prank, so the upgrade would run as the test contract.
        address v2 = address(new MembaEscrowV2());
        vm.prank(adminAddr);
        UUPSUpgradeable(address(escrow)).upgradeToAndCall(v2, "");

        MembaEscrow.ServiceContract memory sc = escrow.getContract(id);
        assertEq(sc.buyer, buyer, "buyer lost across upgrade");
        assertEq(sc.seller, seller, "seller lost across upgrade");
        assertEq(sc.totalFunded, 5 ether, "funding lost across upgrade");
        assertEq(escrow.admin(), adminAddr, "admin lost across upgrade");
        assertEq(address(escrow).balance, 5 ether, "ETH lost across upgrade");
        assertEq(MembaEscrowV2(address(escrow)).v2Marker(), "escrow-v2");
    }

    // ══════════════════════════════════════════════════════════
    // ISSUE-004 — a timelock actually delays upgrades
    // ══════════════════════════════════════════════════════════

    /// The plan (§17.2) mandates a 48h minimum delay on every upgrade. Nothing
    /// implemented it, so a single Safe transaction could swap the implementation of
    /// a fund-holding contract instantly, with no user exit window.
    function test_TimelockEnforcesDelayOnUpgrade() public {
        address[] memory proposers = new address[](1);
        proposers[0] = safe;
        address[] memory executors = new address[](1);
        executors[0] = safe;
        TimelockController timelock = new TimelockController(TIMELOCK_DELAY, proposers, executors, address(0));

        // Hand upgrade authority to the timelock.
        vm.prank(adminAddr);
        escrow.transferUpgrader(address(timelock));
        vm.prank(safe);
        timelock.schedule(
            address(escrow),
            0,
            abi.encodeCall(MembaUpgradeAuthority.acceptUpgrader, ()),
            bytes32(0),
            bytes32(0),
            TIMELOCK_DELAY
        );
        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);
        vm.prank(safe);
        timelock.execute(
            address(escrow), 0, abi.encodeCall(MembaUpgradeAuthority.acceptUpgrader, ()), bytes32(0), bytes32(0)
        );
        assertEq(escrow.upgrader(), address(timelock));

        // An upgrade now has to go through the timelock, and cannot land early.
        bytes memory upgradeCall = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(new MembaEscrowV2()), ""));
        vm.prank(safe);
        timelock.schedule(address(escrow), 0, upgradeCall, bytes32(0), bytes32("salt"), TIMELOCK_DELAY);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(safe);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, upgradeCall, bytes32(0), bytes32("salt"));

        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.prank(safe);
        timelock.execute(address(escrow), 0, upgradeCall, bytes32(0), bytes32("salt"));
        assertEq(MembaEscrowV2(address(escrow)).v2Marker(), "escrow-v2");
    }
}
