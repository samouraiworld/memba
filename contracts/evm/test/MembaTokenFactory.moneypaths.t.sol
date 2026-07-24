// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaTokenFactory } from "../src/commerce/MembaTokenFactory.sol";
import { NoReceive, RevertingReceiver } from "./mocks/Receivers.sol";

/// @title MembaTokenFactory — money-path exploit (A-10)
/// @notice `createToken` forwarded the ENTIRE `msg.value` to the fee recipient after only
///         checking `msg.value >= creationFee`, so any overpayment was confiscated. The fix
///         mirrors MembaCollections._settle: pay the fee, refund the excess.
contract MembaTokenFactoryMoneyPathsTest is Test {
    MembaTokenFactory public factory;

    address public adminAddr = makeAddr("admin");
    address public feeWallet = makeAddr("feeWallet");
    address public alice = makeAddr("alice");

    uint256 public constant CREATION_FEE = 0.001 ether;

    function setUp() public {
        MembaTokenFactory impl = new MembaTokenFactory();
        bytes memory initData = abi.encodeCall(MembaTokenFactory.initialize, (adminAddr, feeWallet, CREATION_FEE));
        factory = MembaTokenFactory(address(new ERC1967Proxy(address(impl), initData)));
        vm.deal(alice, 10 ether);
    }

    function test_A10_OverpaymentRefunded() public {
        uint256 overpay = 0.5 ether;
        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        factory.createToken{ value: CREATION_FEE + overpay }("Tok", "TOK", 18, 1000e18, bytes32(uint256(1)));

        // Fee recipient gets exactly the fee; alice keeps the overpayment.
        assertEq(feeWallet.balance, CREATION_FEE, "fee recipient over-collected");
        assertEq(aliceBefore - alice.balance, CREATION_FEE, "overpayment was confiscated");
    }

    function test_A10_ExactPaymentLeavesNoRefund() public {
        vm.prank(alice);
        factory.createToken{ value: CREATION_FEE }("Tok", "TOK", 18, 1000e18, bytes32(uint256(2)));
        assertEq(feeWallet.balance, CREATION_FEE);
        assertEq(address(factory).balance, 0, "factory must not retain ETH");
    }

    function test_A10_FeeRecipientRejectionReverts() public {
        NoReceive badRecipient = new NoReceive();
        vm.prank(adminAddr);
        factory.updateFeeRecipient(address(badRecipient));

        vm.prank(alice);
        vm.expectRevert(MembaTokenFactory.FeeTransferFailed.selector);
        factory.createToken{ value: CREATION_FEE }("Tok", "TOK", 18, 1000e18, bytes32(uint256(3)));
    }

    function test_A10_RefundToRejectingCallerReverts() public {
        RevertingReceiver caller = new RevertingReceiver();
        vm.deal(address(caller), 10 ether);
        caller.setRejecting(true); // rejects the overpayment refund

        bytes memory cd =
            abi.encodeCall(MembaTokenFactory.createToken, ("Tok", "TOK", 18, 1000e18, bytes32(uint256(4))));
        vm.expectRevert(MembaTokenFactory.FeeTransferFailed.selector);
        caller.call{ value: CREATION_FEE + 0.5 ether }(address(factory), cd);
    }
}
