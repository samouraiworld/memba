// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaBadges } from "../src/social/MembaBadges.sol";

contract MembaBadgesTest is Test {
    MembaBadges public badges;
    address public minterAddr = makeAddr("minter");
    address public upgraderAddr = makeAddr("upgrader");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public outsider = makeAddr("outsider");

    function setUp() public {
        MembaBadges impl = new MembaBadges();
        bytes memory initData = abi.encodeCall(MembaBadges.initialize, (minterAddr, upgraderAddr));
        address proxy = address(new ERC1967Proxy(address(impl), initData));
        badges = MembaBadges(proxy);
    }

    function test_Mint_Success() public {
        vm.prank(minterAddr);
        uint256 id = badges.mint(alice, "quest-1", "ipfs://badge1", true);

        assertEq(id, 0);
        assertEq(badges.ownerOf(0), alice);

        MembaBadges.BadgeInfo memory info = badges.getBadgeInfo(0);
        assertEq(info.questId, "quest-1");
        assertTrue(info.soulbound);
    }

    function test_Mint_SoulboundCannotTransfer() public {
        vm.prank(minterAddr);
        badges.mint(alice, "quest-1", "ipfs://badge1", true);

        vm.prank(alice);
        vm.expectRevert(MembaBadges.SoulboundTransfer.selector);
        badges.transferFrom(alice, bob, 0);
    }

    function test_Mint_NonSoulboundCanTransfer() public {
        vm.prank(minterAddr);
        badges.mint(alice, "quest-2", "ipfs://badge2", false);

        vm.prank(alice);
        badges.transferFrom(alice, bob, 0);
        assertEq(badges.ownerOf(0), bob);
    }

    function test_Mint_NonMinterReverts() public {
        vm.prank(outsider);
        vm.expectRevert(MembaBadges.NotMinter.selector);
        badges.mint(alice, "quest-1", "ipfs://hack", true);
    }

    function test_Mint_DuplicateReverts() public {
        vm.prank(minterAddr);
        badges.mint(alice, "quest-1", "ipfs://badge1", true);

        vm.prank(minterAddr);
        vm.expectRevert(MembaBadges.AlreadyMinted.selector);
        badges.mint(alice, "quest-1", "ipfs://badge1-dup", true);
    }

    function test_BatchMint_Success() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;
        string[] memory quests = new string[](2);
        quests[0] = "q1";
        quests[1] = "q2";
        string[] memory uris = new string[](2);
        uris[0] = "ipfs://1";
        uris[1] = "ipfs://2";

        vm.prank(minterAddr);
        badges.batchMint(recipients, quests, uris, true);

        assertEq(badges.ownerOf(0), alice);
        assertEq(badges.ownerOf(1), bob);
        assertEq(badges.nextTokenId(), 2);
    }

    function test_Locked_ReturnsTrueForSoulbound() public {
        vm.prank(minterAddr);
        badges.mint(alice, "quest-1", "ipfs://badge1", true);
        assertTrue(badges.locked(0));
    }

    function test_GetUserBadges() public {
        vm.prank(minterAddr);
        badges.mint(alice, "q1", "ipfs://1", true);
        vm.prank(minterAddr);
        badges.mint(alice, "q2", "ipfs://2", true);

        uint256[] memory userBadges = badges.getUserBadges(alice);
        assertEq(userBadges.length, 2);
    }
}
