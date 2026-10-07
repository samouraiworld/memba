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
    function addr(bytes32 node) external view returns (address);
    function name(bytes32 node) external view returns (string memory);
    function setAddr(bytes32 node, address a) external;
    function multicall(bytes[] calldata data) external returns (bytes[] memory);
}

interface IBnRegistry {
    function resolver(bytes32 node) external view returns (address);
}

interface IBnL2ReverseRegistrar {
    function nameForAddr(address addr) external view returns (string memory);
    function setName(string calldata name) external;
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

    function _suffix() internal view returns (string memory) {
        return block.chainid == 8453 ? ".base.eth" : ".basetest.eth";
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

    /// The Profile app's registration (frontend lib/chain/evm/basenamesWrite.ts): ONE payable transaction that
    /// registers the name on the upgradeable resolver, sets its forward address and profile records through the
    /// request's resolver data, and sets the primary name (legacy reverse record; no ENSIP-19 signature needed).
    /// Overpaying is refunded, so the app can send a small margin over the quoted price.
    function test_register_with_records_and_primary_name_in_one_tx() public {
        string memory label = "membaprofilewrite";
        string memory name = string.concat(label, _suffix());
        IBnController c = IBnController(_controller());
        uint256 price = c.registerPrice(label, 365 days);
        bytes32 node = keccak256(abi.encodePacked(IBnRegistrar(_registrar()).baseNode(), keccak256(bytes(label))));
        bytes[] memory data = new bytes[](3);
        data[0] = abi.encodeCall(IBnResolver.setAddr, (node, alice));
        data[1] = abi.encodeCall(IBnResolver.setText, (node, "description", "Memba builder"));
        data[2] = abi.encodeCall(IBnResolver.setText, (node, "memba.profile.v1", '{"version":1}'));

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 g = gasleft();
        c.register{value: price * 110 / 100}(
            BnRegisterRequest(label, alice, 365 days, _resolver(), data, true, new uint256[](0), 0, "")
        );
        _gas("Basenames register + addr + 2 text records + primary name (one tx)", g - gasleft());
        assertEq(alice.balance, 1 ether - price, "overpayment refunded");

        assertEq(IBnResolver(_resolver()).addr(node), alice);
        assertEq(IBnResolver(_resolver()).text(node, "description"), "Memba builder");
        assertEq(IBnResolver(_resolver()).text(node, "memba.profile.v1"), '{"version":1}');
        bytes32 rnode = _legacyReverseNode(alice);
        address rres = IBnRegistry(_registry()).resolver(rnode);
        assertTrue(rres != address(0), "reverse node has a resolver");
        assertEq(IBnResolver(rres).name(rnode), name, "primary name");
    }

    /// Editing a profile: the owner sets several records in one resolver multicall; anyone else is refused.
    function test_owner_updates_texts_in_one_multicall() public {
        string memory label = "membaprofileedit";
        IBnController c = IBnController(_controller());
        uint256 price = c.registerPrice(label, 365 days);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        c.register{value: price}(
            BnRegisterRequest(label, alice, 365 days, _resolver(), new bytes[](0), false, new uint256[](0), 0, "")
        );
        bytes32 node = keccak256(abi.encodePacked(IBnRegistrar(_registrar()).baseNode(), keccak256(bytes(label))));
        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeCall(IBnResolver.setText, (node, "url", "https://memba.club"));
        data[1] = abi.encodeCall(IBnResolver.setText, (node, "location", "Base"));

        vm.prank(bob);
        vm.expectRevert();
        IBnResolver(_resolver()).multicall(data);

        vm.prank(alice);
        uint256 g = gasleft();
        IBnResolver(_resolver()).multicall(data);
        _gas("Basenames resolver multicall: 2 text records", g - gasleft());
        assertEq(IBnResolver(_resolver()).text(node, "url"), "https://memba.club");
        assertEq(IBnResolver(_resolver()).text(node, "location"), "Base");
    }

    function _registry() internal pure virtual returns (address);
    function _l2Reverse() internal pure virtual returns (address);

    function _register(address payer, address owner, string memory label, bool reverse)
        internal
        returns (uint256 price)
    {
        IBnController c = IBnController(_controller());
        price = c.registerPrice(label, 365 days);
        vm.deal(payer, 1 ether);
        vm.prank(payer);
        c.register{value: price * 105 / 100}(
            BnRegisterRequest(label, owner, 365 days, _resolver(), new bytes[](0), reverse, new uint256[](0), 0, "")
        );
    }

    /// The controller's reverse record and refund go to msg.sender, not to the request's owner: paying for a
    /// name owned by someone else makes it the PAYER's primary name. The app therefore registers for the
    /// sending account only (owner = account).
    function test_reverse_record_and_refund_go_to_the_payer() public {
        string memory label = "membapayerowner";
        uint256 price = _register(alice, bob, label, true);
        assertEq(alice.balance, 1 ether - price, "refund to the payer");
        assertEq(IBnRegistrar(_registrar()).ownerOf(uint256(keccak256(bytes(label)))), bob);
        bytes32 rnode = _legacyReverseNode(alice);
        assertEq(IBnResolver(IBnRegistry(_registry()).resolver(rnode)).name(rnode), string.concat(label, _suffix()));
    }

    /// register(reverseRecord: true) with no coin types and no signature sets only the LEGACY reverse record. An
    /// account that already has an ENSIP-19 primary name keeps it until it calls setName on the L2ReverseRegistrar
    /// itself: the app's follow-up step (planPrimaryName).
    function test_ensip19_primary_name_needs_set_name() public {
        IBnL2ReverseRegistrar rr = IBnL2ReverseRegistrar(_l2Reverse());
        string memory old = string.concat("membaoldname", _suffix());
        vm.prank(alice);
        rr.setName(old);
        assertEq(rr.nameForAddr(alice), old);

        string memory label = "membanewprimary";
        string memory name = string.concat(label, _suffix());
        _register(alice, alice, label, true);
        assertEq(rr.nameForAddr(alice), old, "register leaves the ENSIP-19 name");
        bytes32 rnode = _legacyReverseNode(alice);
        assertEq(IBnResolver(IBnRegistry(_registry()).resolver(rnode)).name(rnode), name, "legacy record updated");

        vm.prank(alice);
        uint256 g = gasleft();
        rr.setName(name);
        _gas("ENSIP-19 setName (primary name)", g - gasleft());
        assertEq(rr.nameForAddr(alice), name);
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

    function _registry() internal pure override returns (address) {
        return Addr.BASENAMES_REGISTRY_BASE_SEPOLIA;
    }

    function _l2Reverse() internal pure override returns (address) {
        return Addr.BASENAMES_L2_REVERSE_REGISTRAR_BASE_SEPOLIA;
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

    function _registry() internal pure override returns (address) {
        return Addr.BASENAMES_REGISTRY_BASE;
    }

    function _l2Reverse() internal pure override returns (address) {
        return Addr.BASENAMES_L2_REVERSE_REGISTRAR_BASE;
    }

    /// Names registered before the upgrade keep the legacy L2Resolver; their owner can still edit records there.
    function test_owner_edits_texts_on_legacy_resolver() public {
        address jesse = 0x2211d1D0020DAEA8039E46Cf1367962070d77DA9;
        bytes32 node = keccak256(abi.encodePacked(IBnRegistrar(_registrar()).baseNode(), keccak256("jesse")));
        assertEq(IBnRegistry(_registry()).resolver(node), Addr.BASENAMES_L2_RESOLVER_BASE);
        bytes[] memory data = new bytes[](1);
        data[0] = abi.encodeCall(IBnResolver.setText, (node, "memba.profile.v1", '{"version":1}'));
        vm.prank(jesse);
        IBnResolver(Addr.BASENAMES_L2_RESOLVER_BASE).multicall(data);
        assertEq(IBnResolver(Addr.BASENAMES_L2_RESOLVER_BASE).text(node, "memba.profile.v1"), '{"version":1}');
    }

    /// The read path of the Profile app (frontend lib/chain/evm/basenames.ts) on a long-standing primary name:
    /// the ENSIP-19 reverse registrar and the legacy reverse node (`<addr>.80002105.reverse`) both name it, and
    /// the forward record resolves back to the address (the check that makes a primary name trustworthy).
    function test_primary_name_read_path() public view {
        address jesse = 0x2211d1D0020DAEA8039E46Cf1367962070d77DA9;
        assertEq(IBnL2ReverseRegistrar(Addr.BASENAMES_L2_REVERSE_REGISTRAR_BASE).nameForAddr(jesse), "jesse.base.eth");

        bytes32 reverseNode = keccak256(
            abi.encodePacked(
                keccak256(
                    abi.encodePacked(
                        keccak256(abi.encodePacked(bytes32(0), keccak256("reverse"))), keccak256("80002105")
                    )
                ),
                keccak256(bytes(_hexLower(jesse)))
            )
        );
        address reverseResolver = IBnRegistry(Addr.BASENAMES_REGISTRY_BASE).resolver(reverseNode);
        assertEq(reverseResolver, Addr.BASENAMES_L2_RESOLVER_BASE);
        assertEq(IBnResolver(reverseResolver).name(reverseNode), "jesse.base.eth");

        bytes32 node = keccak256(abi.encodePacked(IBnRegistrar(_registrar()).baseNode(), keccak256("jesse")));
        address resolver = IBnRegistry(Addr.BASENAMES_REGISTRY_BASE).resolver(node);
        assertEq(IBnResolver(resolver).addr(node), jesse);
    }

    function _hexLower(address a) internal pure returns (string memory) {
        bytes memory out = new bytes(40);
        bytes16 digits = "0123456789abcdef";
        for (uint256 i; i < 20; i++) {
            uint8 b = uint8(uint160(a) >> (8 * (19 - i)));
            out[2 * i] = digits[b >> 4];
            out[2 * i + 1] = digits[b & 0x0f];
        }
        return string(out);
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
