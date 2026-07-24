// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaQuests } from "../src/social/MembaQuests.sol";
import { MembaPoints } from "../src/social/MembaPoints.sol";
import { MembaAppStore } from "../src/social/MembaAppStore.sol";
import { MembaRegistry } from "../src/core/MembaRegistry.sol";

// ══════════════════════════════════════════════════════════════
// MembaQuests Tests
// ══════════════════════════════════════════════════════════════

contract MembaQuestsTest is Test {
    MembaQuests public quests;
    address public verifier = makeAddr("verifier");
    address public upgraderAddr = makeAddr("upgrader");
    address public alice = makeAddr("alice");
    address public outsider = makeAddr("outsider");

    function setUp() public {
        MembaQuests impl = new MembaQuests();
        bytes memory initData = abi.encodeCall(MembaQuests.initialize, (verifier, upgraderAddr));
        address proxy = address(new ERC1967Proxy(address(impl), initData));
        quests = MembaQuests(proxy);
    }

    function test_Attest_Success() public {
        vm.prank(verifier);
        uint256 id = quests.attest(alice, "quest-onboard", 100, bytes32(uint256(42)));
        assertEq(id, 0);
        assertEq(quests.getUserXP(alice), 100);
        assertTrue(quests.isCompleted(alice, "quest-onboard"));
    }

    function test_Attest_DuplicateReverts() public {
        vm.prank(verifier);
        quests.attest(alice, "quest-1", 50, bytes32(0));
        vm.prank(verifier);
        vm.expectRevert(MembaQuests.AlreadyCompleted.selector);
        quests.attest(alice, "quest-1", 50, bytes32(0));
    }

    function test_Attest_NonVerifierReverts() public {
        vm.prank(outsider);
        vm.expectRevert(MembaQuests.NotVerifier.selector);
        quests.attest(alice, "quest-1", 50, bytes32(0));
    }

    function test_Attest_MultipleQuests() public {
        vm.prank(verifier);
        quests.attest(alice, "q1", 100, bytes32(0));
        vm.prank(verifier);
        quests.attest(alice, "q2", 200, bytes32(0));
        assertEq(quests.getUserXP(alice), 300);
        assertEq(quests.getUserAttestations(alice).length, 2);
    }
}

// ══════════════════════════════════════════════════════════════
// MembaPoints Tests
// ══════════════════════════════════════════════════════════════

contract MembaPointsTest is Test {
    MembaPoints public points;
    address public adminAddr = makeAddr("admin");
    address public awarder = makeAddr("awarder");
    address public alice = makeAddr("alice");

    function setUp() public {
        MembaPoints impl = new MembaPoints();
        bytes memory initData = abi.encodeCall(MembaPoints.initialize, (adminAddr));
        address proxy = address(new ERC1967Proxy(address(impl), initData));
        points = MembaPoints(proxy);

        vm.prank(adminAddr);
        points.setAwarder(awarder, true);
    }

    function test_Award_Success() public {
        vm.prank(awarder);
        points.award(alice, 150);
        assertEq(points.getPoints(alice), 150);
    }

    function test_Award_NonAwarderReverts() public {
        vm.prank(alice);
        vm.expectRevert(MembaPoints.NotAwarder.selector);
        points.award(alice, 100);
    }

    function test_Tier_Bronze() public {
        vm.prank(awarder);
        points.award(alice, 50);
        assertEq(points.getTier(alice), "Bronze");
    }

    function test_Tier_Gold() public {
        vm.prank(awarder);
        points.award(alice, 500);
        assertEq(points.getTier(alice), "Gold");
    }

    function test_Tier_Diamond() public {
        vm.prank(awarder);
        points.award(alice, 2000);
        assertEq(points.getTier(alice), "Diamond");
    }

    function test_HolderCount() public {
        vm.prank(awarder);
        points.award(alice, 100);
        vm.prank(awarder);
        points.award(awarder, 100);
        assertEq(points.getHolderCount(), 2);
    }
}

// ══════════════════════════════════════════════════════════════
// MembaAppStore Tests
// ══════════════════════════════════════════════════════════════

