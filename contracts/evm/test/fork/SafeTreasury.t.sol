// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkBase} from "./ForkBase.sol";
import {Addr} from "./Addresses.sol";
import {
    ISafe,
    ISafeMessages,
    Operation,
    IModuleProxyFactory,
    IRoles,
    ConditionFlat,
    RolesParameterType,
    RolesExecutionOptions,
    IAllowanceModule,
    IERC20Min
} from "./Interfaces.sol";
import {MembaToken} from "../../src/MembaToken.sol";

/// Tasks 2a + 2b: a 2-of-3 Safe, a 2-signature Safe tx, EIP-1271 through the fallback handler,
/// and a monthly spending allowance with Zodiac Roles v2 and with Safe AllowanceModule v1.0.0.
abstract contract SafeTreasuryTest is ForkBase {
    ISafe internal safe;
    MembaToken internal token;

    function setUp() public override {
        super.setUp();
        safe = _deploySafe(_owners3(), 2, uint256(keccak256("memba.phase0.safe")));
        vm.deal(address(safe), 10 ether);
        token = new MembaToken("MembaToken", "MBT", address(safe), 1_000_000 ether, makeAddr("fee"), 0);
    }

    // 2a ─────────────────────────────────────────────────────────────────

    function test_safe_2of3_exec() public {
        assertEq(safe.getThreshold(), 2);
        assertEq(safe.getOwners().length, 3);
        assertEq(safe.VERSION(), "1.5.0");

        address payee = makeAddr("payee");
        uint256 used = _execSafe(safe, payee, 1 ether, "", Operation.Call, _two());
        _gas("Safe execTransaction (2 sigs, ETH transfer)", used);
        assertEq(payee.balance, 1 ether);

        // One signature is not enough (GS020: signatures too short).
        bytes32 h = safe.getTransactionHash(payee, 1, "", Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce());
        uint256[] memory one = new uint256[](1);
        one[0] = PK_A;
        bytes memory sig = _sign(h, one);
        vm.expectRevert(bytes("GS020"));
        safe.execTransaction(payee, 1, "", Operation.Call, 0, 0, 0, address(0), payable(address(0)), sig);
    }

    /// EIP-1271 for SIWE: a Safe "signs" when 2 owners sign the SafeMessage hash.
    function test_safe_eip1271_message() public {
        bytes memory message = bytes("memba.example wants you to sign in with your Ethereum account");
        bytes32 dataHash = keccak256(message);
        bytes32 safeMsgHash = ISafeMessages(address(safe)).getMessageHashForSafe(address(safe), abi.encode(dataHash));
        bytes memory sigs = _sign(safeMsgHash, _two());
        bytes4 magic = ISafeMessages(address(safe)).isValidSignature(dataHash, sigs);
        assertEq(magic, bytes4(0x1626ba7e));

        // The same signatures do not validate a different message (no cross-message replay).
        vm.expectRevert();
        ISafeMessages(address(safe)).isValidSignature(keccak256("other"), sigs);

        // A counterfactual (not yet deployed) Safe has no code: plain EIP-1271 cannot validate it.
        address counterfactual = makeAddr("undeployed-safe");
        assertEq(counterfactual.code.length, 0);
    }

    // 2b — Zodiac Roles v2 ──────────────────────────────────────────────

    bytes32 internal constant ROLE_KEY = keccak256("memba.budget.spender");
    bytes32 internal constant ALLOWANCE_KEY = keccak256("memba.budget.monthly");

    function _setupRoles(address spender, uint128 monthly) internal returns (IRoles roles) {
        // Deploy a Roles proxy (owner = avatar = target = Safe) through the ModuleProxyFactory.
        bytes memory init = abi.encodeCall(IRoles.setUp, (abi.encode(address(safe), address(safe), address(safe))));
        uint256 g = gasleft();
        roles = IRoles(
            IModuleProxyFactory(Addr.MODULE_PROXY_FACTORY).deployModule(Addr.ROLES_V2_MASTERCOPY, init, block.timestamp)
        );
        _gas("Roles v2 proxy deploy", g - gasleft());

        // One Safe tx enables the module; four more configure the role (each a 2-of-3 Safe tx).
        _gas(
            "Safe tx: enableModule(Roles)",
            _execSafe(
                safe, address(safe), 0, abi.encodeCall(ISafe.enableModule, (address(roles))), Operation.Call, _two()
            )
        );
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = ROLE_KEY;
        bool[] memory member = new bool[](1);
        member[0] = true;
        uint256 cfg = _execSafe(
            safe, address(roles), 0, abi.encodeCall(IRoles.assignRoles, (spender, keys, member)), Operation.Call, _two()
        );
        cfg += _execSafe(
            safe,
            address(roles),
            0,
            abi.encodeCall(IRoles.scopeTarget, (ROLE_KEY, address(token))),
            Operation.Call,
            _two()
        );
        cfg += _scopeTransfer(roles);
        cfg += _execSafe(
            safe,
            address(roles),
            0,
            abi.encodeCall(IRoles.setAllowance, (ALLOWANCE_KEY, monthly, monthly, monthly, 30 days, 0)),
            Operation.Call,
            _two()
        );
        _gas("Roles config: assignRoles+scopeTarget+scopeFunction+setAllowance (4 Safe txs)", cfg);
    }

    function _scopeTransfer(IRoles roles) internal returns (uint256) {
        ConditionFlat[] memory c = new ConditionFlat[](3);
        c[0] = ConditionFlat(0, RolesParameterType.Calldata, 5, ""); // Matches
        c[1] = ConditionFlat(0, RolesParameterType.Static, 0, ""); // to: Pass
        c[2] = ConditionFlat(0, RolesParameterType.Static, 28, abi.encode(ALLOWANCE_KEY)); // amount: WithinAllowance
        return _execSafe(
            safe,
            address(roles),
            0,
            abi.encodeCall(
                IRoles.scopeFunction,
                (ROLE_KEY, address(token), IERC20Min.transfer.selector, c, RolesExecutionOptions.None)
            ),
            Operation.Call,
            _two()
        );
    }

    function test_roles_monthly_allowance() public {
        address spender = dave;
        bytes32 roleKey = ROLE_KEY;
        IRoles roles = _setupRoles(spender, 1_000 ether);
        uint256 g;

        address vendor = makeAddr("vendor");
        // Spend within the allowance.
        vm.prank(spender);
        g = gasleft();
        roles.execTransactionWithRole(
            address(token), 0, abi.encodeCall(IERC20Min.transfer, (vendor, 600 ether)), Operation.Call, roleKey, true
        );
        _gas("Roles execTransactionWithRole (ERC-20 transfer within allowance)", g - gasleft());
        assertEq(token.balanceOf(vendor), 600 ether);

        // Above the remaining 400 fails.
        vm.prank(spender);
        vm.expectRevert();
        roles.execTransactionWithRole(
            address(token), 0, abi.encodeCall(IERC20Min.transfer, (vendor, 401 ether)), Operation.Call, roleKey, true
        );
        // ...while exactly the remaining 400 passes: the refusal above was the allowance.
        vm.prank(spender);
        roles.execTransactionWithRole(
            address(token), 0, abi.encodeCall(IERC20Min.transfer, (vendor, 400 ether)), Operation.Call, roleKey, true
        );

        // A different selector (approve) is not scoped: refused.
        vm.prank(spender);
        vm.expectRevert();
        roles.execTransactionWithRole(
            address(token),
            0,
            abi.encodeWithSignature("approve(address,uint256)", vendor, 1),
            Operation.Call,
            roleKey,
            true
        );

        // After one period the allowance refills to the monthly amount (not accumulating past maxRefill).
        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(spender);
        roles.execTransactionWithRole(
            address(token), 0, abi.encodeCall(IERC20Min.transfer, (vendor, 1_000 ether)), Operation.Call, roleKey, true
        );
        assertEq(token.balanceOf(vendor), 2_000 ether);
    }

    // 2b — Safe AllowanceModule v1.0.0 ─────────────────────────────────

    function test_allowanceModule_v1_monthly() public {
        IAllowanceModule am = IAllowanceModule(Addr.ALLOWANCE_MODULE_V1_0_0);
        address delegate = dave;
        _execSafe(safe, address(safe), 0, abi.encodeCall(ISafe.enableModule, (address(am))), Operation.Call, _two());
        uint256 cfg = _execSafe(
            safe, address(am), 0, abi.encodeCall(IAllowanceModule.addDelegate, (delegate)), Operation.Call, _two()
        );
        // resetTimeMin is uint16 minutes: 30 days = 43,200 min fits (max ~45.5 days). A calendar month does not exist.
        cfg += _execSafe(
            safe,
            address(am),
            0,
            abi.encodeCall(
                IAllowanceModule.setAllowance,
                (delegate, address(token), uint96(1_000 ether), uint16(43_200), uint32(0))
            ),
            Operation.Call,
            _two()
        );
        _gas("AllowanceModule config: addDelegate+setAllowance (2 Safe txs)", cfg);

        address payable vendor = payable(makeAddr("vendor"));
        vm.prank(delegate);
        uint256 g = gasleft();
        am.executeAllowanceTransfer(address(safe), address(token), vendor, 600 ether, address(0), 0, delegate, "");
        _gas("AllowanceModule executeAllowanceTransfer (ERC-20)", g - gasleft());
        assertEq(token.balanceOf(vendor), 600 ether);

        vm.prank(delegate);
        vm.expectRevert(bytes("newSpent > allowance.spent && newSpent <= allowance.amount"));
        am.executeAllowanceTransfer(address(safe), address(token), vendor, 401 ether, address(0), 0, delegate, "");
        vm.prank(delegate);
        am.executeAllowanceTransfer(address(safe), address(token), vendor, 400 ether, address(0), 0, delegate, "");

        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(delegate);
        am.executeAllowanceTransfer(address(safe), address(token), vendor, 1_000 ether, address(0), 0, delegate, "");
        assertEq(token.balanceOf(vendor), 2_000 ether);
    }
}

contract SafeTreasuryBaseSepoliaTest is SafeTreasuryTest {
    function _chain() internal pure override returns (string memory) {
        return "base_sepolia";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_SEPOLIA_FORK_BLOCK;
    }
}

contract SafeTreasuryBaseTest is SafeTreasuryTest {
    function _chain() internal pure override returns (string memory) {
        return "base";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_FORK_BLOCK;
    }
}
