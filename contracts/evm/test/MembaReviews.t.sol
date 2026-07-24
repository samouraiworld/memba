// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaReviews } from "../src/social/MembaReviews.sol";

contract MembaReviewsTest is Test {
    MembaReviews public reviews;
    address public adminAddr = makeAddr("admin");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    function setUp() public {
        MembaReviews impl = new MembaReviews();
        bytes memory initData = abi.encodeCall(MembaReviews.initialize, (adminAddr));
        address proxy = address(new ERC1967Proxy(address(impl), initData));
        reviews = MembaReviews(proxy);
    }

    function test_PostReview_Success() public {
        vm.prank(alice);
        uint256 id = reviews.postReview("validator-1", 5, "Great validator!");
        assertEq(id, 0);

        MembaReviews.Review memory r = reviews.getReview(0);
        assertEq(r.author, alice);
        assertEq(r.rating, 5);
        assertEq(r.body, "Great validator!");
        assertFalse(r.deleted);
    }

    function test_PostReview_InvalidRatingReverts() public {
        vm.prank(alice);
        vm.expectRevert(MembaReviews.InvalidRating.selector);
        reviews.postReview("subj", 0, "Bad rating");

        vm.prank(alice);
        vm.expectRevert(MembaReviews.InvalidRating.selector);
        reviews.postReview("subj", 6, "Too high");
    }

    function test_EditReview_Success() public {
        vm.prank(alice);
        reviews.postReview("subj", 3, "Original");

        vm.prank(alice);
        reviews.editReview(0, 4, "Updated");

        MembaReviews.Review memory r = reviews.getReview(0);
        assertEq(r.rating, 4);
        assertEq(r.body, "Updated");
        assertGt(r.editedAt, 0);
    }

    function test_EditReview_NotAuthorReverts() public {
        vm.prank(alice);
        reviews.postReview("subj", 3, "Mine");

        vm.prank(bob);
        vm.expectRevert(MembaReviews.NotAuthor.selector);
        reviews.editReview(0, 5, "Hijack");
    }

    function test_DeleteReview_Success() public {
        vm.prank(alice);
        reviews.postReview("subj", 4, "Will delete");

        vm.prank(alice);
        reviews.deleteReview(0);

        assertTrue(reviews.getReview(0).deleted);

        // Summary count decremented
        MembaReviews.SubjectSummary memory s = reviews.getSummary("subj");
        assertEq(s.count, 0);
    }

    function test_React_Like() public {
        vm.prank(alice);
        reviews.postReview("subj", 4, "Content");

        vm.prank(bob);
        reviews.react(0, true);

        assertEq(reviews.getReview(0).likes, 1);
    }

    function test_React_OwnReviewReverts() public {
        vm.prank(alice);
        reviews.postReview("subj", 4, "Self");

        vm.prank(alice);
        vm.expectRevert(MembaReviews.CannotReactOnOwn.selector);
        reviews.react(0, true);
    }

    function test_React_DoubleReverts() public {
        vm.prank(alice);
        reviews.postReview("subj", 4, "Content");

        vm.prank(bob);
        reviews.react(0, true);

        vm.prank(bob);
        vm.expectRevert(MembaReviews.AlreadyReacted.selector);
        reviews.react(0, false);
    }

    function test_Summary_AverageRating() public {
        vm.prank(alice);
        reviews.postReview("subj", 5, "Five star");
        vm.prank(bob);
        reviews.postReview("subj", 3, "Three star");

        MembaReviews.SubjectSummary memory s = reviews.getSummary("subj");
        assertEq(s.count, 2);
        assertEq(s.sum, 8); // avg = 4.0
    }

    function test_Flag_Success() public {
        vm.prank(alice);
        reviews.postReview("subj", 1, "Spam");

        vm.prank(bob);
        reviews.flag(0, "spam");

        assertEq(reviews.getReview(0).flags, 1);
    }
}
