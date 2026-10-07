// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkBase} from "./ForkBase.sol";
import {Addr} from "./Addresses.sol";
import {
    IDAOFactory,
    IPluginRepo,
    AragonDAOSettings,
    AragonPluginSettings,
    AragonPluginSetupRef,
    AragonVersionTag,
    AragonInstalledPlugin,
    AragonMultisigSettings,
    AragonTargetConfig,
    AragonAction,
    IAragonMultisig,
    AragonVotingSettings,
    AragonTokenSettings,
    AragonMintSettingsV13,
    AragonMintSettingsV14,
    IAragonTokenVoting,
    IVotesToken
} from "./Interfaces.sol";

/// Task 2c: Aragon OSx DAOFactory with the Multisig plugin (create, approve, execute a proposal)
/// and with the TokenVoting plugin (create).
abstract contract AragonDaoTest is ForkBase {
    function _factory() internal view virtual returns (address);
    function _multisigRepo() internal view virtual returns (address);
    function _tokenVotingRepo() internal view virtual returns (address);

    function _latest(address repo) internal view returns (AragonVersionTag memory t) {
        t.release = IPluginRepo(repo).latestRelease();
        t.build = uint16(IPluginRepo(repo).buildCount(t.release));
    }

    function _settings() internal pure returns (AragonDAOSettings memory) {
        return AragonDAOSettings(address(0), "", "", "");
    }

    function _members() internal view returns (address[] memory m) {
        m = new address[](3);
        m[0] = alice;
        m[1] = bob;
        m[2] = carol;
    }

    function test_aragon_multisig_dao_proposal() public {
        uint8[3] memory v = IDAOFactory(_factory()).protocolVersion();
        assertEq(v[0], 1);
        assertEq(v[1], 4);
        AragonVersionTag memory tag = _latest(_multisigRepo());
        assertEq(tag.build, 3, "multisig build");

        AragonPluginSettings[] memory ps = new AragonPluginSettings[](1);
        ps[0] = AragonPluginSettings(
            AragonPluginSetupRef(tag, _multisigRepo()),
            abi.encode(_members(), AragonMultisigSettings(true, 2), AragonTargetConfig(address(0), 0), bytes(""))
        );
        uint256 g = gasleft();
        (address dao, AragonInstalledPlugin[] memory installed) = IDAOFactory(_factory()).createDao(_settings(), ps);
        _gas("Aragon createDao + Multisig plugin (2-of-3)", g - gasleft());
        IAragonMultisig ms = IAragonMultisig(installed[0].plugin);
        assertTrue(ms.isMember(alice) && ms.isMember(bob) && ms.isMember(carol));

        vm.deal(dao, 1 ether);
        address payee = makeAddr("payee");
        AragonAction[] memory actions = new AragonAction[](1);
        actions[0] = AragonAction(payee, 0.1 ether, "");

        // Same block as the settings change: creation is refused (anti-backrun rule of the plugin).
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("ProposalCreationForbidden(address)", alice));
        ms.createProposal("", actions, 0, true, false, 0, uint64(block.timestamp + 7 days));

        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 2);
        vm.prank(alice);
        g = gasleft();
        uint256 pid = ms.createProposal("", actions, 0, true, false, 0, uint64(block.timestamp + 7 days));
        _gas("Aragon Multisig createProposal (+ proposer approval)", g - gasleft());
        assertFalse(ms.canExecute(pid));

        // A non-member cannot approve.
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSignature("ApprovalCastForbidden(uint256,address)", pid, dave));
        ms.approve(pid, false);

        vm.prank(bob);
        g = gasleft();
        ms.approve(pid, false);
        _gas("Aragon Multisig approve", g - gasleft());
        assertTrue(ms.canExecute(pid));

        vm.prank(carol);
        g = gasleft();
        ms.execute(pid);
        _gas("Aragon Multisig execute (ETH transfer from DAO)", g - gasleft());
        assertEq(payee.balance, 0.1 ether);
    }

    function test_aragon_tokenvoting_dao() public {
        AragonVersionTag memory tag = _latest(_tokenVotingRepo());
        address[] memory receivers = _members();
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 2 ether;
        amounts[1] = 1 ether;
        amounts[2] = 1 ether;
        AragonVotingSettings memory vs = AragonVotingSettings(1, 500_000, 150_000, 1 hours, 1);
        AragonTokenSettings memory ts = AragonTokenSettings(address(0), "Memba Vote", "MVOTE");
        bytes memory data;
        if (tag.build >= 4) {
            // token-voting-plugin v1.4 (build 4): MintSettings gains ensureDelegationOnMint, data gains excludedAccounts.
            data = abi.encode(
                vs,
                ts,
                AragonMintSettingsV14(receivers, amounts, true),
                AragonTargetConfig(address(0), 0),
                uint256(0),
                bytes(""),
                new address[](0)
            );
        } else {
            data = abi.encode(
                vs,
                ts,
                AragonMintSettingsV13(receivers, amounts),
                AragonTargetConfig(address(0), 0),
                uint256(0),
                bytes("")
            );
        }
        AragonPluginSettings[] memory ps = new AragonPluginSettings[](1);
        ps[0] = AragonPluginSettings(AragonPluginSetupRef(tag, _tokenVotingRepo()), data);
        uint256 g = gasleft();
        (, AragonInstalledPlugin[] memory installed) = IDAOFactory(_factory()).createDao(_settings(), ps);
        _gas(
            string.concat("Aragon createDao + TokenVoting build ", vm.toString(tag.build), " (new token)"),
            g - gasleft()
        );

        IAragonTokenVoting tv = IAragonTokenVoting(installed[0].plugin);
        IVotesToken t = IVotesToken(tv.getVotingToken());
        assertEq(t.balanceOf(alice), 2 ether);
        assertEq(tv.supportThreshold(), 500_000);
        // Votes need delegation to count; report what the plugin did on mint.
        emit log_named_uint("alice getVotes after mint", t.getVotes(alice));
    }
}

contract AragonDaoBaseSepoliaTest is AragonDaoTest {
    function _chain() internal pure override returns (string memory) {
        return "base_sepolia";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_SEPOLIA_FORK_BLOCK;
    }

    function _factory() internal pure override returns (address) {
        return Addr.ARAGON_DAO_FACTORY_BASE_SEPOLIA;
    }

    function _multisigRepo() internal pure override returns (address) {
        return Addr.ARAGON_MULTISIG_REPO_BASE_SEPOLIA;
    }

    function _tokenVotingRepo() internal pure override returns (address) {
        return Addr.ARAGON_TOKENVOTING_REPO_BASE_SEPOLIA_COMMONS;
    }
}

contract AragonDaoBaseTest is AragonDaoTest {
    function _chain() internal pure override returns (string memory) {
        return "base";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_FORK_BLOCK;
    }

    function _factory() internal pure override returns (address) {
        return Addr.ARAGON_DAO_FACTORY_BASE;
    }

    function _multisigRepo() internal pure override returns (address) {
        return Addr.ARAGON_MULTISIG_REPO_BASE;
    }

    function _tokenVotingRepo() internal pure override returns (address) {
        return Addr.ARAGON_TOKENVOTING_REPO_BASE;
    }
}
