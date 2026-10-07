// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkBase} from "./ForkBase.sol";
import {Addr} from "./Addresses.sol";
import {
    ISafe,
    Operation,
    ISxProxyFactory,
    ISxSpace,
    ISxAuthenticator,
    ISxAvatarExecutionStrategy,
    SxStrategy,
    SxIndexedStrategy,
    SxInitializeCalldata,
    SxUpdateSettingsCalldata,
    SxMetaTransaction,
    SxWhitelistMember,
    IModuleProxyFactory,
    IRoles,
    RolesExecutionOptions,
    ConditionFlat
} from "./Interfaces.sol";

/// Task 2d + Task 3: a Snapshot X space with WhitelistVotingStrategy and AvatarExecutionStrategy
/// through a Safe, configured as close to memba_gov as the deployed contracts allow.
///
/// Roster mirrors the memba_gov seed: weights 2,1,1,1 (W = 5, N = 4).
/// Voting power = weight + 1 per person (two whitelist strategies summed): the only way found to
/// make one absolute quorum mimic "weight AND headcount" rules, and only for some rosters
/// (see docs/evm/PHASE0.md, Snapshot X vs memba_gov).
abstract contract SnapshotXTest is ForkBase {
    bytes4 internal constant PROPOSE = bytes4(keccak256("propose(address,string,(address,bytes),bytes)"));
    bytes4 internal constant VOTE = bytes4(keccak256("vote(address,uint256,uint8,(uint8,bytes)[],string)"));
    uint32 internal constant NO_UPDATE_U32 = uint32(bytes4(keccak256(abi.encodePacked("No update"))));
    address internal constant NO_UPDATE_ADDR = address(bytes20(keccak256(abi.encodePacked("No update"))));
    uint8 internal constant AGAINST = 0;
    uint8 internal constant FOR = 1;
    uint8 internal constant ACCEPTED_EARLY = 2; // ProposalStatus.VotingPeriodAccepted
    uint8 internal constant EXECUTED = 4;

    // memba_gov classes as absolute quorums on (weight + persons), valid for this roster only.
    uint256 internal constant Q_ROUTINE = 4; // 8w >= 3W && p >= 2
    uint256 internal constant Q_FINANCIAL = 6; // 5w >= 3W && p >= 3 && 2p > N
    uint256 internal constant Q_CRITICAL = 7; // 3w >= 2W && 2p > N (weighted route)

    ISafe internal safe;
    ISxSpace internal space;
    ISxAvatarExecutionStrategy internal routine;
    ISxAvatarExecutionStrategy internal financial;
    ISxAvatarExecutionStrategy internal critical;
    address[] internal roster;
    address internal payee;

    function setUp() public override {
        super.setUp();
        payee = makeAddr("payee");
        roster.push(alice);
        roster.push(bob);
        roster.push(carol);
        roster.push(dave);
        safe = _deploySafe(_owners3(), 2, uint256(keccak256("memba.phase0.sx")));
        vm.deal(address(safe), 10 ether);

        ISxProxyFactory f = ISxProxyFactory(Addr.SX_PROXY_FACTORY);
        address predictedSpace =
            f.predictProxyAddress(Addr.SX_SPACE_IMPL, keccak256(abi.encodePacked(address(this), uint256(1))));
        routine = _deployAvatar(predictedSpace, address(safe), Q_ROUTINE, 2);
        financial = _deployAvatar(predictedSpace, address(safe), Q_FINANCIAL, 3);
        critical = _deployAvatar(predictedSpace, address(safe), Q_CRITICAL, 4);

        address[] memory auths = new address[](1);
        auths[0] = Addr.SX_ETH_TX_AUTH; // voter = msg.sender, one tx per vote
        string[] memory uris = new string[](2);
        SxInitializeCalldata memory init = SxInitializeCalldata({
            owner: address(safe),
            votingDelay: 0,
            minVotingDuration: 0,
            maxVotingDuration: 302_400, // blocks (7 days at 2 s): this deployment counts blocks, not seconds
            proposalValidationStrategy: _propositionPower(roster, _weights4()),
            proposalValidationStrategyMetadataURI: "",
            daoURI: "",
            metadataURI: "",
            votingStrategies: _strategies(roster, _weights4()),
            votingStrategyMetadataURIs: uris,
            authenticators: auths
        });
        uint256 g = gasleft();
        f.deployProxy(Addr.SX_SPACE_IMPL, abi.encodeCall(ISxSpace.initialize, (init)), 1);
        _gas("Snapshot X space deploy (proxy + initialize, 2 whitelist strategies)", g - gasleft());
        space = ISxSpace(predictedSpace);
        assertEq(space.owner(), address(safe));

        uint256 en;
        en += _execSafe(
            safe, address(safe), 0, abi.encodeCall(ISafe.enableModule, (address(routine))), Operation.Call, _two()
        );
        en += _execSafe(
            safe, address(safe), 0, abi.encodeCall(ISafe.enableModule, (address(financial))), Operation.Call, _two()
        );
        en += _execSafe(
            safe, address(safe), 0, abi.encodeCall(ISafe.enableModule, (address(critical))), Operation.Call, _two()
        );
        _gas("Safe: enable 3 execution strategies as modules (3 Safe txs)", en);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    function _weights4() internal pure returns (uint96[] memory w) {
        w = new uint96[](4);
        (w[0], w[1], w[2], w[3]) = (2, 1, 1, 1);
    }

    function _deployAvatar(address sp, address target, uint256 quorum, uint256 nonce)
        internal
        returns (ISxAvatarExecutionStrategy s)
    {
        ISxProxyFactory f = ISxProxyFactory(Addr.SX_PROXY_FACTORY);
        address[] memory spaces = new address[](1);
        spaces[0] = sp;
        bytes memory init =
            abi.encodeCall(ISxAvatarExecutionStrategy.setUp, (abi.encode(address(safe), target, spaces, quorum)));
        uint256 g = gasleft();
        f.deployProxy(Addr.SX_AVATAR_EXECUTION_IMPL, init, nonce);
        _gas("Snapshot X AvatarExecutionStrategy deploy", g - gasleft());
        s = ISxAvatarExecutionStrategy(
            f.predictProxyAddress(Addr.SX_AVATAR_EXECUTION_IMPL, keccak256(abi.encodePacked(address(this), nonce)))
        );
        assertEq(s.quorum(), quorum);
    }

    function _members(address[] memory who, uint96[] memory vp) internal pure returns (SxWhitelistMember[] memory m) {
        m = new SxWhitelistMember[](who.length);
        for (uint256 i; i < who.length; i++) {
            m[i] = SxWhitelistMember(who[i], vp[i]);
        }
    }

    function _ones(uint256 n) internal pure returns (uint96[] memory o) {
        o = new uint96[](n);
        for (uint256 i; i < n; i++) {
            o[i] = 1;
        }
    }

    /// [weights, headcount]: a voter's power is weight + 1.
    function _strategies(address[] memory who, uint96[] memory w) internal view returns (SxStrategy[] memory s) {
        s = new SxStrategy[](2);
        s[0] = SxStrategy(Addr.SX_WHITELIST_VOTING, abi.encode(_members(who, w)));
        s[1] = SxStrategy(Addr.SX_WHITELIST_VOTING, abi.encode(_members(who, _ones(who.length))));
    }

    /// Only roster members may propose (power >= 1 on the weight whitelist).
    function _propositionPower(address[] memory who, uint96[] memory w) internal view returns (SxStrategy memory) {
        SxStrategy[] memory allowed = new SxStrategy[](1);
        allowed[0] = SxStrategy(Addr.SX_WHITELIST_VOTING, abi.encode(_members(who, w)));
        return SxStrategy(Addr.SX_PROPOSITION_POWER_VALIDATION, abi.encode(uint256(1), allowed));
    }

    function _userStrategies(uint8 first, uint256 voterIndex) internal pure returns (SxIndexedStrategy[] memory u) {
        u = new SxIndexedStrategy[](2);
        u[0] = SxIndexedStrategy(first, abi.encode(voterIndex));
        u[1] = SxIndexedStrategy(first + 1, abi.encode(voterIndex));
    }

    function _payload(address to, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        SxMetaTransaction[] memory txs = new SxMetaTransaction[](1);
        txs[0] = SxMetaTransaction(to, value, data, Operation.Call, 0);
        return abi.encode(txs);
    }

    function _propose(address author, uint256 authorIndex, address strategy, bytes memory payload)
        internal
        returns (uint256 pid)
    {
        pid = space.nextProposalId();
        SxIndexedStrategy[] memory u = new SxIndexedStrategy[](1);
        u[0] = SxIndexedStrategy(0, abi.encode(authorIndex));
        vm.prank(author);
        uint256 g = gasleft();
        ISxAuthenticator(Addr.SX_ETH_TX_AUTH)
            .authenticate(address(space), PROPOSE, abi.encode(author, "", SxStrategy(strategy, payload), abi.encode(u)));
        _gas("Snapshot X propose (EthTxAuthenticator)", g - gasleft());
    }

    function _vote(address voter, uint256 pid, uint8 choice, uint8 firstStrategy, uint256 voterIndex) internal {
        vm.prank(voter);
        uint256 g = gasleft();
        ISxAuthenticator(Addr.SX_ETH_TX_AUTH)
            .authenticate(
                address(space), VOTE, abi.encode(voter, pid, choice, _userStrategies(firstStrategy, voterIndex), "")
            );
        _gas("Snapshot X vote (EthTxAuthenticator, 2 strategies)", g - gasleft());
    }

    // ── 2d: propose, vote, execute a Safe call ─────────────────────────

    function test_sx_routine_payment_through_safe() public {
        bytes memory payload = _payload(payee, 0.5 ether, "");
        uint256 pid = _propose(alice, 0, address(routine), payload);

        // alice alone: weight 2 = 3/8 of W rounded up, but one person. memba_gov refuses (p >= 2);
        // power weight+1 = 3 < quorum 4, so Snapshot X refuses too.
        _vote(alice, pid, FOR, 0, 0);
        assertEq(space.getProposalStatus(pid), 1); // VotingPeriod
        vm.expectRevert();
        space.execute(pid, payload);

        _vote(bob, pid, FOR, 0, 1);
        assertEq(space.getProposalStatus(pid), ACCEPTED_EARLY); // executable before the deadline, like memba_gov
        uint256 g = gasleft();
        space.execute(pid, payload);
        _gas("Snapshot X execute via AvatarExecutionStrategy -> Safe (ETH transfer)", g - gasleft());
        assertEq(payee.balance, 0.5 ether);
        assertEq(space.getProposalStatus(pid), EXECUTED);

        // A vote is final: no change, no withdrawal (memba_gov lets a YES be withdrawn until execution).
        uint256 pid2 = _propose(alice, 0, address(routine), _payload(payee, 1, ""));
        _vote(carol, pid2, FOR, 0, 2);
        vm.expectRevert(abi.encodeWithSignature("UserAlreadyVoted()"));
        _vote(carol, pid2, AGAINST, 0, 2);
    }

    /// A non-member cannot propose; a member cannot vote with someone else's whitelist slot.
    function test_sx_membership_checks() public {
        address eve = makeAddr("eve");
        SxIndexedStrategy[] memory u = new SxIndexedStrategy[](1);
        u[0] = SxIndexedStrategy(0, abi.encode(uint256(0)));
        vm.prank(eve);
        vm.expectRevert(); // VoterAndIndexMismatch inside the proposal validation strategy
        ISxAuthenticator(Addr.SX_ETH_TX_AUTH)
            .authenticate(
                address(space),
                PROPOSE,
                abi.encode(eve, "", SxStrategy(address(routine), _payload(payee, 1, "")), abi.encode(u))
            );

        uint256 pid = _propose(bob, 1, address(routine), _payload(payee, 1, ""));
        vm.expectRevert(abi.encodeWithSignature("VoterAndIndexMismatch()"));
        _vote(bob, pid, FOR, 0, 0); // bob claims alice's slot (weight 2)
    }

    // ── 2d: a proposal that rewrites the space's own whitelist ─────────

    function test_sx_self_update_whitelist() public {
        address eve = makeAddr("eve");
        // A pending proposal created before the roster change.
        uint256 stale = _propose(alice, 0, address(routine), _payload(payee, 0.1 ether, ""));

        // New roster: dave out, eve in (weight 1). W = 5, N = 4 still, so the quorums stay valid;
        // a W/N change would need setQuorum on each strategy in the same payload.
        address[] memory next = new address[](4);
        (next[0], next[1], next[2], next[3]) = (alice, bob, carol, eve);
        uint8[] memory remove = new uint8[](2);
        (remove[0], remove[1]) = (0, 1);
        string[] memory uris = new string[](2);
        SxUpdateSettingsCalldata memory u = SxUpdateSettingsCalldata({
            minVotingDuration: NO_UPDATE_U32,
            maxVotingDuration: NO_UPDATE_U32,
            votingDelay: NO_UPDATE_U32,
            metadataURI: "No update",
            daoURI: "No update",
            proposalValidationStrategy: _propositionPower(next, _weights4()), // the proposer list is a separate copy
            proposalValidationStrategyMetadataURI: "",
            authenticatorsToAdd: new address[](0),
            authenticatorsToRemove: new address[](0),
            votingStrategiesToAdd: _strategies(next, _weights4()),
            votingStrategyMetadataURIsToAdd: uris,
            votingStrategiesToRemove: remove
        });
        SxMetaTransaction[] memory txs = new SxMetaTransaction[](2);
        txs[0] = SxMetaTransaction(address(space), 0, abi.encodeCall(ISxSpace.updateSettings, (u)), Operation.Call, 0);
        // Same payload re-sets a quorum (here unchanged) to show both updates fit one proposal.
        txs[1] = SxMetaTransaction(
            address(routine), 0, abi.encodeCall(ISxAvatarExecutionStrategy.setQuorum, (Q_ROUTINE)), Operation.Call, 0
        );
        bytes memory payload = abi.encode(txs);

        uint256 pid = _propose(alice, 0, address(critical), payload);
        _vote(alice, pid, FOR, 0, 0);
        _vote(bob, pid, FOR, 0, 1);
        assertEq(space.getProposalStatus(pid), 1); // 3 + 2 = 5 < 7
        _vote(carol, pid, FOR, 0, 2);
        assertEq(space.getProposalStatus(pid), ACCEPTED_EARLY); // 7 >= 7 (w = 4, p = 3)
        uint256 g = gasleft();
        space.execute(pid, payload);
        _gas("Snapshot X execute: updateSettings (whitelist swap) + setQuorum via Safe", g - gasleft());
        assertEq(space.nextVotingStrategyIndex(), 4);

        // New proposals: eve votes with the new strategies (indexes 2, 3); dave is out.
        uint256 fresh = _propose(eve, 3, address(routine), _payload(payee, 1, ""));
        _vote(eve, fresh, FOR, 2, 3);
        vm.expectRevert(abi.encodeWithSignature("InvalidStrategyIndex(uint256)", 0));
        _vote(dave, fresh, FOR, 0, 3);

        // The proposal created before the change still counts the OLD roster: removed dave can vote on it
        // and it remains executable (memba_gov invalidates every open proposal on a roster change).
        _vote(dave, stale, FOR, 0, 3);
        _vote(bob, stale, FOR, 0, 1);
        assertEq(space.getProposalStatus(stale), ACCEPTED_EARLY);
        space.execute(stale, _payload(payee, 0.1 ether, ""));
    }

    // ── Task 3: class escalation ──────────────────────────────────────

    /// Any member picks the execution strategy. With every strategy a full Safe module, a critical
    /// action (adding a Safe owner) passes at the routine quorum. BROKEN as a class system.
    function test_sx_class_escalation_unrestricted() public {
        address attacker = makeAddr("attacker");
        bytes memory payload = _payload(address(safe), 0, abi.encodeCall(ISafe.addOwnerWithThreshold, (attacker, 1)));
        uint256 pid = _propose(alice, 0, address(routine), payload);
        _vote(alice, pid, FOR, 0, 0);
        _vote(bob, pid, FOR, 0, 1);
        space.execute(pid, payload);
        assertEq(safe.getThreshold(), 1);
        assertEq(safe.getOwners()[0], attacker);
    }

    /// Mitigation: the routine strategy targets a Zodiac Roles modifier instead of the Safe, and its
    /// default role only allows what routine may do. The escalation then reverts at execution.
    function test_sx_class_escalation_blocked_by_roles() public {
        bytes32 roleKey = keccak256("memba.class.routine");
        IRoles roles = IRoles(
            IModuleProxyFactory(Addr.MODULE_PROXY_FACTORY)
                .deployModule(
                    Addr.ROLES_V2_MASTERCOPY,
                    abi.encodeCall(IRoles.setUp, (abi.encode(address(safe), address(safe), address(safe)))),
                    7
                )
        );
        ISxAvatarExecutionStrategy routineScoped = _deployAvatar(address(space), address(roles), Q_ROUTINE, 9);

        bytes32[] memory keys = new bytes32[](1);
        keys[0] = roleKey;
        bool[] memory yes = new bool[](1);
        yes[0] = true;
        _execSafe(safe, address(safe), 0, abi.encodeCall(ISafe.enableModule, (address(roles))), Operation.Call, _two());
        _execSafe(
            safe,
            address(roles),
            0,
            abi.encodeCall(IRoles.assignRoles, (address(routineScoped), keys, yes)),
            Operation.Call,
            _two()
        );
        _execSafe(
            safe,
            address(roles),
            0,
            abi.encodeWithSignature("setDefaultRole(address,bytes32)", address(routineScoped), roleKey),
            Operation.Call,
            _two()
        );
        // Routine may only send ETH to the payee (a stand-in for "pay a known vendor").
        _execSafe(
            safe,
            address(roles),
            0,
            abi.encodeWithSignature(
                "allowTarget(bytes32,address,uint8)", roleKey, payee, uint8(RolesExecutionOptions.Send)
            ),
            Operation.Call,
            _two()
        );

        address attacker = makeAddr("attacker");
        bytes memory bad = _payload(address(safe), 0, abi.encodeCall(ISafe.addOwnerWithThreshold, (attacker, 1)));
        uint256 pid = _propose(alice, 0, address(routineScoped), bad);
        _vote(alice, pid, FOR, 0, 0);
        _vote(bob, pid, FOR, 0, 1);
        vm.expectRevert();
        space.execute(pid, bad);
        assertEq(safe.getThreshold(), 2);

        bytes memory ok = _payload(payee, 0.2 ether, "");
        uint256 pid2 = _propose(alice, 0, address(routineScoped), ok);
        _vote(alice, pid2, FOR, 0, 0);
        _vote(bob, pid2, FOR, 0, 1);
        space.execute(pid2, ok);
        assertEq(payee.balance, 0.2 ether);
    }

    /// NO votes block: Snapshot X requires for > against (memba_gov counts YES only).
    function test_sx_against_votes_block() public {
        bytes memory payload = _payload(payee, 1, "");
        uint256 pid = _propose(alice, 0, address(routine), payload);
        _vote(alice, pid, FOR, 0, 0); // 3
        _vote(bob, pid, FOR, 0, 1); // 5 >= 4: accepted
        assertEq(space.getProposalStatus(pid), ACCEPTED_EARLY);
        _vote(carol, pid, AGAINST, 0, 2);
        _vote(dave, pid, AGAINST, 0, 3); // against 4 < for 5: still accepted
        assertEq(space.getProposalStatus(pid), ACCEPTED_EARLY);
        // An accepted proposal never expires: still executable long after the voting period.
        vm.roll(block.number + 10_000_000);
        assertEq(space.getProposalStatus(pid), 3); // Accepted
        space.execute(pid, payload);
    }
}

contract SnapshotXBaseSepoliaTest is SnapshotXTest {
    function _chain() internal pure override returns (string memory) {
        return "base_sepolia";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_SEPOLIA_FORK_BLOCK;
    }
}

contract SnapshotXBaseTest is SnapshotXTest {
    function _chain() internal pure override returns (string memory) {
        return "base";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_FORK_BLOCK;
    }
}