contract MembaAppStoreTest is Test {
    MembaAppStore public appStore;
    address public adminAddr = makeAddr("admin");
    address public feeWallet = makeAddr("feeWallet");
    address public publisher = makeAddr("publisher");

    function setUp() public {
        MembaAppStore impl = new MembaAppStore();
        bytes memory initData = abi.encodeCall(MembaAppStore.initialize, (adminAddr, feeWallet, 0.001 ether));
        address proxy = address(new ERC1967Proxy(address(impl), initData));
        appStore = MembaAppStore(proxy);
        vm.deal(publisher, 1 ether);
    }

    function _registerApp() internal {
        vm.prank(publisher);
        appStore.registerApp{ value: 0.001 ether }(
            "gno.land/r/app1", "App One", "Tagline", "DeFi", "QmIcon", "https://app1.io"
        );
    }

    function test_RegisterApp_Success() public {
        _registerApp();
        assertEq(appStore.appCount(), 1);
        bytes32 h = keccak256("gno.land/r/app1");
        MembaAppStore.AppInfo memory app = appStore.getApp(h);
        assertEq(app.publisher, publisher);
        assertEq(app.name, "App One");
        assertEq(uint8(app.status), uint8(MembaAppStore.AppStatus.Pending));
    }

    function test_RegisterApp_InsufficientFeeReverts() public {
        vm.prank(publisher);
        vm.expectRevert(MembaAppStore.InsufficientFee.selector);
        appStore.registerApp{ value: 0 }("gno.land/r/app2", "App Two", "Tag", "Cat", "Qm", "url");
    }

    function test_ApproveApp() public {
        _registerApp();
        bytes32 h = keccak256("gno.land/r/app1");
        vm.prank(adminAddr);
        appStore.approveApp(h);
        assertEq(uint8(appStore.getApp(h).status), uint8(MembaAppStore.AppStatus.Live));
    }

    function test_RejectApp() public {
        _registerApp();
        bytes32 h = keccak256("gno.land/r/app1");
        vm.prank(adminAddr);
        appStore.rejectApp(h, "Low quality");
        assertEq(uint8(appStore.getApp(h).status), uint8(MembaAppStore.AppStatus.Rejected));
    }

    function test_FlagApp() public {
        _registerApp();
        bytes32 h = keccak256("gno.land/r/app1");
        appStore.flagApp(h);
        assertEq(appStore.getApp(h).flags, 1);
    }
}

// ══════════════════════════════════════════════════════════════
// MembaRegistry Tests
// ══════════════════════════════════════════════════════════════

contract MembaRegistryTest is Test {
    MembaRegistry public registry;
    address public adminAddr = makeAddr("admin");
    address public treasury = makeAddr("treasury");
    address public daoAddr = makeAddr("dao1");

    function setUp() public {
        MembaRegistry impl = new MembaRegistry();
        bytes memory initData = abi.encodeCall(MembaRegistry.initialize, (adminAddr, treasury, 200));
        address proxy = address(new ERC1967Proxy(address(impl), initData));
        registry = MembaRegistry(proxy);
    }

    function test_RegisterDAO_Success() public {
        uint256 id = registry.registerDAO(daoAddr, "Test DAO", MembaRegistry.DAOCategory.Governance);
        assertEq(id, 1);
        assertEq(registry.entryCount(), 1);

        MembaRegistry.DAOEntry memory entry = registry.getDAO(1);
        assertEq(entry.daoContract, daoAddr);
        assertEq(entry.name, "Test DAO");
    }

    function test_RegisterDAO_DuplicateReverts() public {
        registry.registerDAO(daoAddr, "DAO A", MembaRegistry.DAOCategory.Governance);
        vm.expectRevert(MembaRegistry.AlreadyRegistered.selector);
        registry.registerDAO(daoAddr, "DAO B", MembaRegistry.DAOCategory.Community);
    }

    function test_VerifyDAO() public {
        registry.registerDAO(daoAddr, "DAO", MembaRegistry.DAOCategory.Governance);
        vm.prank(adminAddr);
        registry.verifyDAO(1);
        assertTrue(registry.getDAO(1).verified);
    }

    function test_VerifyDAO_NonAdminReverts() public {
        registry.registerDAO(daoAddr, "DAO", MembaRegistry.DAOCategory.Governance);
        vm.expectRevert(MembaRegistry.NotAdmin.selector);
        registry.verifyDAO(1);
    }

    function test_UpdateConfig() public {
        vm.prank(adminAddr);
        registry.updateConfig(makeAddr("newTreasury"), 300);
        assertEq(registry.defaultFeeBps(), 300);
    }

    function test_GetDAOByAddress() public {
        registry.registerDAO(daoAddr, "DAO", MembaRegistry.DAOCategory.DeFi);
        MembaRegistry.DAOEntry memory entry = registry.getDAOByAddress(daoAddr);
        assertEq(entry.name, "DAO");
    }
}
