// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {stdJson} from "forge-std/StdJson.sol";
import {ForkBase} from "./ForkBase.sol";
import {Addr} from "./Addresses.sol";

interface IFxRegistrar {
    function ownerOf(uint256 id) external view returns (address);
}

interface IFxRegistry {
    function resolver(bytes32 node) external view returns (address);
}

interface IFxResolver {
    function addr(bytes32 node) external view returns (address);
    function text(bytes32 node, string calldata key) external view returns (string memory);
    function name(bytes32 node) external view returns (string memory);
}

interface IFxReverse {
    function nameForAddr(address addr) external view returns (string memory);
    function setName(string calldata name) external;
}

/// Executes the calldata the frontend encodes (test/fixtures/basenames-<chainId>.json, written and checked by
/// frontend/src/lib/chain/evm/basenamesWrite.fixture.test.ts) against the deployed Basenames contracts, so the
/// app's encoding is proven by the contracts themselves, not by its own ABI.
abstract contract BasenamesFixtureTest is ForkBase {
    using stdJson for string;

    function _registry() internal pure virtual returns (address);
    function _l2Reverse() internal pure virtual returns (address);
    function _baseRegistrar() internal pure virtual returns (address);

    function _call(string memory json, string memory step, uint256 value) internal {
        address to = json.readAddress(string.concat(".", step, ".to"));
        (bool ok,) = to.call{value: value}(json.readBytes(string.concat(".", step, ".data")));
        assertTrue(ok, string.concat(step, " reverted"));
    }

    function _lowerHex(uint256 v, uint256 nibbles) internal pure returns (string memory) {
        bytes memory out = new bytes(nibbles);
        bytes16 digits = "0123456789abcdef";
        for (uint256 i; i < nibbles; i++) {
            out[nibbles - 1 - i] = digits[(v >> (4 * i)) & 0x0f];
        }
        return string(out);
    }

    /// namehash("<addr hex>.<0x80000000 | chainid hex>.reverse"), the legacy (ENSIP-11) reverse node.
    function _legacyReverseNode(address a) internal view returns (bytes32) {
        bytes32 reverse = keccak256(abi.encodePacked(bytes32(0), keccak256("reverse")));
        bytes32 coin = keccak256(abi.encodePacked(reverse, keccak256(bytes(_lowerHex(0x80000000 | block.chainid, 8)))));
        return keccak256(abi.encodePacked(coin, keccak256(bytes(_lowerHex(uint160(a), 40)))));
    }

    function test_frontend_calldata_executes() public {
        string memory json = vm.readFile(string.concat("test/fixtures/basenames-", vm.toString(block.chainid), ".json"));
        address account = json.readAddress(".account");
        assertEq(account, alice);
        string memory name = json.readString(".name");
        bytes32 node = json.readBytes32(".node");
        uint256 price = vm.parseUint(json.readString(".price"));
        uint256 value = vm.parseUint(json.readString(".register.value"));

        // An account whose ENSIP-19 primary name is another one (the fixture's quote says so).
        string memory old = string.concat("membaoldname", block.chainid == 8453 ? ".base.eth" : ".basetest.eth");
        vm.prank(account);
        IFxReverse(_l2Reverse()).setName(old);

        vm.deal(account, 1 ether);
        vm.prank(account);
        _call(json, "register", value);
        assertEq(account.balance, 1 ether - price, "overpayment refunded");
        assertEq(IFxRegistrar(_baseRegistrar()).ownerOf(uint256(keccak256(bytes(json.readString(".label"))))), account);
        address resolver = IFxRegistry(_registry()).resolver(node);
        assertEq(IFxResolver(resolver).addr(node), account);
        assertEq(IFxResolver(resolver).text(node, "description"), "Memba builder");
        assertEq(IFxResolver(resolver).text(node, "memba.profile.v1"), '{"version":1}');
        bytes32 rnode = _legacyReverseNode(account);
        assertEq(
            IFxResolver(IFxRegistry(_registry()).resolver(rnode)).name(rnode),
            name,
            "legacy reverse record set by register"
        );
        assertEq(IFxReverse(_l2Reverse()).nameForAddr(account), old, "register leaves the ENSIP-19 name");

        vm.prank(account);
        _call(json, "setName", 0);
        assertEq(IFxReverse(_l2Reverse()).nameForAddr(account), name);

        vm.prank(account);
        _call(json, "update", 0);
        assertEq(IFxResolver(resolver).text(node, "url"), "https://memba.club");
        assertEq(IFxResolver(resolver).text(node, "description"), "", "cleared");

        vm.prank(bob);
        (bool ok,) = json.readAddress(".update.to").call(json.readBytes(".update.data"));
        assertFalse(ok, "another account cannot edit the records");
    }
}

contract BasenamesFixtureBaseTest is BasenamesFixtureTest {
    function _chain() internal pure override returns (string memory) {
        return "base";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_FORK_BLOCK;
    }

    function _registry() internal pure override returns (address) {
        return Addr.BASENAMES_REGISTRY_BASE;
    }

    function _l2Reverse() internal pure override returns (address) {
        return Addr.BASENAMES_L2_REVERSE_REGISTRAR_BASE;
    }

    function _baseRegistrar() internal pure override returns (address) {
        return Addr.BASENAMES_BASE_REGISTRAR_BASE;
    }
}

contract BasenamesFixtureBaseSepoliaTest is BasenamesFixtureTest {
    function _chain() internal pure override returns (string memory) {
        return "base_sepolia";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_SEPOLIA_FORK_BLOCK;
    }

    function _registry() internal pure override returns (address) {
        return Addr.BASENAMES_REGISTRY_BASE_SEPOLIA;
    }

    function _l2Reverse() internal pure override returns (address) {
        return Addr.BASENAMES_L2_REVERSE_REGISTRAR_BASE_SEPOLIA;
    }

    function _baseRegistrar() internal pure override returns (address) {
        return Addr.BASENAMES_BASE_REGISTRAR_BASE_SEPOLIA;
    }
}
