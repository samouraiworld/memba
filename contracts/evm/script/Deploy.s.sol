// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console } from "forge-std/Script.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Core
import { MembaDAO } from "../src/core/MembaDAO.sol";
import { MembaDAOFactory } from "../src/core/MembaDAOFactory.sol";
import { MembaCandidature } from "../src/core/MembaCandidature.sol";
import { MembaChannels } from "../src/core/MembaChannels.sol";
import { MembaRegistry } from "../src/core/MembaRegistry.sol";

// Commerce
import { MembaTokenFactory } from "../src/commerce/MembaTokenFactory.sol";
import { MembaEscrow } from "../src/commerce/MembaEscrow.sol";
import { MembaNFT } from "../src/commerce/MembaNFT.sol";
import { MembaCollections } from "../src/commerce/MembaCollections.sol";
import { MembaTokenOTC } from "../src/commerce/MembaTokenOTC.sol";

// Social
import { MembaReviews } from "../src/social/MembaReviews.sol";
import { MembaBadges } from "../src/social/MembaBadges.sol";
import { MembaQuests } from "../src/social/MembaQuests.sol";
import { MembaPoints } from "../src/social/MembaPoints.sol";
import { MembaAppStore } from "../src/social/MembaAppStore.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title Deploy
 * @notice Full deployment for all 15 Memba EVM contracts.
 *
 * Usage:
 *   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
 */
