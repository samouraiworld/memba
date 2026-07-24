// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaCollections } from "../src/commerce/MembaCollections.sol";
import { MembaNFT } from "../src/commerce/MembaNFT.sol";

/// @title MembaCollections
/// @notice The launchpad: sale phases, allowlist minting, supply caps, fees.
///
/// @dev This contract had **no test file at all** — 251 lines handling ETH, at 0%
///      line/branch/function coverage, committed as complete and shipped past a
///      self-graded "0 critical, 0 high" review.
///
///      The cost of that was not theoretical. `mintNFT` could never succeed in any
///      state: it calls `MembaNFT.mint`, which requires `coll.creator == msg.sender`,
///      but `msg.sender` there is the Collections proxy and Collections never made
///      the proxy a creator of anything. Both branches reverted — `CollectionNotFound`
///      if nobody pre-created the sub-collection, `NotCollectionCreator` if the human
///      creator did, exactly as the code comment instructed. The launchpad's only
///      revenue function was inert, and `Deploy.s.sol` wired it in regardless.
///
///      A single happy-path test would have caught it.
contract MembaCollectionsTest is Test {
    MembaCollections public launchpad;
    MembaNFT public nft;

    address public adminAddr = makeAddr("admin");
    address public feeWallet = makeAddr("feeWallet");
    address public creator = makeAddr("creator");
    address public buyer = makeAddr("buyer");
    address public outsider = makeAddr("outsider");

    uint256 public constant CREATION_FEE = 0.01 ether;
    uint256 public constant MINT_PRICE = 0.05 ether;

    uint8 constant PHASE_DRAFT = 0;
    uint8 constant PHASE_ALLOWLIST = 1;
    uint8 constant PHASE_PUBLIC = 2;
    uint8 constant PHASE_CLOSED = 3;

    string constant SLUG = "cool-collection";

    function setUp() public {
        MembaNFT nftImpl = new MembaNFT();
        nft = MembaNFT(address(new ERC1967Proxy(address(nftImpl), abi.encodeCall(MembaNFT.initialize, (adminAddr)))));

        MembaCollections lpImpl = new MembaCollections();
        launchpad = MembaCollections(
            address(
                new ERC1967Proxy(
                    address(lpImpl),
                    abi.encodeCall(MembaCollections.initialize, (adminAddr, feeWallet, CREATION_FEE, address(nft)))
                )
            )
        );

        // The launchpad has to be authorised to mint into collections it does not own,
        // otherwise the human creator would have to give up royalty ownership.
        vm.prank(adminAddr);
        nft.setLaunchpad(address(launchpad));

        vm.deal(creator, 10 ether);
        vm.deal(buyer, 10 ether);
        vm.deal(outsider, 10 ether);
    }

    function _hash(string memory slug) internal pure returns (bytes32) {
        return keccak256(bytes(slug));
    }

    /// Register the MembaNFT sub-collection, then the launchpad entry for it.
    function _createCollection(address who, string memory slug) internal returns (bytes32) {
        vm.prank(who);
        nft.createCollection(slug, "Cool", "COOL", 500);

        vm.prank(who);
        launchpad.createCollection{ value: CREATION_FEE }(slug, "Cool", "COOL", "desc", 3, MINT_PRICE, 500);
        return _hash(slug);
    }

    // ══════════════════════════════════════════════════════════
    // A-1 — the mint path must actually work
    // ══════════════════════════════════════════════════════════

    function test_MintNFT_Succeeds() public {
        bytes32 h = _createCollection(creator, SLUG);
        vm.prank(creator);
        launchpad.setPhase(h, PHASE_PUBLIC);

        uint256 creatorBefore = creator.balance;

        vm.prank(buyer);
        uint256 tokenId = launchpad.mintNFT{ value: MINT_PRICE }(h, "ipfs://token", new bytes32[](0));

        assertEq(nft.ownerOf(tokenId), buyer, "buyer did not receive the NFT");
        assertEq(launchpad.getCollection(h).mintCount, 1);
        assertEq(creator.balance, creatorBefore + MINT_PRICE, "mint revenue did not reach the creator");
    }

    /// Royalties must stay with the human creator, not the launchpad proxy. This is
    /// why the fix authorises the launchpad to mint rather than making it the owner
    /// of every sub-collection.
    function test_RoyaltiesGoToTheHumanCreator() public {
        bytes32 h = _createCollection(creator, SLUG);
        vm.prank(creator);
        launchpad.setPhase(h, PHASE_PUBLIC);

        vm.prank(buyer);
        uint256 tokenId = launchpad.mintNFT{ value: MINT_PRICE }(h, "ipfs://token", new bytes32[](0));

        (address receiver, uint256 amount) = nft.royaltyInfo(tokenId, 10_000);
        assertEq(receiver, creator, "royalties were redirected away from the creator");
        assertEq(amount, 500);
    }

    // ══════════════════════════════════════════════════════════
    // Binding — you may only launch a collection you own
    // ══════════════════════════════════════════════════════════

    /// Authorising the launchpad to mint anywhere opens a squat: if the launchpad
    /// entry were not bound to the NFT sub-collection's owner, anyone could register
    /// slug "X" on the launchpad and mint into someone else's MembaNFT collection.
    function test_CannotLaunchACollectionYouDoNotOwn() public {
        vm.prank(creator);
        nft.createCollection(SLUG, "Cool", "COOL", 500);

        vm.prank(outsider);
        vm.expectRevert();
        launchpad.createCollection{ value: CREATION_FEE }(SLUG, "Cool", "COOL", "desc", 3, MINT_PRICE, 500);
    }

    function test_CannotLaunchBeforeCreatingTheNftCollection() public {
        vm.prank(creator);
        vm.expectRevert();
        launchpad.createCollection{ value: CREATION_FEE }("no-such-slug", "X", "X", "d", 0, 0, 0);
    }

    // ══════════════════════════════════════════════════════════
    // Sale phases
    // ══════════════════════════════════════════════════════════

    function test_MintClosedInDraft() public {
        bytes32 h = _createCollection(creator, SLUG);
        vm.prank(buyer);
        vm.expectRevert();
        launchpad.mintNFT{ value: MINT_PRICE }(h, "ipfs://t", new bytes32[](0));
    }

    function test_MintClosedWhenClosed() public {
        bytes32 h = _createCollection(creator, SLUG);
        vm.prank(creator);
        launchpad.setPhase(h, PHASE_CLOSED);
        vm.prank(buyer);
        vm.expectRevert();
        launchpad.mintNFT{ value: MINT_PRICE }(h, "ipfs://t", new bytes32[](0));
    }

    // ══════════════════════════════════════════════════════════
    // Allowlist — with a real multi-leaf tree
    // ══════════════════════════════════════════════════════════

    /// The Channels merkle tests in this repo anchor a leaf AS the root and verify
    /// with an empty proof, which reduces to `leaf == root` and would pass against a
    /// stub implementation. This builds an actual 2-leaf tree.
    function test_AllowlistAcceptsAProofAndRejectsAnOutsider() public {
        bytes32 h = _createCollection(creator, SLUG);

        bytes32 leafBuyer = keccak256(abi.encodePacked(buyer));
        bytes32 leafOther = keccak256(abi.encodePacked(makeAddr("alsoAllowed")));
        (bytes32 root, bytes32 sibling) = leafBuyer < leafOther
            ? (keccak256(abi.encodePacked(leafBuyer, leafOther)), leafOther)
            : (keccak256(abi.encodePacked(leafOther, leafBuyer)), leafOther);

        vm.startPrank(creator);
        launchpad.setAllowlistRoot(h, root);
        launchpad.setPhase(h, PHASE_ALLOWLIST);
        vm.stopPrank();

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = sibling;

        vm.prank(buyer);
        launchpad.mintNFT{ value: MINT_PRICE }(h, "ipfs://t", proof);
        assertEq(launchpad.getCollection(h).mintCount, 1);

        vm.prank(outsider);
        vm.expectRevert();
        launchpad.mintNFT{ value: MINT_PRICE }(h, "ipfs://t", proof);
    }

    // ══════════════════════════════════════════════════════════
    // Supply, payment, fees
    // ══════════════════════════════════════════════════════════

    function test_MaxSupplyIsEnforced() public {
        bytes32 h = _createCollection(creator, SLUG); // maxSupply = 3
        vm.prank(creator);
        launchpad.setPhase(h, PHASE_PUBLIC);

        for (uint256 i = 0; i < 3; i++) {
            vm.prank(buyer);
            launchpad.mintNFT{ value: MINT_PRICE }(h, "ipfs://t", new bytes32[](0));
        }
        vm.prank(buyer);
        vm.expectRevert();
        launchpad.mintNFT{ value: MINT_PRICE }(h, "ipfs://t", new bytes32[](0));
    }

    function test_UnderpaymentReverts() public {
        bytes32 h = _createCollection(creator, SLUG);
        vm.prank(creator);
        launchpad.setPhase(h, PHASE_PUBLIC);

        vm.prank(buyer);
        vm.expectRevert();
        launchpad.mintNFT{ value: MINT_PRICE - 1 }(h, "ipfs://t", new bytes32[](0));
    }

    /// A-10: overpayment was forwarded wholesale instead of being refunded — send
    /// 5 ETH for a 0.05 ETH mint and the creator kept all of it.
    function test_MintOverpaymentIsRefunded() public {
        bytes32 h = _createCollection(creator, SLUG);
        vm.prank(creator);
        launchpad.setPhase(h, PHASE_PUBLIC);

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        launchpad.mintNFT{ value: 5 ether }(h, "ipfs://t", new bytes32[](0));

        assertEq(buyer.balance, buyerBefore - MINT_PRICE, "overpayment was confiscated");
    }

    /// A-10, creation side: the whole msg.value went to the fee recipient.
    function test_CreationOverpaymentIsRefunded() public {
        vm.prank(creator);
        nft.createCollection(SLUG, "Cool", "COOL", 500);

        uint256 creatorBefore = creator.balance;
        vm.prank(creator);
        launchpad.createCollection{ value: 5 ether }(SLUG, "Cool", "COOL", "d", 0, 0, 0);

        assertEq(creator.balance, creatorBefore - CREATION_FEE, "creation overpayment was confiscated");
        assertEq(feeWallet.balance, CREATION_FEE);
    }

    function test_CreationUnderpaymentReverts() public {
        vm.prank(creator);
        nft.createCollection(SLUG, "Cool", "COOL", 500);
        vm.prank(creator);
        vm.expectRevert();
        launchpad.createCollection{ value: CREATION_FEE - 1 }(SLUG, "Cool", "COOL", "d", 0, 0, 0);
    }

    // ══════════════════════════════════════════════════════════
    // Access control
    // ══════════════════════════════════════════════════════════

    /// Phase control is creator-ONLY — note the admin cannot move a sale either.
    /// That is worth stating explicitly: it means there is no admin lever to halt a
    /// single misbehaving sale short of pausing the whole launchpad.
    function test_SetPhaseIsCreatorOnly() public {
        bytes32 h = _createCollection(creator, SLUG);

        vm.prank(outsider);
        vm.expectRevert(MembaCollections.NotCreator.selector);
        launchpad.setPhase(h, PHASE_PUBLIC);

        vm.prank(adminAddr);
        vm.expectRevert(MembaCollections.NotCreator.selector);
        launchpad.setPhase(h, PHASE_PUBLIC);

        vm.prank(creator);
        launchpad.setPhase(h, PHASE_PUBLIC);
        assertEq(launchpad.getCollection(h).phase, PHASE_PUBLIC);
    }

    function test_OnlyAdminCanVerify() public {
        bytes32 h = _createCollection(creator, SLUG);
        vm.prank(outsider);
        vm.expectRevert();
        launchpad.verifyCollection(h);

        vm.prank(adminAddr);
        launchpad.verifyCollection(h);
        assertTrue(launchpad.getCollection(h).verified);
    }

    function test_OnlyAdminCanSetLaunchpadOnNft() public {
        vm.prank(outsider);
        vm.expectRevert();
        nft.setLaunchpad(outsider);
    }

    function test_PausedBlocksMint() public {
        bytes32 h = _createCollection(creator, SLUG);
        vm.prank(creator);
        launchpad.setPhase(h, PHASE_PUBLIC);
        vm.prank(adminAddr);
        launchpad.pause();

        vm.prank(buyer);
        vm.expectRevert();
        launchpad.mintNFT{ value: MINT_PRICE }(h, "ipfs://t", new bytes32[](0));
    }

    function test_DuplicateSlugReverts() public {
        _createCollection(creator, SLUG);
        vm.prank(creator);
        vm.expectRevert();
        launchpad.createCollection{ value: CREATION_FEE }(SLUG, "Cool", "COOL", "d", 0, 0, 0);
    }

    function test_ListCollectionsTracksRegistrations() public {
        _createCollection(creator, SLUG);
        _createCollection(creator, "second-one");
        assertEq(launchpad.listCollections().length, 2);
        assertEq(launchpad.collectionCount(), 2);
    }
}
