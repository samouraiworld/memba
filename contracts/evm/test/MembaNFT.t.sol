// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC2981 } from "@openzeppelin/contracts/interfaces/IERC2981.sol";

import { MembaNFT } from "../src/commerce/MembaNFT.sol";

contract MembaNFTTest is Test {
    MembaNFT public nft;

    address public adminAddr = makeAddr("admin");
    address public creator = makeAddr("creator");
    address public alice = makeAddr("alice");
    address public outsider = makeAddr("outsider");

    function setUp() public {
        MembaNFT impl = new MembaNFT();
        bytes memory initData = abi.encodeCall(MembaNFT.initialize, (adminAddr));
        address proxy = address(new ERC1967Proxy(address(impl), initData));
        nft = MembaNFT(proxy);
    }

    function _createCollection() internal {
        vm.prank(creator);
        nft.createCollection("art-1", "Art Collection", "ART", 500); // 5% royalty
    }

    // ══════════════════════════════════════════════════════════════
    // 1. Collection
    // ══════════════════════════════════════════════════════════════

    function test_CreateCollection_Success() public {
        _createCollection();
        MembaNFT.CollectionInfo memory info = nft.getCollectionInfo("art-1");
        assertEq(info.creator, creator);
        assertEq(info.name, "Art Collection");
        assertEq(info.royaltyBps, 500);
        assertEq(info.totalSupply, 0);
    }

    function test_CreateCollection_DuplicateReverts() public {
        _createCollection();
        vm.prank(creator);
        vm.expectRevert(MembaNFT.CollectionAlreadyExists.selector);
        nft.createCollection("art-1", "Dup", "DUP", 0);
    }

    function test_CreateCollection_RoyaltyTooHighReverts() public {
        vm.prank(creator);
        vm.expectRevert(MembaNFT.RoyaltyTooHigh.selector);
        nft.createCollection("high-r", "High", "HIGH", 1001);
    }

    // ══════════════════════════════════════════════════════════════
    // 2. Minting
    // ══════════════════════════════════════════════════════════════

    function test_Mint_Success() public {
        _createCollection();

        vm.prank(creator);
        uint256 tokenId = nft.mint("art-1", alice, "ipfs://QmABC");

        assertEq(tokenId, 0);
        assertEq(nft.ownerOf(0), alice);
        assertEq(nft.tokenURI(0), "ipfs://QmABC");
    }

    function test_Mint_NonCreatorReverts() public {
        _createCollection();

        vm.prank(outsider);
        vm.expectRevert(MembaNFT.NotCollectionCreator.selector);
        nft.mint("art-1", alice, "ipfs://hack");
    }

    function test_Mint_EmptyURIReverts() public {
        _createCollection();

        vm.prank(creator);
        vm.expectRevert(MembaNFT.EmptyTokenURI.selector);
        nft.mint("art-1", alice, "");
    }

    // ══════════════════════════════════════════════════════════════
    // 3. Batch Mint
    // ══════════════════════════════════════════════════════════════

    function test_BatchMint_Success() public {
        _createCollection();

        string[] memory uris = new string[](3);
        uris[0] = "ipfs://1";
        uris[1] = "ipfs://2";
        uris[2] = "ipfs://3";

        vm.prank(creator);
        uint256 firstId = nft.batchMint("art-1", alice, uris);

        assertEq(firstId, 0);
        assertEq(nft.ownerOf(0), alice);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.ownerOf(2), alice);
        assertEq(nft.nextTokenId(), 3);
    }

    function test_BatchMint_TooLargeReverts() public {
        _createCollection();

        string[] memory uris = new string[](51);
        for (uint256 i = 0; i < 51; i++) {
            uris[i] = "ipfs://x";
        }

        vm.prank(creator);
        vm.expectRevert(MembaNFT.BatchTooLarge.selector);
        nft.batchMint("art-1", alice, uris);
    }

    // ══════════════════════════════════════════════════════════════
    // 4. Royalties (ERC-2981)
    // ══════════════════════════════════════════════════════════════

    function test_Royalty_CorrectValues() public {
        _createCollection();

        vm.prank(creator);
        nft.mint("art-1", alice, "ipfs://royalty");

        // Sale price = 1 ETH, 5% royalty = 0.05 ETH
        (address receiver, uint256 royaltyAmount) = nft.royaltyInfo(0, 1 ether);
        assertEq(receiver, creator);
        assertEq(royaltyAmount, 0.05 ether);
    }

    // ══════════════════════════════════════════════════════════════
    // 5. Transfer
    // ══════════════════════════════════════════════════════════════

    function test_Transfer_Success() public {
        _createCollection();
        vm.prank(creator);
        nft.mint("art-1", alice, "ipfs://transfer");

        vm.prank(alice);
        nft.transferFrom(alice, outsider, 0);
        assertEq(nft.ownerOf(0), outsider);
    }

    function test_ApproveAndTransfer() public {
        _createCollection();
        vm.prank(creator);
        nft.mint("art-1", alice, "ipfs://approve");

        vm.prank(alice);
        nft.approve(outsider, 0);

        vm.prank(outsider);
        nft.transferFrom(alice, outsider, 0);
        assertEq(nft.ownerOf(0), outsider);
    }

    function test_SetApprovalForAll() public {
        _createCollection();
        vm.prank(creator);
        nft.mint("art-1", alice, "ipfs://market");

        vm.prank(alice);
        nft.setApprovalForAll(outsider, true);

        assertTrue(nft.isApprovedForAll(alice, outsider));

        vm.prank(outsider);
        nft.transferFrom(alice, outsider, 0);
        assertEq(nft.ownerOf(0), outsider);
    }

    // ══════════════════════════════════════════════════════════════
    // 6. Supports Interface
    // ══════════════════════════════════════════════════════════════

    function test_SupportsERC2981() public view {
        assertTrue(nft.supportsInterface(type(IERC2981).interfaceId));
        assertTrue(nft.supportsInterface(type(IERC721).interfaceId));
    }
}
