// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {MembaToken} from "../../src/MembaToken.sol";

/// The one token template every Memba token is deployed from: Wizard ERC20 + Permit + Votes (block-number clock)
/// with name, symbol, the creator's premint and the 0.5% fee mint as constructor parameters. The fee amount is
/// computed by the app (supply * 5 / 1000); the contract only mints what it is given.
contract MembaTokenTest is Test {
    event Transfer(address indexed from, address indexed to, uint256 value);

    uint256 internal constant SUPPLY = 1_000_000 ether;
    uint256 internal constant FEE = SUPPLY * 5 / 1000;
    uint256 internal constant PREMINT = SUPPLY - FEE;
    uint256 internal constant PK = 0xA11CE;

    address internal creator;
    address internal treasury = makeAddr("memba-team-safe");
    MembaToken internal token;

    function setUp() public {
        creator = vm.addr(PK);
        token = new MembaToken("Samourai Coin", "SAM", creator, PREMINT, treasury, FEE);
    }

    function test_metadata_and_supply_split() public view {
        assertEq(token.name(), "Samourai Coin");
        assertEq(token.symbol(), "SAM");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(creator), PREMINT);
        assertEq(token.balanceOf(treasury), FEE);
    }

    function test_both_mints_are_visible_transfers_from_zero() public {
        vm.expectEmit(true, true, false, true);
        emit Transfer(address(0), creator, PREMINT);
        vm.expectEmit(true, true, false, true);
        emit Transfer(address(0), treasury, FEE);
        new MembaToken("Samourai Coin", "SAM", creator, PREMINT, treasury, FEE);
    }

    function test_zero_fee_recipient_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        new MembaToken("T", "T", creator, PREMINT, address(0), FEE);
    }

    function test_zero_recipient_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        new MembaToken("T", "T", address(0), PREMINT, treasury, FEE);
    }

    function testFuzz_supply_split(uint256 premint, uint256 fee) public {
        premint = bound(premint, 0, type(uint208).max);
        fee = bound(fee, 0, type(uint208).max - premint);
        MembaToken t = new MembaToken("T", "T", creator, premint, treasury, fee);
        assertEq(t.balanceOf(creator), premint);
        assertEq(t.balanceOf(treasury), fee);
        assertEq(t.totalSupply(), premint + fee);
    }

    /// ERC20Votes caps the supply at 2^208 - 1; the constructor reverts above it.
    function test_supply_above_votes_cap_reverts() public {
        uint256 cap = type(uint208).max;
        vm.expectRevert(abi.encodeWithSelector(ERC20Votes.ERC20ExceededSafeSupply.selector, cap + 1, cap));
        new MembaToken("T", "T", creator, cap, treasury, 1);
    }

    /// OpenZeppelin 5.7 stores the EIP-712 name only as a ShortString: a name over 31 bytes (UTF-8) reverts the
    /// deployment. The app must cap the name at 31 bytes.
    function test_name_limit_is_31_bytes() public {
        string memory max = "Thirty-one bytes token name 31b";
        assertEq(bytes(max).length, 31);
        MembaToken t = new MembaToken(max, "MAX", creator, 1, treasury, 0);
        (, string memory domainName,,,,,) = t.eip712Domain();
        assertEq(domainName, max);

        string memory tooLong = "Thirty-two bytes token name: 32b";
        assertEq(bytes(tooLong).length, 32);
        vm.expectRevert(abi.encodeWithSignature("StringTooLong(string)", tooLong));
        new MembaToken(tooLong, "LONG", creator, 1, treasury, 0);
    }

    function test_permit_domain_uses_constructor_name() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Samourai Coin")),
                keccak256(bytes("1")),
                block.chainid,
                address(token)
            )
        );
        assertEq(token.DOMAIN_SEPARATOR(), expected);
    }

    function test_permit_sets_allowance() public {
        address spender = makeAddr("spender");
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                creator,
                spender,
                123,
                token.nonces(creator),
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(PK, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
        token.permit(creator, spender, 123, deadline, v, r, s);
        assertEq(token.allowance(creator, spender), 123);
        assertEq(token.nonces(creator), 1);
    }

    function test_clock_is_block_number() public view {
        assertEq(token.clock(), block.number);
        assertEq(token.CLOCK_MODE(), "mode=blocknumber&from=default");
    }

    /// Voting power exists only once delegated; transfers then move it, and past votes are read by block.
    function test_delegation_and_past_votes() public {
        assertEq(token.getVotes(creator), 0);
        vm.prank(creator);
        token.delegate(creator);
        assertEq(token.getVotes(creator), PREMINT);
        vm.prank(treasury);
        token.delegate(treasury);

        vm.roll(100);
        vm.prank(creator);
        assertTrue(token.transfer(treasury, 1000));
        vm.roll(101);

        assertEq(token.getVotes(creator), PREMINT - 1000);
        assertEq(token.getVotes(treasury), FEE + 1000);
        assertEq(token.getPastVotes(creator, 99), PREMINT);
        assertEq(token.getPastVotes(creator, 100), PREMINT - 1000);
        assertEq(token.getPastTotalSupply(100), SUPPLY);
    }

    /// Permit and delegateBySig share one nonce sequence (the Wizard's nonces override).
    function test_permit_and_delegate_by_sig_share_nonces() public {
        test_permit_sets_allowance();
        uint256 expiry = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)"), creator, 1, expiry)
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(PK, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
        token.delegateBySig(creator, 1, expiry, v, r, s);
        assertEq(token.delegates(creator), creator);
        assertEq(token.nonces(creator), 2);
    }
}
