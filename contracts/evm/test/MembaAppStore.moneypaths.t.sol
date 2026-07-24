// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaAppStore } from "../src/social/MembaAppStore.sol";
import { NoReceive, RevertingReceiver } from "./mocks/Receivers.sol";

/// @title MembaAppStore — money-path exploit (A-10)
/// @notice `registerApp` forwarded the ENTIRE `msg.value` to the fee recipient after only
///         checking `msg.value >= creationFee`, confiscating any overpayment. MembaAppStore
///         had no test file at all, which is why this went unseen.
contract MembaAppStoreMoneyPathsTest is Test {
    MembaAppStore public store;

    address public adminAddr = makeAddr("admin");
    address public feeWallet = makeAddr("feeWallet");
    address public publisher = makeAddr("publisher");

    uint256 public constant CREATION_FEE = 0.01 ether;

    function setUp() public {
        MembaAppStore impl = new MembaAppStore();
        bytes memory initData = abi.encodeCall(MembaAppStore.initialize, (adminAddr, feeWallet, CREATION_FEE));
        store = MembaAppStore(address(new ERC1967Proxy(address(impl), initData)));
        vm.deal(publisher, 10 ether);
    }

    function _register(uint256 value) internal {
        vm.prank(publisher);
        store.registerApp{ value: value }("gno.land/r/app", "App", "tag", "cat", "icon", "https://app");
    }

    function test_A10_OverpaymentRefunded() public {
        uint256 overpay = 0.25 ether;
        uint256 pubBefore = publisher.balance;

        _register(CREATION_FEE + overpay);

        assertEq(feeWallet.balance, CREATION_FEE, "fee recipient over-collected");
        assertEq(pubBefore - publisher.balance, CREATION_FEE, "overpayment was confiscated");
    }

    function test_A10_ExactPaymentLeavesNoRefund() public {
        _register(CREATION_FEE);
        assertEq(feeWallet.balance, CREATION_FEE);
        assertEq(address(store).balance, 0, "app store must not retain ETH");
    }

    function test_A10_InsufficientFeeReverts() public {
        vm.prank(publisher);
        vm.expectRevert(MembaAppStore.InsufficientFee.selector);
        store.registerApp{ value: CREATION_FEE - 1 }("gno.land/r/app", "App", "tag", "cat", "icon", "https://app");
    }

    function test_A10_FeeRecipientRejectionReverts() public {
        NoReceive badRecipient = new NoReceive();
        MembaAppStore impl = new MembaAppStore();
        bytes memory initData =
            abi.encodeCall(MembaAppStore.initialize, (adminAddr, address(badRecipient), CREATION_FEE));
        MembaAppStore badStore = MembaAppStore(address(new ERC1967Proxy(address(impl), initData)));

        vm.deal(publisher, 10 ether);
        vm.prank(publisher);
        vm.expectRevert(MembaAppStore.TransferFailed.selector);
        badStore.registerApp{ value: CREATION_FEE }("gno.land/r/app", "App", "tag", "cat", "icon", "https://app");
    }

    function test_A10_RefundToRejectingCallerReverts() public {
        RevertingReceiver caller = new RevertingReceiver();
        vm.deal(address(caller), 10 ether);
        caller.setRejecting(true); // rejects the overpayment refund

        bytes memory cd =
            abi.encodeCall(MembaAppStore.registerApp, ("gno.land/r/app", "App", "tag", "cat", "icon", "https://app"));
        vm.expectRevert(MembaAppStore.TransferFailed.selector);
        caller.call{ value: CREATION_FEE + 0.25 ether }(address(store), cd);
    }
}
