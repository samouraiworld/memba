// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {RpcUrl} from "../RpcUrl.sol";

interface IPluginRepoLive {
    function buildCount(uint8 release) external view returns (uint256);
}

interface IDaoFactoryLive {
    function protocolVersion() external view returns (uint8[3] memory);
}

interface IBaseRegistrarLive {
    function controllers(address) external view returns (bool);
}

/// Checks deployments/evm/<chainId>.json against the chain at its latest block: chain id, code at every
/// address, runtime codehash, EIP-1967 implementation and its codehash for proxies, readable versions and
/// pinned Aragon builds. A proxy upgrade is a failure on purpose: it is a review event.
/// Run: forge test --match-path 'test/manifest/ManifestLive.t.sol' -vv
/// EVM_MANIFEST_DIR overrides the manifest directory (the CI canary points it at a corrupted copy).
abstract contract ManifestLiveTest is Test {
    using stdJson for string;

    bytes32 internal constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    string internal json;

    function _chain() internal pure virtual returns (string memory);
    function _chainId() internal pure virtual returns (uint256);

    function setUp() public {
        string memory dir = vm.envOr("EVM_MANIFEST_DIR", string("../../deployments/evm"));
        json = vm.readFile(string.concat(dir, "/", vm.toString(_chainId()), ".json"));
        vm.createSelectFork(RpcUrl.forAlias(_chain()));
    }

    function _p(string memory key, string memory field) internal pure returns (string memory) {
        return string.concat(".contracts.", key, field);
    }

    function test_chain_id() public view {
        assertEq(block.chainid, _chainId(), "RPC serves another chain");
        assertEq(json.readUint(".chainId"), _chainId(), "manifest chainId");
    }

    function test_every_contract_matches() public {
        string[] memory keys = vm.parseJsonKeys(json, ".contracts");
        assertGt(keys.length, 0, "manifest lists no contracts");
        for (uint256 i; i < keys.length; i++) {
            string memory k = keys[i];
            address a = json.readAddress(_p(k, ".address"));
            assertGt(a.code.length, 0, string.concat(k, ": no code"));
            assertEq(a.codehash, json.readBytes32(_p(k, ".codehash")), string.concat(k, ": codehash"));
            if (json.keyExists(_p(k, ".proxy"))) {
                address impl = address(uint160(uint256(vm.load(a, IMPLEMENTATION_SLOT))));
                assertEq(impl, json.readAddress(_p(k, ".proxy.implementation")), string.concat(k, ": implementation"));
                assertEq(
                    impl.codehash,
                    json.readBytes32(_p(k, ".proxy.implementationCodehash")),
                    string.concat(k, ": implementation codehash")
                );
            }
            if (json.keyExists(_p(k, ".versionGetter"))) {
                (bool ok, bytes memory ret) =
                    a.staticcall(abi.encodeWithSignature(json.readString(_p(k, ".versionGetter"))));
                assertTrue(ok, string.concat(k, ": version getter reverted"));
                assertEq(abi.decode(ret, (string)), json.readString(_p(k, ".version")), string.concat(k, ": version"));
            }
            if (json.keyExists(_p(k, ".build"))) {
                uint8 release = uint8(json.readUint(_p(k, ".build.release")));
                uint256 built = IPluginRepoLive(a).buildCount(release);
                assertGe(built, json.readUint(_p(k, ".build.build")), string.concat(k, ": pinned build missing"));
            }
            console2.log(string.concat(_chain(), " | ", k, " | ", vm.toString(a), " | ok"));
        }
    }

    function test_aragon_protocol_version() public view {
        uint8[3] memory v = IDaoFactoryLive(json.readAddress(".contracts.aragonDaoFactory.address")).protocolVersion();
        string memory got = string.concat(vm.toString(v[0]), ".", vm.toString(v[1]), ".", vm.toString(v[2]));
        assertEq(got, json.readString(".contracts.aragonDaoFactory.version"), "Aragon protocol version");
    }

    /// The controller Memba registers through is accepted by the registrar.
    function test_basenames_controller_accepted() public view {
        IBaseRegistrarLive r = IBaseRegistrarLive(json.readAddress(".contracts.basenamesBaseRegistrar.address"));
        assertTrue(r.controllers(json.readAddress(".contracts.basenamesRegistrarController.address")));
    }
}

contract ManifestLiveBaseTest is ManifestLiveTest {
    function _chain() internal pure override returns (string memory) {
        return "base";
    }

    function _chainId() internal pure override returns (uint256) {
        return 8453;
    }
}

contract ManifestLiveBaseSepoliaTest is ManifestLiveTest {
    function _chain() internal pure override returns (string memory) {
        return "base_sepolia";
    }

    function _chainId() internal pure override returns (uint256) {
        return 84532;
    }
}
