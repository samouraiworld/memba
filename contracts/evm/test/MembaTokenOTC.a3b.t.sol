// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { MembaTokenOTC } from "../src/commerce/MembaTokenOTC.sol";
import { MembaToken } from "../src/commerce/MembaToken.sol";
import { RevertingReceiver, NoReceive } from "./mocks/Receivers.sol";

/// @title MembaTokenOTC — pull-payment escape hatch (A-3b)
/// @notice `fill` reverted the whole call if the seller or fee recipient rejected ETH — a
///         seller could veto its own listing (locking the buyer's tokens) and a reverting
///         shared fee recipient bricked every fill at once, with no `setFeeRecipient` to
///         recover. Ported from MembaEscrow's ISSUE-005 fix: credit failed pushes, let the
///         recipient `withdraw()` later.
contract MembaTokenOTCA3bTest is Test {
    MembaTokenOTC public otc;

    address public adminAddr = makeAddr("admin");
    address public feeWallet = makeAddr("feeWallet");
    address public buyer = makeAddr("buyer");
    address public outsider = makeAddr("outsider");

    uint256 public constant PRICE = 0.01 ether; // per whole token; token has decimals 0

    function setUp() public {
        MembaTokenOTC impl = new MembaTokenOTC();
        bytes memory initData = abi.encodeCall(MembaTokenOTC.initialize, (adminAddr, feeWallet, 100)); // 1% fee
        otc = MembaTokenOTC(address(new ERC1967Proxy(address(impl), initData)));
        vm.deal(buyer, 1000 ether);
    }

    /// @dev Deploy a 0-decimal token owned by `owner`, and list `amount` from it via `owner`'s
    ///      call-forwarder. Returns the listing id.
    function _listFromContract(RevertingReceiver owner, uint256 amount) internal returns (MembaToken tok, uint256 id) {
        tok = new MembaToken("Test", "TST", 0, 1_000_000, address(owner));
        owner.call(address(tok), abi.encodeCall(IERC20.approve, (address(otc), amount)));
        bytes memory ret = owner.call(address(otc), abi.encodeCall(MembaTokenOTC.list, (address(tok), amount, PRICE)));
        id = abi.decode(ret, (uint256));
    }

    // ── Seller leg (core A-3b)
    // ──────────────────────────────────────

    function test_A3b_RejectingSellerCannotBrickFill() public {
        RevertingReceiver seller = new RevertingReceiver();
        (MembaToken tok, uint256 id) = _listFromContract(seller, 100);
        seller.setRejecting(true); // seller contract refuses ETH

        uint256 cost = 100 * PRICE; // 1 ETH
        vm.prank(buyer);
        otc.fill{ value: cost }(id, 100); // must NOT revert

        assertEq(tok.balanceOf(buyer), 100, "buyer received tokens");
        uint256 fee = cost / 100;
        assertEq(otc.withdrawable(address(seller)), cost - fee, "seller proceeds credited, not lost");
    }

    function test_A3b_NoReceiveSellerIsCreditedNotReverted() public {
        // A seller with no receive()/fallback can never accept ETH; the fill still settles.
        NoReceive sellerNo = new NoReceive();
        MembaToken tok = new MembaToken("Test", "TST", 0, 1_000_000, address(sellerNo));
        sellerNo.call(address(tok), abi.encodeCall(IERC20.approve, (address(otc), 100)));
        bytes memory ret = sellerNo.call(address(otc), abi.encodeCall(MembaTokenOTC.list, (address(tok), 100, PRICE)));
        uint256 id = abi.decode(ret, (uint256));

        uint256 cost = 100 * PRICE;
        vm.prank(buyer);
        otc.fill{ value: cost }(id, 100);

        assertEq(tok.balanceOf(buyer), 100);
        assertEq(otc.withdrawable(address(sellerNo)), cost - cost / 100);
    }

    function test_A3b_CreditedSellerCanWithdraw() public {
        RevertingReceiver seller = new RevertingReceiver();
        (, uint256 id) = _listFromContract(seller, 100);
        seller.setRejecting(true);

        uint256 cost = 100 * PRICE;
        vm.prank(buyer);
        otc.fill{ value: cost }(id, 100);

        uint256 credited = otc.withdrawable(address(seller));
        seller.setRejecting(false); // now able to receive

        uint256 otcBefore = address(otc).balance;
        seller.call(address(otc), abi.encodeCall(MembaTokenOTC.withdraw, ()));

        assertEq(address(seller).balance, credited, "seller pulled its proceeds");
        assertEq(address(otc).balance, otcBefore - credited);
        assertEq(otc.withdrawable(address(seller)), 0);

        // A second withdraw reverts — nothing left.
        vm.expectRevert(MembaTokenOTC.NothingToWithdraw.selector);
        seller.call(address(otc), abi.encodeCall(MembaTokenOTC.withdraw, ()));
    }

    // ── Fee leg (protocol-wide DoS + recovery) ──────────────────────

    function test_A3b_RevertingFeeRecipientDoesNotBrickFills() public {
        RevertingReceiver badFee = new RevertingReceiver();
        badFee.setRejecting(true);
        vm.prank(adminAddr);
        otc.setFeeRecipient(address(badFee));

        // Ordinary EOA seller.
        MembaToken tok = new MembaToken("Test", "TST", 0, 1_000_000, outsider);
        vm.startPrank(outsider);
        tok.approve(address(otc), 100);
        uint256 id = otc.list(address(tok), 100, PRICE);
        vm.stopPrank();

        uint256 cost = 100 * PRICE;
        uint256 sellerBefore = outsider.balance;
        vm.prank(buyer);
        otc.fill{ value: cost }(id, 100); // must NOT revert

        uint256 fee = cost / 100;
        assertEq(outsider.balance, sellerBefore + (cost - fee), "seller paid directly");
        assertEq(otc.withdrawable(address(badFee)), fee, "fee credited to the bad recipient");
    }

    function test_A3b_SetFeeRecipientRepointsAndRecovers() public {
        address goodWallet = makeAddr("goodWallet");
        vm.prank(adminAddr);
        otc.setFeeRecipient(goodWallet);

        MembaToken tok = new MembaToken("Test", "TST", 0, 1_000_000, outsider);
        vm.startPrank(outsider);
        tok.approve(address(otc), 100);
        uint256 id = otc.list(address(tok), 100, PRICE);
        vm.stopPrank();

        uint256 cost = 100 * PRICE;
        vm.prank(buyer);
        otc.fill{ value: cost }(id, 100);

        assertEq(goodWallet.balance, cost / 100, "fee paid directly to the new recipient");
    }

    function test_A3b_SetFeeRecipientRejectsZero() public {
        vm.prank(adminAddr);
        vm.expectRevert(MembaTokenOTC.InvalidParams.selector);
        otc.setFeeRecipient(address(0));
    }

    function test_A3b_SetFeeRecipientOnlyAdmin() public {
        vm.prank(outsider);
        vm.expectRevert(MembaTokenOTC.NotAdmin.selector);
        otc.setFeeRecipient(outsider);
    }

    // ── Buyer-refund leg
    // ────────────────────────────────────────────

    function test_A3b_OverpayingBuyerContractGetsCreditedRefund() public {
        MembaToken tok = new MembaToken("Test", "TST", 0, 1_000_000, outsider);
        vm.startPrank(outsider);
        tok.approve(address(otc), 100);
        uint256 id = otc.list(address(tok), 100, PRICE);
        vm.stopPrank();

        RevertingReceiver buyerC = new RevertingReceiver();
        vm.deal(address(buyerC), 10 ether);
        buyerC.setRejecting(true); // refuses the change

        uint256 cost = 100 * PRICE;
        buyerC.call{ value: cost + 0.5 ether }(address(otc), abi.encodeCall(MembaTokenOTC.fill, (id, 100)));

        assertEq(tok.balanceOf(address(buyerC)), 100, "buyer contract got the tokens");
        assertEq(otc.withdrawable(address(buyerC)), 0.5 ether, "excess refund credited, not lost");
    }

    function test_A3b_ExactPaymentCreatesNoCredit() public {
        MembaToken tok = new MembaToken("Test", "TST", 0, 1_000_000, outsider);
        vm.startPrank(outsider);
        tok.approve(address(otc), 100);
        uint256 id = otc.list(address(tok), 100, PRICE);
        vm.stopPrank();

        uint256 cost = 100 * PRICE;
        vm.prank(buyer);
        otc.fill{ value: cost }(id, 100);

        assertEq(otc.withdrawable(buyer), 0, "exact payment leaves no credit");
    }

    // ── Withdraw semantics
    // ──────────────────────────────────────────

    function test_A3b_WithdrawRevertsWhenNothingCredited() public {
        vm.prank(outsider);
        vm.expectRevert(MembaTokenOTC.NothingToWithdraw.selector);
        otc.withdraw();
    }

    // ── Solvency invariant
    // ──────────────────────────────────────────

    /// @notice One fill where seller, fee recipient AND (overpaying) buyer all reject ETH:
    ///         every wei is credited, the contract holds exactly the sum, and all three can
    ///         later withdraw to zero.
    function test_A3b_SolvencyWhenAllLegsFail() public {
        RevertingReceiver seller = new RevertingReceiver();
        (, uint256 id) = _listFromContract(seller, 100);
        seller.setRejecting(true);

        RevertingReceiver badFee = new RevertingReceiver();
        badFee.setRejecting(true);
        vm.prank(adminAddr);
        otc.setFeeRecipient(address(badFee));

        RevertingReceiver buyerC = new RevertingReceiver();
        vm.deal(address(buyerC), 10 ether);
        buyerC.setRejecting(true);

        uint256 cost = 100 * PRICE; // 1 ETH
        uint256 paid = cost + 0.5 ether;
        buyerC.call{ value: paid }(address(otc), abi.encodeCall(MembaTokenOTC.fill, (id, 100)));

        uint256 fee = cost / 100;
        uint256 sellerProceeds = cost - fee;
        assertEq(address(otc).balance, paid, "contract holds exactly what was paid");
        assertEq(
            otc.withdrawable(address(seller)) + otc.withdrawable(address(badFee)) + otc.withdrawable(address(buyerC)),
            paid,
            "credits sum to msg.value (no strand, no double-pay)"
        );
        assertEq(otc.withdrawable(address(seller)), sellerProceeds);
        assertEq(otc.withdrawable(address(badFee)), fee);
        assertEq(otc.withdrawable(address(buyerC)), 0.5 ether);

        // All three can drain to zero.
        seller.setRejecting(false);
        badFee.setRejecting(false);
        buyerC.setRejecting(false);
        seller.call(address(otc), abi.encodeCall(MembaTokenOTC.withdraw, ()));
        badFee.call(address(otc), abi.encodeCall(MembaTokenOTC.withdraw, ()));
        buyerC.call(address(otc), abi.encodeCall(MembaTokenOTC.withdraw, ()));
        assertEq(address(otc).balance, 0, "contract fully drained");
    }

    // ── Happy path unchanged
    // ────────────────────────────────────────

    function test_A3b_HappyPathEoaStillPushesDirectlyNoCredits() public {
        MembaToken tok = new MembaToken("Test", "TST", 0, 1_000_000, outsider);
        vm.startPrank(outsider);
        tok.approve(address(otc), 100);
        uint256 id = otc.list(address(tok), 100, PRICE);
        vm.stopPrank();

        uint256 cost = 100 * PRICE;
        uint256 fee = cost / 100;
        vm.prank(buyer);
        otc.fill{ value: cost }(id, 100);

        assertEq(outsider.balance, cost - fee, "seller paid directly");
        assertEq(feeWallet.balance, fee, "fee paid directly");
        assertEq(otc.withdrawable(outsider), 0);
        assertEq(otc.withdrawable(feeWallet), 0);
        assertEq(address(otc).balance, 0, "no ETH retained on the happy path");
    }
}
