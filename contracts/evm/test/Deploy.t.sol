// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";

import { Deploy } from "../script/Deploy.s.sol";
import { MembaDAO } from "../src/core/MembaDAO.sol";
import { MembaDAOFactory } from "../src/core/MembaDAOFactory.sol";
import { MembaCandidature } from "../src/core/MembaCandidature.sol";
import { MembaEscrow } from "../src/commerce/MembaEscrow.sol";
import { MembaTokenFactory } from "../src/commerce/MembaTokenFactory.sol";
import { MembaNFT } from "../src/commerce/MembaNFT.sol";
import { MembaCollections } from "../src/commerce/MembaCollections.sol";
import { MembaTokenOTC } from "../src/commerce/MembaTokenOTC.sol";
import { MembaBadges } from "../src/social/MembaBadges.sol";
import { MembaQuests } from "../src/social/MembaQuests.sol";

/// @title Deploy script — wiring & ceremony-boundary tests (D-13, + D-9 event slice)
/// @notice Deploy.s.sol was 0% covered. This repo has been bitten by the deploy-misconfig
///         class three times on this very branch (A-2 missing ADMIN_ROLE grant, A-1 missing
///         setLaunchpad, C-4 factory ownership left on the deployer), each a silent,
///         deploy-time-only, funds/authority defect with no runtime error. One deterministic
///         test pins the whole wiring — including what deploy deliberately does NOT do (the
///         three Safe ceremony steps), so those stay non-optional.
contract DeployTest is Test {
    Deploy internal deployer;

    address internal safe = makeAddr("safe");
    address internal treasury = makeAddr("treasury");
    address internal verifier = makeAddr("verifier"); // must differ from the upgrade authority

    function setUp() public {
        deployer = new Deploy();
    }

    // ── D-13: full wiring, no timelock (upgrader == safe) ───────────

    function test_DeployScript_WiresEverything() public {
        Deploy.Deployed memory d = deployer.deployAll(safe, treasury, verifier, 0);

        // A. Ownership / admin wiring.
        // The factory is owned by whoever ran deployAll (here the Deploy contract) and only
        // NOMINATES the Safe — proving the Ownable2Step handoff fired but is not yet accepted.
        assertEq(MembaDAOFactory(d.daoFactory).owner(), address(deployer), "factory still owned by deployer");
        assertEq(MembaDAOFactory(d.daoFactory).pendingOwner(), safe, "Safe nominated as factory owner");
        assertEq(MembaDAOFactory(d.daoFactory).getDaoCount(), 1);
        assertEq(MembaDAOFactory(d.daoFactory).getDao(0), d.firstDAO);

        MembaDAO dao = MembaDAO(d.firstDAO);
        assertTrue(dao.hasRole(dao.DEFAULT_ADMIN_ROLE(), safe), "Safe is DEFAULT_ADMIN on the DAO");
        assertTrue(dao.hasRole(dao.ADMIN_ROLE(), safe), "Safe is ADMIN on the DAO");

        // B. Ceremony boundary — pin what deploy deliberately does NOT do (Safe steps 1 & 2).
        assertFalse(dao.hasRole(dao.ADMIN_ROLE(), d.candidature), "Candidature grant is a Safe step, not the script");
        assertEq(MembaNFT(d.nft).launchpad(), address(0), "setLaunchpad is a Safe step, not the script");

        // C. Upgrade-authority separation (guards the remediation's backend-key != upgrade-key
        //    split). With no timelock, Badges/Quests upgrade authority is the Safe, never the
        //    operational verifier key.
        assertEq(d.upgrader, safe, "no timelock -> Safe is the upgrader");
        assertEq(MembaBadges(d.badges).upgrader(), safe);
        assertEq(MembaQuests(d.quests).upgrader(), safe);
        assertTrue(MembaBadges(d.badges).upgrader() != verifier, "upgrade key must differ from the backend key");

        // D. Fee / init params — read from deployed storage (not literal-vs-literal), so a
        //    silently-swapped init argument is caught.
        MembaCandidature cand = MembaCandidature(d.candidature);
        assertEq(cand.admin(), safe);
        assertEq(cand.daoContract(), d.firstDAO);
        assertEq(cand.feeRecipient(), treasury);
        assertEq(cand.minDeposit(), 0.01 ether);

        MembaEscrow escrow = MembaEscrow(d.escrow);
        assertEq(escrow.feeRecipient(), treasury);
        assertEq(escrow.platformFeeBps(), 200);
        assertEq(escrow.cancellationFeeBps(), 500);
        assertEq(escrow.autoRefundTimeout(), 30 days);

        MembaTokenFactory tf = MembaTokenFactory(d.tokenFactory);
        assertEq(tf.admin(), safe);
        assertEq(tf.feeRecipient(), treasury);
        assertEq(tf.creationFee(), 0.001 ether);

        MembaTokenOTC otc = MembaTokenOTC(d.otc);
        assertEq(otc.admin(), safe);
        assertEq(otc.feeRecipient(), treasury);
        assertEq(otc.platformFeeBps(), 100);

        // The critical cross-contract wire: Collections must point at the deployed NFT (and
        // it's exactly the wire the setLaunchpad ceremony depends on).
        MembaCollections coll = MembaCollections(d.collections);
        assertEq(coll.nftContract(), d.nft, "Collections wired to the deployed NFT");
        assertEq(coll.feeRecipient(), treasury);
        assertEq(coll.creationFee(), 0.01 ether);

        // E. Completeness — no leg silently returned address(0), and everything is distinct.
        address[16] memory all = [
            d.daoFactory,
            d.firstDAO,
            d.candidature,
            d.channels,
            d.registry,
            d.tokenFactory,
            d.escrow,
            d.nft,
            d.collections,
            d.otc,
            d.reviews,
            d.badges,
            d.quests,
            d.points,
            d.appStore,
            d.upgrader
        ];
        // upgrader == safe here, so it is intentionally NOT in the distinctness set.
        for (uint256 i = 0; i < 15; i++) {
            assertTrue(all[i] != address(0), "a deploy leg returned address(0)");
            for (uint256 j = i + 1; j < 15; j++) {
                assertTrue(all[i] != all[j], "two contracts share an address");
            }
        }
    }

    // ── D-13: timelock branch (upgrader is a fresh TimelockController) ─

    function test_DeployScript_TimelockAuthorityWhenDelaySet() public {
        uint256 delay = 48 hours;
        Deploy.Deployed memory d = deployer.deployAll(safe, treasury, verifier, delay);

        assertTrue(d.upgrader != safe && d.upgrader != verifier, "upgrader is a distinct timelock");
        assertEq(MembaBadges(d.badges).upgrader(), d.upgrader, "Badges upgrade authority is the timelock");
        assertEq(MembaQuests(d.quests).upgrader(), d.upgrader);

        TimelockController tl = TimelockController(payable(d.upgrader));
        assertEq(tl.getMinDelay(), delay, "timelock enforces the configured delay");
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), safe), "Safe can propose");
        assertTrue(tl.hasRole(tl.EXECUTOR_ROLE(), safe), "Safe can execute");
    }

    /// @notice deploy must reject a verifier that equals the upgrade authority (the backend
    ///         hot key can never also be the upgrade key). With no timelock, upgrader == safe.
    function test_DeployScript_RejectsVerifierEqualUpgrader() public {
        vm.expectRevert(bytes("BACKEND_VERIFIER must not be the upgrade authority"));
        deployer.deployAll(safe, treasury, safe, 0);
    }

    // ── D-9: the two indexer-load-bearing events ────────────────────

    function test_D9_FactoryEmitsDAOCreated() public {
        Deploy.Deployed memory d = deployer.deployAll(safe, treasury, verifier, 0);
        MembaDAOFactory factory = MembaDAOFactory(d.daoFactory);

        // createDAO is permissionless; the new DAO address isn't predictable, so check
        // daoId (topic1) + creator (topic3) + name (data), skip the address topic.
        vm.expectEmit(true, false, true, true, address(factory));
        emit MembaDAOFactory.DAOCreated(1, address(0), address(this), "Second DAO");
        factory.createDAO("Second DAO", "desc", safe, bytes32(uint256(2)));
    }

    function test_D9_DAOEmitsMemberAdded() public {
        Deploy.Deployed memory d = deployer.deployAll(safe, treasury, verifier, 0);
        MembaDAO dao = MembaDAO(d.firstDAO);

        address newMember = makeAddr("newMember");
        string[] memory roles = new string[](1);
        roles[0] = "member";

        vm.expectEmit(true, false, false, true, address(dao));
        emit MembaDAO.MemberAdded(newMember, 1, roles);
        vm.prank(safe); // Safe holds ADMIN_ROLE on the first DAO
        dao.addMember(newMember, 1, roles);
    }
}
