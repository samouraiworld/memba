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
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address safe = vm.envAddress("SAFE_MULTISIG_ADDRESS");
        address treasury = vm.envOr("TREASURY_ADDRESS", safe);
        // Operational server key: mints badges, attests quests. NOT an upgrade key.
        // It used to be both, so a backend compromise meant contract takeover; and
        // leaving it unset silently made the Safe the minter, so minting just failed.
        // Required explicitly now — no default that is wrong either way.
        address verifier = vm.envAddress("BACKEND_VERIFIER");

        // Upgrade authority. §17.2 makes a 48h timelock on upgrades mandatory, and
        // nothing implemented one — a single Safe transaction could swap the
        // implementation of a fund-holding contract instantly, with no user exit
        // window. Set TIMELOCK_DELAY to deploy a TimelockController (Safe as proposer
        // and executor) and use it as the authority; otherwise the Safe holds it
        // directly and the handoff can be done later via transferUpgrader/acceptUpgrader.
        uint256 timelockDelay = vm.envOr("TIMELOCK_DELAY", uint256(0));
        address upgrader = safe;
        if (timelockDelay > 0) {
            address[] memory proposers = new address[](1);
            proposers[0] = safe;
            address[] memory executors = new address[](1);
            executors[0] = safe;
            // admin = address(0): no one can bypass the delay by re-granting roles.
            upgrader = address(new TimelockController(timelockDelay, proposers, executors, address(0)));
            console.log("[Core] TimelockController:", upgrader);
            console.log("       delay (seconds):", timelockDelay);
        } else {
            console.log("WARNING: no TIMELOCK_DELAY set - upgrades are immediate.");
        }
        require(verifier != upgrader, "BACKEND_VERIFIER must not be the upgrade authority");

        console.log("=== Memba EVM Deployment ===");
        console.log("Deployer:", vm.addr(deployerPrivateKey));

        vm.startBroadcast(deployerPrivateKey);

        address firstDAO = _deployCore(safe);
        address nftProxy = _deployCommerce(safe, treasury);
        _deployCollectionsAndOTC(safe, treasury, nftProxy);
        _deploySocial(safe, treasury, verifier, upgrader);

        vm.stopBroadcast();
        console.log("=== Deployment Complete (15 contracts) ===");
    }

    function _deployCore(address safe) internal returns (address firstDAO) {
        MembaDAO daoImpl = new MembaDAO();
        MembaDAOFactory factory = new MembaDAOFactory(address(daoImpl));
        console.log("[Core] DAOFactory:", address(factory));

        firstDAO = factory.createDAO("Samourai Coop", "Official Memba DAO", safe, bytes32(uint256(1)));
        console.log("[Core] First DAO:", firstDAO);

        address candProxy = address(
            new ERC1967Proxy(
                address(new MembaCandidature()),
                abi.encodeCall(MembaCandidature.initialize, (firstDAO, safe, 0.01 ether))
            )
        );
        console.log("[Core] Candidature:", candProxy);

        address channelsProxy = address(
            new ERC1967Proxy(address(new MembaChannels()), abi.encodeCall(MembaChannels.initialize, (firstDAO, safe)))
        );
        console.log("[Core] Channels:", channelsProxy);

        address registryProxy = address(
            new ERC1967Proxy(address(new MembaRegistry()), abi.encodeCall(MembaRegistry.initialize, (safe, safe, 200)))
        );
        console.log("[Core] Registry:", registryProxy);
    }

    function _deployCommerce(address safe, address treasury) internal returns (address nftProxy) {
        address tokenFactoryProxy = address(
            new ERC1967Proxy(
                address(new MembaTokenFactory()),
                abi.encodeCall(MembaTokenFactory.initialize, (safe, treasury, 0.001 ether))
            )
        );
        console.log("[Commerce] TokenFactory:", tokenFactoryProxy);

        address escrowProxy = address(
            new ERC1967Proxy(
                address(new MembaEscrow()), abi.encodeCall(MembaEscrow.initialize, (safe, treasury, 200, 500, 30 days))
            )
        );
        console.log("[Commerce] Escrow:", escrowProxy);

        nftProxy = address(new ERC1967Proxy(address(new MembaNFT()), abi.encodeCall(MembaNFT.initialize, (safe))));
        console.log("[Commerce] NFT:", nftProxy);
    }

    function _deployCollectionsAndOTC(address safe, address treasury, address nftProxy) internal {
        address collectionsProxy = address(
            new ERC1967Proxy(
                address(new MembaCollections()),
                abi.encodeCall(MembaCollections.initialize, (safe, treasury, 0.01 ether, nftProxy))
            )
        );
        console.log("[Commerce] Collections:", collectionsProxy);

        address otcProxy = address(
            new ERC1967Proxy(
                address(new MembaTokenOTC()), abi.encodeCall(MembaTokenOTC.initialize, (safe, treasury, 100))
            )
        );
        console.log("[Commerce] OTC:", otcProxy);
    }

    function _deploySocial(address safe, address treasury, address verifier, address upgrader) internal {
        address reviewsProxy =
            address(new ERC1967Proxy(address(new MembaReviews()), abi.encodeCall(MembaReviews.initialize, (safe))));
        console.log("[Social] Reviews:", reviewsProxy);

        address badgesProxy = address(
            new ERC1967Proxy(address(new MembaBadges()), abi.encodeCall(MembaBadges.initialize, (verifier, upgrader)))
        );
        console.log("[Social] Badges:", badgesProxy);

        address questsProxy = address(
            new ERC1967Proxy(address(new MembaQuests()), abi.encodeCall(MembaQuests.initialize, (verifier, upgrader)))
        );
        console.log("[Social] Quests:", questsProxy);

        address pointsProxy =
            address(new ERC1967Proxy(address(new MembaPoints()), abi.encodeCall(MembaPoints.initialize, (safe))));
        console.log("[Social] Points:", pointsProxy);

        address appStoreProxy = address(
            new ERC1967Proxy(
                address(new MembaAppStore()), abi.encodeCall(MembaAppStore.initialize, (safe, treasury, 0.001 ether))
            )
        );
        console.log("[Social] AppStore:", appStoreProxy);
    }
}
