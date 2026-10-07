// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {Addr} from "./Addresses.sol";
import {ISafe, ISafeProxyFactory, Operation} from "./Interfaces.sol";

/// Shared fork setup and Safe helpers. Each concrete suite picks a chain alias from foundry.toml.
/// Gas figures are measured in-EVM with gasleft(): they exclude the 21,000 intrinsic gas, calldata
/// gas and Base's L1 data fee, so a wallet quote is higher. Read them as relative costs.
abstract contract ForkBase is Test {
    // Test keys only: they exist in this file and nowhere else.
    uint256 internal constant PK_A = 0xA11CE;
    uint256 internal constant PK_B = 0xB0B;
    uint256 internal constant PK_C = 0xCA401;
    uint256 internal constant PK_D = 0xD0D0;

    address internal alice;
    address internal bob;
    address internal carol;
    address internal dave;

    function _chain() internal pure virtual returns (string memory);

    function _forkBlock() internal pure virtual returns (uint256) {
        return 0;
    }

    function _isBaseMainnet() internal view returns (bool) {
        return block.chainid == 8453;
    }

    function setUp() public virtual {
        uint256 b = _forkBlock();
        if (b == 0) vm.createSelectFork(_chain());
        else vm.createSelectFork(_chain(), b);
        alice = vm.addr(PK_A);
        bob = vm.addr(PK_B);
        carol = vm.addr(PK_C);
        dave = vm.addr(PK_D);
        vm.label(alice, "alice");
        vm.label(bob, "bob");
        vm.label(carol, "carol");
        vm.label(dave, "dave");
    }

    function _gas(string memory label, uint256 used) internal pure {
        console2.log(string.concat("GAS | ", _chain(), " | ", label, " | ", vm.toString(used)));
    }

    // ── Safe helpers ──────────────────────────────────────────────────────

    function _deploySafe(address[] memory owners, uint256 threshold, uint256 salt) internal returns (ISafe safe) {
        bytes memory init = abi.encodeCall(
            ISafe.setup,
            (owners, threshold, address(0), "", Addr.SAFE_FALLBACK_HANDLER, address(0), 0, payable(address(0)))
        );
        uint256 g = gasleft();
        safe = ISafe(ISafeProxyFactory(Addr.SAFE_PROXY_FACTORY).createProxyWithNonce(Addr.SAFE_L2, init, salt));
        _gas(
            string.concat("Safe ", vm.toString(threshold), "-of-", vm.toString(owners.length), " deploy"), g - gasleft()
        );
    }

    function _owners3() internal view returns (address[] memory o) {
        o = new address[](3);
        o[0] = alice;
        o[1] = bob;
        o[2] = carol;
    }

    /// Signs a Safe tx hash with the given keys, sorted by signer address as the Safe requires.
    function _sign(bytes32 h, uint256[] memory pks) internal pure returns (bytes memory sigs) {
        uint256 n = pks.length;
        for (uint256 i; i < n; i++) {
            for (uint256 j = i + 1; j < n; j++) {
                if (vm.addr(pks[j]) < vm.addr(pks[i])) (pks[i], pks[j]) = (pks[j], pks[i]);
            }
        }
        for (uint256 i; i < n; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pks[i], h);
            sigs = bytes.concat(sigs, abi.encodePacked(r, s, v));
        }
    }

    function _two() internal pure returns (uint256[] memory k) {
        k = new uint256[](2);
        k[0] = PK_A;
        k[1] = PK_B;
    }

    /// Executes a Safe transaction signed by `pks`, submitted by `relayer`. Returns the gas used.
    function _execSafe(ISafe safe, address to, uint256 value, bytes memory data, Operation op, uint256[] memory pks)
        internal
        returns (uint256 used)
    {
        bytes32 h = safe.getTransactionHash(to, value, data, op, 0, 0, 0, address(0), address(0), safe.nonce());
        bytes memory sigs = _sign(h, pks);
        vm.prank(address(0xBEEF)); // anyone may relay a fully signed Safe tx
        uint256 g = gasleft();
        bool ok = safe.execTransaction(to, value, data, op, 0, 0, 0, address(0), payable(address(0)), sigs);
        used = g - gasleft();
        require(ok, "safe tx failed");
    }
}
