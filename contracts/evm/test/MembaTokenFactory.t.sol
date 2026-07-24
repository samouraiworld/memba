// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { MembaTokenFactory } from "../src/commerce/MembaTokenFactory.sol";
import { MembaToken } from "../src/commerce/MembaToken.sol";

/**
 * @title MembaTokenFactoryTest
 * @notice 12 test cases per CONTRACT_SPECS/MembaTokenFactory.spec.md.
 */
contract MembaTokenFactoryTest is Test {
    MembaTokenFactory public factory;

    address public adminAddr = makeAddr("admin");
    address public feeWallet = makeAddr("feeWallet");
    address public alice = makeAddr("alice");
    address public outsider = makeAddr("outsider");

    uint256 public constant CREATION_FEE = 0.001 ether;

    function setUp() public {
        MembaTokenFactory impl = new MembaTokenFactory();
        bytes memory initData = abi.encodeCall(MembaTokenFactory.initialize, (adminAddr, feeWallet, CREATION_FEE));
        address proxy = address(new ERC1967Proxy(address(impl), initData));
        factory = MembaTokenFactory(proxy);

        vm.deal(alice, 10 ether);
        vm.deal(outsider, 10 ether);
    }

    // ══════════════════════════════════════════════════════════════
    // 1. Initialization
    // ══════════════════════════════════════════════════════════════

    function test_Initialize_CorrectState() public view {
        assertEq(factory.admin(), adminAddr);
        assertEq(factory.feeRecipient(), feeWallet);
        assertEq(factory.creationFee(), CREATION_FEE);
        assertEq(factory.getTokenCount(), 0);
    }

    // ══════════════════════════════════════════════════════════════
    // 2. Token Creation
    // ══════════════════════════════════════════════════════════════

    function test_CreateToken_Success() public {
        vm.prank(alice);
        address token =
            factory.createToken{ value: CREATION_FEE }("Test Token", "TEST", 18, 1000e18, bytes32(uint256(1)));

        assertTrue(token != address(0));
        assertEq(factory.getTokenCount(), 1);
        assertEq(factory.getToken(0), token);
        assertTrue(factory.isRegistered(token));
        assertEq(factory.getTokenCreator(token), alice);
    }

    function test_CreateToken_ERC20Compliance() public {
        vm.prank(alice);
        address tokenAddr =
            factory.createToken{ value: CREATION_FEE }("My Token", "MYT", 6, 1_000_000e6, bytes32(uint256(1)));

        MembaToken token = MembaToken(tokenAddr);
        assertEq(token.name(), "My Token");
        assertEq(token.symbol(), "MYT");
        assertEq(token.decimals(), 6);
        assertEq(token.totalSupply(), 1_000_000e6);
        assertEq(token.balanceOf(alice), 1_000_000e6);
    }

    function test_CreateToken_InitialSupplyMintedToCreator() public {
        vm.prank(alice);
        address tokenAddr =
            factory.createToken{ value: CREATION_FEE }("Supply Test", "SUP", 18, 500e18, bytes32(uint256(1)));

        assertEq(IERC20(tokenAddr).balanceOf(alice), 500e18);
    }

    function test_CreateToken_ZeroInitialSupply() public {
        vm.prank(alice);
        address tokenAddr = factory.createToken{ value: CREATION_FEE }("No Supply", "NONE", 18, 0, bytes32(uint256(1)));

        assertEq(IERC20(tokenAddr).totalSupply(), 0);
    }

    function test_CreateToken_DeterministicAddresses() public {
        vm.prank(alice);
        address token1 = factory.createToken{ value: CREATION_FEE }("Token A", "TKNA", 18, 0, bytes32(uint256(100)));

        vm.prank(alice);
        address token2 = factory.createToken{ value: CREATION_FEE }("Token B", "TKNB", 18, 0, bytes32(uint256(200)));

        assertTrue(token1 != token2);
        assertEq(factory.getTokenCount(), 2);
    }

    // ══════════════════════════════════════════════════════════════
    // 3. Fee Collection
    // ══════════════════════════════════════════════════════════════

    function test_CreateToken_FeeCollected() public {
        uint256 feeBefore = feeWallet.balance;

        vm.prank(alice);
        factory.createToken{ value: CREATION_FEE }("Fee Test", "FEE", 18, 0, bytes32(uint256(1)));

        assertEq(feeWallet.balance, feeBefore + CREATION_FEE);
    }

    function test_CreateToken_InsufficientFeeReverts() public {
        vm.prank(alice);
        vm.expectRevert(MembaTokenFactory.InsufficientFee.selector);
        factory.createToken{ value: CREATION_FEE - 1 }("Cheap Token", "CHEAP", 18, 0, bytes32(uint256(1)));
    }

    // ══════════════════════════════════════════════════════════════
    // 4. Symbol Uniqueness
    // ══════════════════════════════════════════════════════════════

    function test_CreateToken_DuplicateSymbolReverts() public {
        vm.prank(alice);
        factory.createToken{ value: CREATION_FEE }("First", "DUP", 18, 0, bytes32(uint256(1)));

        vm.prank(alice);
        vm.expectRevert(MembaTokenFactory.SymbolAlreadyUsed.selector);
        factory.createToken{ value: CREATION_FEE }("Second", "DUP", 18, 0, bytes32(uint256(2)));
    }

    // ══════════════════════════════════════════════════════════════
    // 5. Validation
    // ══════════════════════════════════════════════════════════════

    function test_CreateToken_EmptyNameReverts() public {
        vm.prank(alice);
        vm.expectRevert(MembaTokenFactory.InvalidParams.selector);
        factory.createToken{ value: CREATION_FEE }("", "SYM", 18, 0, bytes32(uint256(1)));
    }

    function test_CreateToken_ExcessiveDecimalsReverts() public {
        vm.prank(alice);
        vm.expectRevert(MembaTokenFactory.InvalidParams.selector);
        factory.createToken{ value: CREATION_FEE }("Bad Decimals", "BAD", 19, 0, bytes32(uint256(1)));
    }

    // ══════════════════════════════════════════════════════════════
    // 6. Admin
    // ══════════════════════════════════════════════════════════════

    function test_UpdateFeeRecipient_Success() public {
        address newRecipient = makeAddr("newFee");
        vm.prank(adminAddr);
        factory.updateFeeRecipient(newRecipient);
        assertEq(factory.feeRecipient(), newRecipient);
    }

    function test_UpdateFeeRecipient_NonAdminReverts() public {
        vm.prank(outsider);
        vm.expectRevert(MembaTokenFactory.NotAdmin.selector);
        factory.updateFeeRecipient(outsider);
    }

    // ══════════════════════════════════════════════════════════════
    // 7. Child Token Mint
    // ══════════════════════════════════════════════════════════════

    function test_ChildToken_AdminCanMint() public {
        vm.prank(alice);
        address tokenAddr = factory.createToken{ value: CREATION_FEE }("Mintable", "MINT", 18, 0, bytes32(uint256(1)));

        MembaToken token = MembaToken(tokenAddr);
        vm.prank(alice); // alice is the token owner
        token.mint(outsider, 100e18);

        assertEq(token.balanceOf(outsider), 100e18);
    }

    function test_ChildToken_NonAdminCannotMint() public {
        vm.prank(alice);
        address tokenAddr = factory.createToken{ value: CREATION_FEE }("Guarded", "GUARD", 18, 0, bytes32(uint256(1)));

        MembaToken token = MembaToken(tokenAddr);
        vm.prank(outsider);
        vm.expectRevert();
        token.mint(outsider, 100e18);
    }

    // ══════════════════════════════════════════════════════════════
    // 8. Pausable
    // ══════════════════════════════════════════════════════════════

    function test_Paused_CreateTokenReverts() public {
        vm.prank(adminAddr);
        factory.pause();

        vm.prank(alice);
        vm.expectRevert();
        factory.createToken{ value: CREATION_FEE }("Paused", "PAUSE", 18, 0, bytes32(uint256(1)));
    }
}
