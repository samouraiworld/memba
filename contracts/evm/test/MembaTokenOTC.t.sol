// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { MembaTokenOTC } from "../src/commerce/MembaTokenOTC.sol";
import { MembaToken } from "../src/commerce/MembaToken.sol";

contract MembaTokenOTCTest is Test {
    MembaTokenOTC public otc;
    MembaToken public token;

    address public adminAddr = makeAddr("admin");
    address public feeWallet = makeAddr("feeWallet");
    address public seller = makeAddr("seller");
    address public buyer = makeAddr("buyer");
    address public outsider = makeAddr("outsider");

    uint256 public constant UNIT_PRICE = 0.01 ether; // 0.01 ETH per token unit

    function setUp() public {
        // Deploy OTC
        MembaTokenOTC impl = new MembaTokenOTC();
        bytes memory initData = abi.encodeCall(MembaTokenOTC.initialize, (adminAddr, feeWallet, 100)); // 1% fee
        address proxy = address(new ERC1967Proxy(address(impl), initData));
        otc = MembaTokenOTC(proxy);

        // Deploy test token
        token = new MembaToken("Test Token", "TST", 0, 1_000_000, seller);

        vm.deal(buyer, 100 ether);
        vm.deal(outsider, 10 ether);
    }

    function _createListing(uint256 amount) internal returns (uint256) {
        vm.startPrank(seller);
        token.approve(address(otc), amount);
        uint256 id = otc.list(address(token), amount, UNIT_PRICE);
        vm.stopPrank();
        return id;
    }

    // ══════════════════════════════════════════════════════════════
    // 1. Listing
    // ══════════════════════════════════════════════════════════════

    function test_List_Success() public {
        uint256 id = _createListing(1000);
        assertEq(id, 0);
        assertEq(otc.listingCount(), 1);

        MembaTokenOTC.OTCListing memory listing = otc.getListing(0);
        assertEq(listing.seller, seller);
        assertEq(listing.totalAmount, 1000);
        assertEq(listing.unitPrice, UNIT_PRICE);
        assertTrue(listing.active);

        // Tokens transferred to contract
        assertEq(token.balanceOf(address(otc)), 1000);
    }

    // ══════════════════════════════════════════════════════════════
    // 2. Filling
    // ══════════════════════════════════════════════════════════════

    function test_Fill_Full() public {
        _createListing(100);

        uint256 totalCost = 100 * UNIT_PRICE ; // 100 * 0.01 = 1 ETH
        uint256 sellerBefore = seller.balance;

        vm.prank(buyer);
        otc.fill{value: totalCost}(0, 100);

        // Buyer got tokens
        assertEq(token.balanceOf(buyer), 100);

        // Seller got ETH minus 1% fee
        uint256 fee = totalCost / 100; // 1%
        assertEq(seller.balance, sellerBefore + totalCost - fee);

        // Fee wallet got fee
        assertEq(feeWallet.balance, fee);

        // Listing deactivated
        assertFalse(otc.getListing(0).active);
    }

    function test_Fill_Partial() public {
        _createListing(100);

        uint256 cost = 50 * UNIT_PRICE ; // 50 * 0.01 = 0.5 ETH

        vm.prank(buyer);
        otc.fill{value: cost}(0, 50);

        assertEq(token.balanceOf(buyer), 50);

        MembaTokenOTC.OTCListing memory listing = otc.getListing(0);
        assertEq(listing.filledAmount, 50);
        assertTrue(listing.active); // still open
    }

    function test_Fill_InsufficientPaymentReverts() public {
        _createListing(100);

        vm.prank(buyer);
        vm.expectRevert(MembaTokenOTC.InsufficientPayment.selector);
        otc.fill{value: 0.001 ether}(0, 100); // too little
    }

    function test_Fill_ExceedsAvailableReverts() public {
        _createListing(100);

        uint256 cost = 200 * UNIT_PRICE;
        vm.prank(buyer);
        vm.expectRevert(MembaTokenOTC.ExceedsAvailable.selector);
        otc.fill{value: cost}(0, 200);
    }

    // ══════════════════════════════════════════════════════════════
    // 3. Cancel
    // ══════════════════════════════════════════════════════════════

    function test_Cancel_ReturnsTokens() public {
        _createListing(100);

        uint256 sellerBefore = token.balanceOf(seller);

        vm.prank(seller);
        otc.cancel(0);

        // Seller gets all tokens back
        assertEq(token.balanceOf(seller), sellerBefore + 100);
        assertFalse(otc.getListing(0).active);
    }

    function test_Cancel_AfterPartialFill() public {
        _createListing(100);

        // Partial fill of 30
        uint256 cost = 30 * UNIT_PRICE;
        vm.prank(buyer);
        otc.fill{value: cost}(0, 30);

        uint256 sellerBefore = token.balanceOf(seller);

        vm.prank(seller);
        otc.cancel(0);

        // Seller gets remaining 70 back
        assertEq(token.balanceOf(seller), sellerBefore + 70);
    }

    function test_Cancel_NonSellerReverts() public {
        _createListing(100);

        vm.prank(outsider);
        vm.expectRevert(MembaTokenOTC.NotSeller.selector);
        otc.cancel(0);
    }

    // ══════════════════════════════════════════════════════════════
    // 4. Fee Calculation
    // ══════════════════════════════════════════════════════════════

    function test_Fee_ExactCalculation() public {
        _createListing(100);

        uint256 totalCost = 100 * UNIT_PRICE ; // 1 ETH
        uint256 expectedFee = totalCost / 100; // 1% = 0.01 ETH

        vm.prank(buyer);
        otc.fill{value: totalCost}(0, 100);

        assertEq(feeWallet.balance, expectedFee);
        assertEq(expectedFee, 0.01 ether);
    }
}
