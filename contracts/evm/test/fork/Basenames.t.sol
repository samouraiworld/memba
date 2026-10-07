// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkBase} from "./ForkBase.sol";
import {Addr} from "./Addresses.sol";

struct BnRegisterRequest {
    string name;
    address owner;
    uint256 duration;
    address resolver;
    bytes[] data;
    bool reverseRecord;
    uint256[] coinTypes;
    uint256 signatureExpiry;
    bytes signature;
}

struct BnLegacyRegisterRequest {
    string name;
    address owner;
    uint256 duration;
    address resolver;
    bytes[] data;
    bool reverseRecord;
}

interface IBnController {
    function registerPrice(string memory name, uint256 duration) external view returns (uint256);
    function available(string memory name) external view returns (bool);
    function register(BnRegisterRequest calldata request) external payable;
}

interface IBnLegacyController {
    function registerPrice(string memory name, uint256 duration) external view returns (uint256);
    function register(BnLegacyRegisterRequest calldata request) external payable;
}

interface IBnRegistrar {
    function baseNode() external view returns (bytes32);
    function ownerOf(uint256 id) external view returns (address);
    function controllers(address) external view returns (bool);
}

interface IBnResolver {
    function setText(bytes32 node, string calldata key, string calldata value) external;
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

/// Profile row: a Basename registered through the controller that is live today, with a text record.
abstract contract BasenamesTest is ForkBase {
    function _controller() internal pure virtual returns (address);
    function _legacyController() internal pure virtual returns (address);
    function _registrar() internal pure virtual returns (address);
    function _resolver() internal pure virtual returns (address);

    function test_basename_register_and_text_record() public {
        string memory label = "membaphase0probe";
        IBnController c = IBnController(_controller());
        assertTrue(c.available(label));
        uint256 price = c.registerPrice(label, 365 days);
        emit log_named_uint("1-year price (wei)", price);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 g = gasleft();
        c.register{value: price}(
            BnRegisterRequest(label, alice, 365 days, _resolver(), new bytes[](0), false, new uint256[](0), 0, "")
        );
        _gas("Basenames register (UpgradeableRegistrarController, no reverse record)", g - gasleft());
        bytes32 labelhash = keccak256(bytes(label));
        assertEq(IBnRegistrar(_registrar()).ownerOf(uint256(labelhash)), alice);

        bytes32 node = keccak256(abi.encodePacked(IBnRegistrar(_registrar()).baseNode(), labelhash));
        vm.prank(alice);
        g = gasleft();
        IBnResolver(_resolver()).setText(node, "org.memba.profile", "ipfs://profile");
        _gas("Basenames setText (UpgradeableL2Resolver)", g - gasleft());
        assertEq(IBnResolver(_resolver()).text(node, "org.memba.profile"), "ipfs://profile");
    }

    /// Which controller the registrar accepts today (README lists both).
    function test_basename_legacy_controller_status() public {
        bool legacy = IBnRegistrar(_registrar()).controllers(_legacyController());
        emit log_named_string("legacy RegistrarController still a controller", legacy ? "yes" : "no");
        assertTrue(IBnRegistrar(_registrar()).controllers(_controller()));
    }
}

contract BasenamesBaseSepoliaTest is BasenamesTest {
    function _chain() internal pure override returns (string memory) {
        return "base_sepolia";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_SEPOLIA_FORK_BLOCK;
    }

    function _controller() internal pure override returns (address) {
        return Addr.BASENAMES_UPGRADEABLE_CONTROLLER_BASE_SEPOLIA;
    }

    function _legacyController() internal pure override returns (address) {
        return Addr.BASENAMES_REGISTRAR_CONTROLLER_BASE_SEPOLIA;
    }

    function _registrar() internal pure override returns (address) {
        return Addr.BASENAMES_BASE_REGISTRAR_BASE_SEPOLIA;
    }

    function _resolver() internal pure override returns (address) {
        return Addr.BASENAMES_UPGRADEABLE_L2_RESOLVER_BASE_SEPOLIA;
    }
}

contract BasenamesBaseTest is BasenamesTest {
    function _chain() internal pure override returns (string memory) {
        return "base";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_FORK_BLOCK;
    }

    function _controller() internal pure override returns (address) {
        return Addr.BASENAMES_UPGRADEABLE_CONTROLLER_BASE;
    }

    function _legacyController() internal pure override returns (address) {
        return Addr.BASENAMES_REGISTRAR_CONTROLLER_BASE;
    }

    function _registrar() internal pure override returns (address) {
        return Addr.BASENAMES_BASE_REGISTRAR_BASE;
    }

    function _resolver() internal pure override returns (address) {
        return Addr.BASENAMES_UPGRADEABLE_L2_RESOLVER_BASE;
    }

    /// On Base mainnet the legacy controller is no longer a registrar controller: registering through it fails.
    function test_basename_legacy_controller_refused() public {
        IBnLegacyController c = IBnLegacyController(_legacyController());
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        c.register{value: 0.1 ether}(
            BnLegacyRegisterRequest(
                "membaphase0legacy", alice, 365 days, Addr.BASENAMES_L2_RESOLVER_BASE, new bytes[](0), false
            )
        );
    }
}
