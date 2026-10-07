// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {Addr} from "./Addresses.sol";

/// Task 1: code exists at every canonical address on Base and Base Sepolia.
/// Run: forge test --match-contract AvailabilityTest -vv
/// Prints one line per address: chain | label | address | code size | codehash | expected-hash match.
contract AvailabilityTest is Test {
    struct Entry {
        string label;
        address a;
        bytes32 expected; // 0 when the source publishes no codehash
    }

    uint256 internal missing;

    function _check(string memory chain, Entry memory e) internal returns (bool present) {
        uint256 size = e.a.code.length;
        bytes32 h = e.a.codehash;
        present = size > 0;
        string memory match_ = e.expected == bytes32(0) ? "n/a" : (h == e.expected ? "MATCH" : "MISMATCH");
        console2.log(
            string.concat(
                chain,
                " | ",
                e.label,
                " | ",
                vm.toString(e.a),
                " | ",
                vm.toString(size),
                " | ",
                vm.toString(h),
                " | ",
                match_
            )
        );
        if (!present) missing++;
        if (e.expected != bytes32(0)) assertEq(h, e.expected, e.label);
    }

    function _common() internal pure returns (Entry[] memory es) {
        es = new Entry[](27);
        uint256 i;
        es[i++] = Entry("Safe 1.5.0 singleton", Addr.SAFE, Addr.SAFE_CODEHASH);
        es[i++] = Entry("SafeL2 1.5.0 singleton", Addr.SAFE_L2, Addr.SAFE_L2_CODEHASH);
        es[i++] = Entry("SafeProxyFactory 1.5.0", Addr.SAFE_PROXY_FACTORY, Addr.SAFE_PROXY_FACTORY_CODEHASH);
        es[i++] = Entry(
            "CompatibilityFallbackHandler 1.5.0", Addr.SAFE_FALLBACK_HANDLER, Addr.SAFE_FALLBACK_HANDLER_CODEHASH
        );
        es[i++] = Entry("MultiSend 1.5.0", Addr.SAFE_MULTISEND, Addr.SAFE_MULTISEND_CODEHASH);
        es[i++] =
            Entry("MultiSendCallOnly 1.5.0", Addr.SAFE_MULTISEND_CALL_ONLY, Addr.SAFE_MULTISEND_CALL_ONLY_CODEHASH);
        es[i++] = Entry("AllowanceModule v1.0.0", Addr.ALLOWANCE_MODULE_V1_0_0, bytes32(0));
        es[i++] = Entry("AllowanceModule v0.1.1", Addr.ALLOWANCE_MODULE_V0_1_1, bytes32(0));
        es[i++] = Entry("Zodiac Roles v2.1.1 mastercopy", Addr.ROLES_V2_MASTERCOPY, bytes32(0));
        es[i++] = Entry("Zodiac ModuleProxyFactory 1.2.0", Addr.MODULE_PROXY_FACTORY, bytes32(0));
        es[i++] = Entry("Zodiac Roles Integrity lib", Addr.ROLES_INTEGRITY, bytes32(0));
        es[i++] = Entry("Zodiac Roles Packer lib", Addr.ROLES_PACKER, bytes32(0));
        es[i++] = Entry("Zodiac Roles MultiSendUnwrapper", Addr.ROLES_MULTISEND_UNWRAPPER, bytes32(0));
        es[i++] = Entry("Snapshot X ProxyFactory", Addr.SX_PROXY_FACTORY, bytes32(0));
        es[i++] = Entry("Snapshot X Space implementation", Addr.SX_SPACE_IMPL, bytes32(0));
        es[i++] = Entry("Snapshot X WhitelistVotingStrategy", Addr.SX_WHITELIST_VOTING, bytes32(0));
        es[i++] = Entry("Snapshot X AvatarExecutionStrategy impl", Addr.SX_AVATAR_EXECUTION_IMPL, bytes32(0));
        es[i++] = Entry("Snapshot X TimelockExecutionStrategy impl", Addr.SX_TIMELOCK_EXECUTION_IMPL, bytes32(0));
        es[i++] = Entry("Snapshot X VanillaAuthenticator", Addr.SX_VANILLA_AUTH, bytes32(0));
        es[i++] = Entry("Snapshot X EthTxAuthenticator", Addr.SX_ETH_TX_AUTH, bytes32(0));
        es[i++] = Entry("Snapshot X EthSigAuthenticator", Addr.SX_ETH_SIG_AUTH, bytes32(0));
        es[i++] = Entry("Snapshot X VanillaProposalValidation", Addr.SX_VANILLA_PROPOSAL_VALIDATION, bytes32(0));
        es[i++] = Entry("Snapshot X PropositionPowerValidation", Addr.SX_PROPOSITION_POWER_VALIDATION, bytes32(0));
        es[i++] = Entry("Uniswap CCA factory v2.1.0", Addr.CCA_FACTORY_V2_1_0, bytes32(0));
        es[i++] = Entry("EAS predeploy", Addr.EAS, bytes32(0));
        es[i++] = Entry("EAS SchemaRegistry predeploy", Addr.EAS_SCHEMA_REGISTRY, bytes32(0));
        es[i++] = Entry("Seaport 1.6", Addr.SEAPORT_1_6, bytes32(0));
        assert(i == es.length);
    }

    function _run(string memory chain, Entry[] memory specific) internal {
        Entry[] memory es = _common();
        for (uint256 i; i < es.length; i++) {
            _check(chain, es[i]);
        }
        _check(chain, Entry("Seaport ConduitController", Addr.SEAPORT_CONDUIT_CONTROLLER, bytes32(0)));
        for (uint256 i; i < specific.length; i++) {
            _check(chain, specific[i]);
        }
        console2.log(string.concat(chain, " block ", vm.toString(block.number), " missing ", vm.toString(missing)));
    }

    function test_availability_base() public {
        vm.createSelectFork("base");
        Entry[] memory s = new Entry[](12);
        s[0] = Entry("Aragon DAOFactory v1.4.0", Addr.ARAGON_DAO_FACTORY_BASE, bytes32(0));
        s[1] = Entry("Aragon PluginSetupProcessor", Addr.ARAGON_PSP_BASE, bytes32(0));
        s[2] = Entry("Aragon DAORegistry", Addr.ARAGON_DAO_REGISTRY_BASE, bytes32(0));
        s[3] = Entry("Aragon PluginRepoRegistry", Addr.ARAGON_PLUGIN_REPO_REGISTRY_BASE, bytes32(0));
        s[4] = Entry("Aragon Multisig plugin repo", Addr.ARAGON_MULTISIG_REPO_BASE, bytes32(0));
        s[5] = Entry("Aragon TokenVoting plugin repo", Addr.ARAGON_TOKENVOTING_REPO_BASE, bytes32(0));
        s[6] = Entry("Basenames Registry", Addr.BASENAMES_REGISTRY_BASE, bytes32(0));
        s[7] = Entry("Basenames BaseRegistrar", Addr.BASENAMES_BASE_REGISTRAR_BASE, bytes32(0));
        s[8] = Entry("Basenames RegistrarController (legacy)", Addr.BASENAMES_REGISTRAR_CONTROLLER_BASE, bytes32(0));
        s[9] = Entry("Basenames UpgradeableRegistrarController", Addr.BASENAMES_UPGRADEABLE_CONTROLLER_BASE, bytes32(0));
        s[10] = Entry("Basenames L2Resolver (legacy)", Addr.BASENAMES_L2_RESOLVER_BASE, bytes32(0));
        s[11] = Entry("Basenames UpgradeableL2Resolver", Addr.BASENAMES_UPGRADEABLE_L2_RESOLVER_BASE, bytes32(0));
        _run("base", s);
    }

    function test_availability_baseSepolia() public {
        vm.createSelectFork("base_sepolia");
        Entry[] memory s = new Entry[](11);
        s[0] = Entry("Aragon DAOFactory v1.4.0", Addr.ARAGON_DAO_FACTORY_BASE_SEPOLIA, bytes32(0));
        s[1] = Entry("Aragon PluginSetupProcessor", Addr.ARAGON_PSP_BASE_SEPOLIA, bytes32(0));
        s[2] = Entry("Aragon Multisig plugin repo", Addr.ARAGON_MULTISIG_REPO_BASE_SEPOLIA, bytes32(0));
        s[3] = Entry(
            "Aragon TokenVoting repo (osx-commons)", Addr.ARAGON_TOKENVOTING_REPO_BASE_SEPOLIA_COMMONS, bytes32(0)
        );
        s[4] =
            Entry("Aragon TokenVoting repo (npm-artifacts)", Addr.ARAGON_TOKENVOTING_REPO_BASE_SEPOLIA_NPM, bytes32(0));
        s[5] = Entry("Basenames Registry", Addr.BASENAMES_REGISTRY_BASE_SEPOLIA, bytes32(0));
        s[6] = Entry("Basenames BaseRegistrar", Addr.BASENAMES_BASE_REGISTRAR_BASE_SEPOLIA, bytes32(0));
        s[7] = Entry(
            "Basenames RegistrarController (legacy)", Addr.BASENAMES_REGISTRAR_CONTROLLER_BASE_SEPOLIA, bytes32(0)
        );
        s[8] = Entry(
            "Basenames UpgradeableRegistrarController", Addr.BASENAMES_UPGRADEABLE_CONTROLLER_BASE_SEPOLIA, bytes32(0)
        );
        s[9] = Entry("Basenames L2Resolver (legacy)", Addr.BASENAMES_L2_RESOLVER_BASE_SEPOLIA, bytes32(0));
        s[10] =
            Entry("Basenames UpgradeableL2Resolver", Addr.BASENAMES_UPGRADEABLE_L2_RESOLVER_BASE_SEPOLIA, bytes32(0));
        _run("base_sepolia", s);
    }
}
