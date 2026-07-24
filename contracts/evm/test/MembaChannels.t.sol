// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaChannels } from "../src/core/MembaChannels.sol";
import { MembaDAO } from "../src/core/MembaDAO.sol";
import { MembaDAOFactory } from "../src/core/MembaDAOFactory.sol";

contract MembaChannelsTest is Test {
    MembaChannels public channels;
    MembaDAO public dao;

    address public adminAddr = makeAddr("admin");
    address public member = makeAddr("member");
    address public outsider = makeAddr("outsider");

    function setUp() public {
        // Deploy DAO for membership checks
        MembaDAO daoImpl = new MembaDAO();
        MembaDAOFactory factory = new MembaDAOFactory(address(daoImpl));
        address daoProxy = factory.createDAO("Test DAO", "desc", adminAddr, bytes32(uint256(1)));
        dao = MembaDAO(daoProxy);

        // Add member
        string[] memory roles = new string[](0);
        bytes32 adminRole = dao.ADMIN_ROLE();
        vm.prank(adminAddr);
        dao.addMember(member, 1, roles);

        // Deploy Channels
        MembaChannels impl = new MembaChannels();
        bytes memory initData = abi.encodeCall(MembaChannels.initialize, (address(dao), adminAddr));
        address proxy = address(new ERC1967Proxy(address(impl), initData));
        channels = MembaChannels(proxy);
    }

    // ══════════════════════════════════════════════════════════════
    // 1. Channel Management
    // ══════════════════════════════════════════════════════════════

    function test_CreateChannel_Success() public {
        vm.prank(adminAddr);
        uint256 id = channels.createChannel("general", MembaChannels.ChannelType.Text, bytes32(0));

        assertEq(id, 0);
        assertEq(channels.channelCount(), 1);

        MembaChannels.ChannelConfig memory ch = channels.getChannel(0);
        assertEq(ch.name, "general");
        assertTrue(ch.active);
    }

    function test_CreateChannel_NonAdminReverts() public {
        vm.prank(outsider);
        vm.expectRevert(MembaChannels.NotAdmin.selector);
        channels.createChannel("hack", MembaChannels.ChannelType.Text, bytes32(0));
    }

    function test_ArchiveChannel_Success() public {
        vm.prank(adminAddr);
        channels.createChannel("temp", MembaChannels.ChannelType.Text, bytes32(0));

        vm.prank(adminAddr);
        channels.archiveChannel(0);

        assertFalse(channels.getChannel(0).active);
    }

    // ══════════════════════════════════════════════════════════════
    // 2. Message Anchoring
    // ══════════════════════════════════════════════════════════════

    function test_AnchorMessages_Success() public {
        vm.prank(adminAddr);
        channels.createChannel("general", MembaChannels.ChannelType.Text, bytes32(0));

        bytes32 root = keccak256("batch1");

        vm.prank(member);
        channels.anchorMessages(0, root);

        bytes32[] memory roots = channels.getMessageRoots(0);
        assertEq(roots.length, 1);
        assertEq(roots[0], root);
    }

    function test_AnchorMessages_NonMemberReverts() public {
        vm.prank(adminAddr);
        channels.createChannel("general", MembaChannels.ChannelType.Text, bytes32(0));

        vm.prank(outsider);
        vm.expectRevert(MembaChannels.NotMember.selector);
        channels.anchorMessages(0, keccak256("hack"));
    }

    function test_AnchorMessages_InactiveReverts() public {
        vm.prank(adminAddr);
        channels.createChannel("temp", MembaChannels.ChannelType.Text, bytes32(0));

        vm.prank(adminAddr);
        channels.archiveChannel(0);

        vm.prank(member);
        vm.expectRevert(MembaChannels.ChannelInactive.selector);
        channels.anchorMessages(0, keccak256("blocked"));
    }

    function test_AnchorMessages_MultipleRoots() public {
        vm.prank(adminAddr);
        channels.createChannel("general", MembaChannels.ChannelType.Text, bytes32(0));

        vm.prank(member);
        channels.anchorMessages(0, keccak256("batch1"));
        vm.prank(member);
        channels.anchorMessages(0, keccak256("batch2"));

        assertEq(channels.getMessageRoots(0).length, 2);
    }

    // ══════════════════════════════════════════════════════════════
    // 3. Verification
    // ══════════════════════════════════════════════════════════════

    function test_VerifyMessage_ValidProof() public {
        vm.prank(adminAddr);
        channels.createChannel("general", MembaChannels.ChannelType.Text, bytes32(0));

        // Simple Merkle tree with one leaf (root = leaf for single element)
        bytes32 leaf = keccak256("message1");

        vm.prank(member);
        channels.anchorMessages(0, leaf);

        // Empty proof for single-element tree
        bytes32[] memory proof = new bytes32[](0);
        assertTrue(channels.verifyMessage(0, 0, proof, leaf));
    }

    function test_VerifyMessage_InvalidProof() public {
        vm.prank(adminAddr);
        channels.createChannel("general", MembaChannels.ChannelType.Text, bytes32(0));

        bytes32 leaf = keccak256("message1");
        vm.prank(member);
        channels.anchorMessages(0, leaf);

        bytes32[] memory proof = new bytes32[](0);
        assertFalse(channels.verifyMessage(0, 0, proof, keccak256("wrong")));
    }
}