contract Deploy is Script {
    /// @notice Every address `deployAll` produces, so a test (and the deploy log) can verify
    ///         the wiring instead of trusting a console line. `upgrader` is the Safe, or the
    ///         `TimelockController` when `TIMELOCK_DELAY` is set.
    struct Deployed {
        address daoFactory;
        address firstDAO;
        address candidature;
        address channels;
        address registry;
        address tokenFactory;
        address escrow;
        address nft;
        address collections;
        address otc;
        address reviews;
        address badges;
        address quests;
        address points;
        address appStore;
        address upgrader;
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address safe = vm.envAddress("SAFE_MULTISIG_ADDRESS");
        address treasury = vm.envOr("TREASURY_ADDRESS", safe);
        // Operational server key: mints badges, attests quests. NOT an upgrade key.
        // It used to be both, so a backend compromise meant contract takeover; and
        // leaving it unset silently made the Safe the minter, so minting just failed.
        // Required explicitly now — no default that is wrong either way.
        address verifier = vm.envAddress("BACKEND_VERIFIER");
        // Upgrade authority. §17.2 makes a timelock on upgrades mandatory. Set
        // TIMELOCK_DELAY to deploy a TimelockController and use it as the authority;
        // otherwise the Safe holds it directly (handoff later via transferUpgrader).
        uint256 timelockDelay = vm.envOr("TIMELOCK_DELAY", uint256(0));

        console.log("=== Memba EVM Deployment ===");
        console.log("Deployer:", vm.addr(deployerPrivateKey));
        if (timelockDelay == 0) console.log("WARNING: no TIMELOCK_DELAY set - upgrades are immediate.");

        vm.startBroadcast(deployerPrivateKey);
        Deployed memory d = deployAll(safe, treasury, verifier, timelockDelay);
        vm.stopBroadcast();

        console.log("=== Deployment Complete (15 contracts) ===");
    }

    /// @notice Deploys and wires the full 15-contract stack and returns every address.
    /// @dev No `vm.startBroadcast` and no env reads, so a forge test can call it directly.
    ///      Callers under a broadcast (i.e. `run`) still broadcast every CREATE/CALL.
    function deployAll(address safe, address treasury, address verifier, uint256 timelockDelay)
        public
        returns (Deployed memory d)
    {
        d.upgrader = safe;
        if (timelockDelay > 0) {
            address[] memory proposers = new address[](1);
            proposers[0] = safe;
            address[] memory executors = new address[](1);
            executors[0] = safe;
            // admin = address(0): no one can bypass the delay by re-granting roles.
            d.upgrader = address(new TimelockController(timelockDelay, proposers, executors, address(0)));
            console.log("[Core] TimelockController:", d.upgrader);
        }
        require(verifier != d.upgrader, "BACKEND_VERIFIER must not be the upgrade authority");

        (d.daoFactory, d.firstDAO, d.candidature, d.channels, d.registry) = _deployCore(safe, treasury);
        (d.tokenFactory, d.escrow, d.nft) = _deployCommerce(safe, treasury);
        (d.collections, d.otc) = _deployCollectionsAndOTC(safe, treasury, d.nft);
        (d.reviews, d.badges, d.quests, d.points, d.appStore) = _deploySocial(safe, treasury, verifier, d.upgrader);
    }

    function _deployCore(address safe, address treasury)
        internal
        returns (address factory, address firstDAO, address candidature, address channels, address registry)
    {
        MembaDAOFactory f = new MembaDAOFactory(address(new MembaDAO()));
        factory = address(f);
        console.log("[Core] DAOFactory:", factory);

        firstDAO = f.createDAO("Samourai Coop", "Official Memba DAO", safe, bytes32(uint256(1)));
        console.log("[Core] First DAO:", firstDAO);

        candidature = address(
            new ERC1967Proxy(
                address(new MembaCandidature()),
                abi.encodeCall(MembaCandidature.initialize, (firstDAO, safe, treasury, 0.01 ether))
            )
        );
        console.log("[Core] Candidature:", candidature);
        // The Candidature proxy calls DAO.addMember, which is `onlyRole(ADMIN_ROLE)`. The DAO
        // was created with admin = safe, so ONLY the safe can grant it — the deployer EOA
        // cannot. Without this grant `markApproved` reverts 100% and the membership flow is
        // dead on arrival. See docs/evm-migration/DEPLOY_CEREMONY.md (step 1).
        console.log("ACTION REQUIRED (Safe tx): MembaDAO.grantRole(ADMIN_ROLE, Candidature)");
        console.log("  on DAO:", firstDAO);
        console.log("  grantee:", candidature);

        channels = address(
            new ERC1967Proxy(address(new MembaChannels()), abi.encodeCall(MembaChannels.initialize, (firstDAO, safe)))
        );
        console.log("[Core] Channels:", channels);

        registry = address(
            new ERC1967Proxy(address(new MembaRegistry()), abi.encodeCall(MembaRegistry.initialize, (safe, safe, 200)))
        );
        console.log("[Core] Registry:", registry);

        // C-4: nominate the Safe as factory owner. The factory is non-upgradeable and
        // `setImplementation` (which repoints the DAO template used by every FUTURE
        // createDAO) is onlyOwner. It is created owned by the deployer EOA, so hand it off.
        // Ownable2Step → this only sets pendingOwner; the Safe must acceptOwnership() to
        // finish (DEPLOY_CEREMONY.md step 3). Until then the deployer stays owner.
        f.transferOwnership(safe);
        console.log("ACTION REQUIRED (Safe tx): MembaDAOFactory.acceptOwnership()");
        console.log("  on Factory:", factory);
        console.log("  new owner:", safe);
    }

    function _deployCommerce(address safe, address treasury)
        internal
        returns (address tokenFactory, address escrow, address nft)
    {
        tokenFactory = address(
            new ERC1967Proxy(
                address(new MembaTokenFactory()),
                abi.encodeCall(MembaTokenFactory.initialize, (safe, treasury, 0.001 ether))
            )
        );
        console.log("[Commerce] TokenFactory:", tokenFactory);

        escrow = address(
            new ERC1967Proxy(
                address(new MembaEscrow()), abi.encodeCall(MembaEscrow.initialize, (safe, treasury, 200, 500, 30 days))
            )
        );
        console.log("[Commerce] Escrow:", escrow);

        nft = address(new ERC1967Proxy(address(new MembaNFT()), abi.encodeCall(MembaNFT.initialize, (safe))));
        console.log("[Commerce] NFT:", nft);
    }

    function _deployCollectionsAndOTC(address safe, address treasury, address nft)
        internal
        returns (address collections, address otc)
    {
        collections = address(
            new ERC1967Proxy(
                address(new MembaCollections()),
                abi.encodeCall(MembaCollections.initialize, (safe, treasury, 0.01 ether, nft))
            )
        );
        console.log("[Commerce] Collections:", collections);
        // Collections mints into MembaNFT via the launchpad hook, which is gated on
        // `msg.sender == $.launchpad`. MembaNFT was initialized with admin = safe and its
        // launchpad is unset, so the launchpad mint reverts until the safe wires it. The
        // deployer EOA is not the NFT admin and cannot do this. See DEPLOY_CEREMONY.md (step 2).
        console.log("ACTION REQUIRED (Safe tx): MembaNFT.setLaunchpad(Collections)");
        console.log("  on NFT:", nft);
        console.log("  launchpad:", collections);

        otc = address(
            new ERC1967Proxy(
                address(new MembaTokenOTC()), abi.encodeCall(MembaTokenOTC.initialize, (safe, treasury, 100))
            )
        );
        console.log("[Commerce] OTC:", otc);
    }

    function _deploySocial(address safe, address treasury, address verifier, address upgrader)
        internal
        returns (address reviews, address badges, address quests, address points, address appStore)
    {
        reviews = address(
            new ERC1967Proxy(address(new MembaReviews()), abi.encodeCall(MembaReviews.initialize, (safe)))
        );
        console.log("[Social] Reviews:", reviews);

        badges = address(
            new ERC1967Proxy(address(new MembaBadges()), abi.encodeCall(MembaBadges.initialize, (verifier, upgrader)))
        );
        console.log("[Social] Badges:", badges);

        quests = address(
            new ERC1967Proxy(address(new MembaQuests()), abi.encodeCall(MembaQuests.initialize, (verifier, upgrader)))
        );
        console.log("[Social] Quests:", quests);

        points = address(new ERC1967Proxy(address(new MembaPoints()), abi.encodeCall(MembaPoints.initialize, (safe))));
        console.log("[Social] Points:", points);

        appStore = address(
            new ERC1967Proxy(
                address(new MembaAppStore()), abi.encodeCall(MembaAppStore.initialize, (safe, treasury, 0.001 ether))
            )
        );
        console.log("[Social] AppStore:", appStore);
    }
}
