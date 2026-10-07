// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Addr} from "../fork/Addresses.sol";

/// Offline checks of deployments/evm: both chains list the same keys (one typed key set for the frontend),
/// no denied address is also listed as usable, and the fork tests' constants (Addresses.sol) agree with the
/// manifest, so the tests exercise exactly the contracts the app will call.
contract ManifestConsistencyTest is Test {
    using stdJson for string;

    string internal base;
    string internal sepolia;

    function setUp() public {
        string memory dir = vm.envOr("EVM_MANIFEST_DIR", string("../../deployments/evm"));
        base = vm.readFile(string.concat(dir, "/8453.json"));
        sepolia = vm.readFile(string.concat(dir, "/84532.json"));
    }

    function _a(string memory json, string memory key) internal pure returns (address) {
        return json.readAddress(string.concat(".contracts.", key, ".address"));
    }

    function test_chain_ids() public view {
        assertEq(base.readUint(".chainId"), 8453);
        assertEq(sepolia.readUint(".chainId"), 84532);
    }

    function test_same_keys_on_both_chains() public view {
        string[] memory kb = vm.parseJsonKeys(base, ".contracts");
        string[] memory ks = vm.parseJsonKeys(sepolia, ".contracts");
        assertEq(kb.length, ks.length, "key count differs");
        for (uint256 i; i < kb.length; i++) {
            assertTrue(
                sepolia.keyExists(string.concat(".contracts.", kb[i])), string.concat("missing on 84532: ", kb[i])
            );
        }
    }

    function test_denied_addresses_are_not_listed() public view {
        _noDenied(base);
        _noDenied(sepolia);
    }

    function _noDenied(string memory json) internal view {
        string[] memory deny = vm.parseJsonKeys(json, ".deny");
        string[] memory keys = vm.parseJsonKeys(json, ".contracts");
        for (uint256 d; d < deny.length; d++) {
            address bad = json.readAddress(string.concat(".deny.", deny[d], ".address"));
            for (uint256 k; k < keys.length; k++) {
                assertTrue(_a(json, keys[k]) != bad, string.concat(keys[k], " is denied as ", deny[d]));
            }
        }
    }

    function test_fork_constants_match_manifest() public view {
        _both("safeSingleton", Addr.SAFE);
        _both("safeL2Singleton", Addr.SAFE_L2);
        _both("safeProxyFactory", Addr.SAFE_PROXY_FACTORY);
        _both("safeFallbackHandler", Addr.SAFE_FALLBACK_HANDLER);
        _both("safeMultiSend", Addr.SAFE_MULTISEND);
        _both("safeMultiSendCallOnly", Addr.SAFE_MULTISEND_CALL_ONLY);
        _both("allowanceModuleV1", Addr.ALLOWANCE_MODULE_V1_0_0);
        _both("allowanceModuleV011", Addr.ALLOWANCE_MODULE_V0_1_1);
        _both("zodiacRolesV2Mastercopy", Addr.ROLES_V2_MASTERCOPY);
        _both("zodiacModuleProxyFactory", Addr.MODULE_PROXY_FACTORY);
        _both("zodiacRolesIntegrity", Addr.ROLES_INTEGRITY);
        _both("zodiacRolesPacker", Addr.ROLES_PACKER);
        _both("zodiacRolesMultiSendUnwrapper", Addr.ROLES_MULTISEND_UNWRAPPER);
        _both("snapshotXProxyFactory", Addr.SX_PROXY_FACTORY);
        _both("snapshotXSpaceImpl", Addr.SX_SPACE_IMPL);
        _both("snapshotXWhitelistVoting", Addr.SX_WHITELIST_VOTING);
        _both("snapshotXAvatarExecutionImpl", Addr.SX_AVATAR_EXECUTION_IMPL);
        _both("snapshotXTimelockExecutionImpl", Addr.SX_TIMELOCK_EXECUTION_IMPL);
        _both("snapshotXVanillaAuthenticator", Addr.SX_VANILLA_AUTH);
        _both("snapshotXEthTxAuthenticator", Addr.SX_ETH_TX_AUTH);
        _both("snapshotXEthSigAuthenticator", Addr.SX_ETH_SIG_AUTH);
        _both("snapshotXVanillaProposalValidation", Addr.SX_VANILLA_PROPOSAL_VALIDATION);
        _both("snapshotXPropositionPowerValidation", Addr.SX_PROPOSITION_POWER_VALIDATION);
        _both("uniswapCcaFactory", Addr.CCA_FACTORY_V2_1_0);
        _both("eas", Addr.EAS);
        _both("easSchemaRegistry", Addr.EAS_SCHEMA_REGISTRY);
        _both("seaport", Addr.SEAPORT_1_6);
        _both("seaportConduitController", Addr.SEAPORT_CONDUIT_CONTROLLER);

        assertEq(_a(base, "aragonDaoFactory"), Addr.ARAGON_DAO_FACTORY_BASE);
        assertEq(_a(base, "aragonPluginSetupProcessor"), Addr.ARAGON_PSP_BASE);
        assertEq(_a(base, "aragonDaoRegistry"), Addr.ARAGON_DAO_REGISTRY_BASE);
        assertEq(_a(base, "aragonPluginRepoRegistry"), Addr.ARAGON_PLUGIN_REPO_REGISTRY_BASE);
        assertEq(_a(base, "aragonMultisigRepo"), Addr.ARAGON_MULTISIG_REPO_BASE);
        assertEq(_a(base, "aragonTokenVotingRepo"), Addr.ARAGON_TOKENVOTING_REPO_BASE);
        assertEq(_a(sepolia, "aragonDaoFactory"), Addr.ARAGON_DAO_FACTORY_BASE_SEPOLIA);
        assertEq(_a(sepolia, "aragonPluginSetupProcessor"), Addr.ARAGON_PSP_BASE_SEPOLIA);
        assertEq(_a(sepolia, "aragonMultisigRepo"), Addr.ARAGON_MULTISIG_REPO_BASE_SEPOLIA);
        assertEq(_a(sepolia, "aragonTokenVotingRepo"), Addr.ARAGON_TOKENVOTING_REPO_BASE_SEPOLIA_COMMONS);
        assertEq(
            sepolia.readAddress(".deny.aragonTokenVotingRepoNpm.address"), Addr.ARAGON_TOKENVOTING_REPO_BASE_SEPOLIA_NPM
        );

        assertEq(_a(base, "basenamesRegistry"), Addr.BASENAMES_REGISTRY_BASE);
        assertEq(_a(base, "basenamesBaseRegistrar"), Addr.BASENAMES_BASE_REGISTRAR_BASE);
        assertEq(_a(base, "basenamesRegistrarController"), Addr.BASENAMES_UPGRADEABLE_CONTROLLER_BASE);
        assertEq(_a(base, "basenamesL2Resolver"), Addr.BASENAMES_UPGRADEABLE_L2_RESOLVER_BASE);
        assertEq(_a(base, "basenamesL2ResolverLegacy"), Addr.BASENAMES_L2_RESOLVER_BASE);
        assertEq(
            base.readAddress(".deny.basenamesRegistrarControllerLegacy.address"),
            Addr.BASENAMES_REGISTRAR_CONTROLLER_BASE
        );
        assertEq(_a(sepolia, "basenamesRegistry"), Addr.BASENAMES_REGISTRY_BASE_SEPOLIA);
        assertEq(_a(sepolia, "basenamesBaseRegistrar"), Addr.BASENAMES_BASE_REGISTRAR_BASE_SEPOLIA);
        assertEq(_a(sepolia, "basenamesRegistrarController"), Addr.BASENAMES_UPGRADEABLE_CONTROLLER_BASE_SEPOLIA);
        assertEq(_a(sepolia, "basenamesL2Resolver"), Addr.BASENAMES_UPGRADEABLE_L2_RESOLVER_BASE_SEPOLIA);
        assertEq(_a(sepolia, "basenamesL2ResolverLegacy"), Addr.BASENAMES_L2_RESOLVER_BASE_SEPOLIA);
        assertEq(
            sepolia.readAddress(".deny.basenamesRegistrarControllerLegacy.address"),
            Addr.BASENAMES_REGISTRAR_CONTROLLER_BASE_SEPOLIA
        );
    }

    function _both(string memory key, address expected) internal view {
        assertEq(_a(base, key), expected, string.concat("8453 ", key));
        assertEq(_a(sepolia, key), expected, string.concat("84532 ", key));
    }
}
