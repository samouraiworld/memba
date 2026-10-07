// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkBase} from "./ForkBase.sol";
import {Addr} from "./Addresses.sol";
import {
    ISafe,
    IMultiSend,
    Operation,
    ICcaFactory,
    ICcaAuction,
    CcaAuctionParameters,
    IERC20Min
} from "./Interfaces.sol";
import {MembaToken} from "../../src/MembaToken.sol";

/// Tasks 2e + 2f: the Memba token template (Wizard ERC20 + Permit + Votes, constructor parameters) deployed by
/// CREATE2 in ONE call that also mints the 0.5% fee to the treasury, then a Uniswap CCA v2.1.0 auction for that
/// token, proceeds to the Safe. The fee mint is in the constructor, so any wallet (EOA or Safe) creates a token and
/// pays the fee in a single transaction: no batch, no partial failure. The fee stays UI-enforced: anyone can call
/// the deployer with other arguments.
abstract contract TokenLaunchTest is ForkBase {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint256 internal constant SUPPLY = 1_000_000 ether;
    uint256 internal constant FEE = SUPPLY * 5 / 1000; // 0.5%, computed by the app
    uint256 internal constant PREMINT = SUPPLY - FEE;
    bytes32 internal constant SALT = keccak256("memba.phase0.token");

    ISafe internal creator; // a Safe creator; an EOA creator is covered by test_token_create2_from_eoa
    address internal treasury;

    function setUp() public override {
        super.setUp();
        creator = _deploySafe(_owners3(), 2, uint256(keccak256("memba.phase0.creator")));
        treasury = makeAddr("memba-team-safe");
    }

    function _initcode(address recipient, address feeRecipient) internal pure returns (bytes memory) {
        return abi.encodePacked(
            type(MembaToken).creationCode, abi.encode("Memba Phase0", "MP0", recipient, PREMINT, feeRecipient, FEE)
        );
    }

    function _predict(address recipient, address feeRecipient) internal pure returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), CREATE2_DEPLOYER, SALT, keccak256(_initcode(recipient, feeRecipient))
                        )
                    )
                )
            )
        );
    }

    function _deployCall(address recipient, address feeRecipient) internal pure returns (bytes memory) {
        return abi.encodePacked(SALT, _initcode(recipient, feeRecipient));
    }

    function _pack(address to, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(0), to, value, data.length, data);
    }

    /// The creator Safe deploys its token: one Safe transaction, one CREATE2 call.
    function _deployFromSafe() internal returns (address token, uint256 used) {
        token = _predict(address(creator), treasury);
        used = _execSafe(creator, CREATE2_DEPLOYER, 0, _deployCall(address(creator), treasury), Operation.Call, _two());
    }

    // 2e ─────────────────────────────────────────────────────────────────

    function test_token_create2_with_fee_mint() public {
        (address token, uint256 used) = _deployFromSafe();
        _gas("Safe tx: CREATE2 MembaToken (ERC20Permit+Votes) with the 0.5% fee mint", used);
        assertGt(token.code.length, 0);
        assertEq(IERC20Min(token).totalSupply(), SUPPLY);
        assertEq(IERC20Min(token).balanceOf(treasury), FEE);
        assertEq(IERC20Min(token).balanceOf(address(creator)), PREMINT);
    }

    /// An EOA creates its token and pays the fee in one plain transaction (no EIP-5792 needed).
    function test_token_create2_from_eoa() public {
        address token = _predict(alice, treasury);
        vm.prank(alice);
        uint256 g = gasleft();
        (bool ok,) = CREATE2_DEPLOYER.call(_deployCall(alice, treasury));
        _gas("EOA call: CREATE2 MembaToken with the 0.5% fee mint", g - gasleft());
        assertTrue(ok);
        assertEq(IERC20Min(token).balanceOf(alice), PREMINT);
        assertEq(IERC20Min(token).balanceOf(treasury), FEE);
    }

    /// A failing constructor (fee recipient zero) deploys nothing: the deployment and the fee are one operation.
    function test_token_fee_mint_failure_deploys_nothing() public {
        address token = _predict(alice, address(0));
        vm.prank(alice);
        (bool ok,) = CREATE2_DEPLOYER.call(_deployCall(alice, address(0)));
        assertFalse(ok);
        assertEq(token.code.length, 0);
    }

    /// Anyone can deploy the same initcode first (public CREATE2 deployer). The recipients are in the initcode, so
    /// the creator still gets the premint and the treasury the fee: nothing is stolen. The creator's own call then
    /// reverts and burns its gas limit, so the UI simulates first and treats code at the predicted address with the
    /// expected recipients as "already created".
    function test_token_create2_frontrun_is_harmless_but_burns_gas() public {
        address token = _predict(address(creator), treasury);
        (bool ok,) = CREATE2_DEPLOYER.call(_deployCall(address(creator), treasury));
        assertTrue(ok);
        assertEq(IERC20Min(token).balanceOf(address(creator)), PREMINT);
        assertEq(IERC20Min(token).balanceOf(treasury), FEE);

        bytes memory data = _deployCall(address(creator), treasury);
        bytes32 h = creator.getTransactionHash(
            CREATE2_DEPLOYER, 0, data, Operation.Call, 0, 0, 0, address(0), address(0), creator.nonce()
        );
        bytes memory sigs = _sign(h, _two());
        // The deployer reverts with no data, and a CREATE2 collision burns all the gas it was given.
        uint256 g = gasleft();
        vm.expectRevert(bytes(""));
        creator.execTransaction(
            CREATE2_DEPLOYER, 0, data, Operation.Call, 0, 0, 0, address(0), payable(address(0)), sigs
        );
        _gas("Front-run deploy: gas burnt by the reverted CREATE2 collision", g - gasleft());
    }

    // 2f — Uniswap CCA v2.1.0 ─────────────────────────────────────────

    uint256 internal constant AUCTION_AMOUNT = 100_000 ether; // 10% of supply
    uint256 internal constant TICK = 79_228_162_514_264_337_593_543; // floor(2^96 / 1e6): 1e-6 ETH per token
    uint256 internal constant FLOOR = TICK * 100; // ~1e-4 ETH per token, a multiple of the tick spacing

    function _params(uint64 start, uint128 required) internal view returns (CcaAuctionParameters memory p) {
        p = CcaAuctionParameters({
            currency: address(0), // native ETH; an ERC-20 currency is pulled through Permit2
            tokensRecipient: address(creator),
            fundsRecipient: address(creator),
            startBlock: start,
            endBlock: start + 100,
            claimBlock: start + 100,
            tickSpacing: TICK,
            validationHook: address(0),
            floorPrice: FLOOR,
            requiredCurrencyRaised: required,
            auctionStepsData: abi.encodePacked(uint24(100_000), uint40(100)) // 1e5 mps x 100 blocks = 1e7
        });
    }

    /// Creates the auction and funds it in ONE Safe batch: create, transfer, onTokensReceived.
    function _launch(uint128 required) internal returns (address token, ICcaAuction auction, uint64 start) {
        (token,) = _deployFromSafe();
        start = uint64(block.number + 5);
        bytes memory cfg = abi.encode(_params(start, required));
        ICcaFactory f = ICcaFactory(Addr.CCA_FACTORY_V2_1_0);
        auction = ICcaAuction(f.getAddress(token, AUCTION_AMOUNT, cfg, bytes32(0), address(creator)));
        bytes memory batch = abi.encodeCall(
            IMultiSend.multiSend,
            (bytes.concat(
                    _pack(address(f), 0, abi.encodeCall(ICcaFactory.create, (token, AUCTION_AMOUNT, cfg, bytes32(0)))),
                    _pack(token, 0, abi.encodeCall(IERC20Min.transfer, (address(auction), AUCTION_AMOUNT))),
                    _pack(address(auction), 0, abi.encodeCall(ICcaAuction.onTokensReceived, ()))
                ))
        );
        uint256 used = _execSafe(creator, Addr.SAFE_MULTISEND_CALL_ONLY, 0, batch, Operation.DelegateCall, _two());
        _gas("Safe batch: CCA factory.create + fund + onTokensReceived", used);
        assertGt(address(auction).code.length, 0);
    }

    function test_cca_auction_graduates_to_safe() public {
        assertEq(ICcaFactory(Addr.CCA_FACTORY_V2_1_0).protocolFeeController(), address(0)); // no protocol fee today
        (address token, ICcaAuction auction, uint64 start) = _launch(1 ether);

        // Bidding before the start block fails.
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("AuctionNotStarted()"));
        auction.submitBid{value: 1 ether}(FLOOR * 2, 1 ether, alice, FLOOR, "");

        vm.roll(start);
        vm.prank(alice);
        uint256 g = gasleft();
        uint256 bidA = auction.submitBid{value: 2 ether}(FLOOR * 2, 2 ether, alice, FLOOR, "");
        _gas("CCA submitBid (new tick)", g - gasleft());
        vm.roll(start + 10);
        vm.prank(bob);
        g = gasleft();
        uint256 bidB = auction.submitBid{value: 2 ether}(FLOOR * 3, 2 ether, bob, FLOOR, "");
        _gas("CCA submitBid (later block)", g - gasleft());

        vm.roll(start + 100);
        g = gasleft();
        auction.checkpoint();
        _gas("CCA final checkpoint", g - gasleft());
        assertTrue(auction.isGraduated());
        emit log_named_uint("clearing price (Q96)", auction.clearingPrice());
        emit log_named_uint("currency raised (wei)", auction.currencyRaised());
        emit log_named_uint("tokens cleared", auction.totalCleared());

        g = gasleft();
        auction.exitBid(bidA);
        _gas("CCA exitBid", g - gasleft());
        auction.exitBid(bidB);
        g = gasleft();
        auction.claimTokens(bidA);
        _gas("CCA claimTokens", g - gasleft());
        auction.claimTokens(bidB);
        emit log_named_uint("alice tokens", IERC20Min(token).balanceOf(alice));
        emit log_named_uint("bob tokens", IERC20Min(token).balanceOf(bob));
        emit log_named_uint("alice ETH refunded", alice.balance - 8 ether);

        // Only the funds recipient can sweep: here the Safe, so it is a Safe transaction.
        vm.expectRevert();
        auction.sweepCurrency();
        uint256 before = address(creator).balance;
        _gas(
            "Safe tx: CCA sweepCurrency",
            _execSafe(
                creator, address(auction), 0, abi.encodeCall(ICcaAuction.sweepCurrency, ()), Operation.Call, _two()
            )
        );
        _execSafe(
            creator, address(auction), 0, abi.encodeCall(ICcaAuction.sweepUnsoldTokens, ()), Operation.Call, _two()
        );
        emit log_named_uint("Safe ETH received", address(creator).balance - before);
        assertEq(address(creator).balance - before, auction.currencyRaised());
    }

    /// Below the graduation threshold every bid is refunded and the whole supply returns.
    function test_cca_auction_fails_to_graduate() public {
        (address token, ICcaAuction auction, uint64 start) = _launch(100 ether);
        vm.deal(alice, 10 ether);
        vm.roll(start);
        vm.prank(alice);
        uint256 bidA = auction.submitBid{value: 2 ether}(FLOOR * 2, 2 ether, alice, FLOOR, "");
        vm.roll(start + 100);
        auction.checkpoint();
        assertFalse(auction.isGraduated());
        vm.expectRevert(abi.encodeWithSignature("NotGraduated()"));
        auction.claimTokens(bidA);
        auction.exitBid(bidA);
        assertEq(alice.balance, 10 ether);
        _execSafe(
            creator, address(auction), 0, abi.encodeCall(ICcaAuction.sweepUnsoldTokens, ()), Operation.Call, _two()
        );
        assertEq(IERC20Min(token).balanceOf(address(creator)), PREMINT);
    }

    /// Parameter mistakes the UI must prevent (each reverts at creation).
    function test_cca_parameter_pitfalls() public {
        (address token,) = _deployFromSafe();
        ICcaFactory f = ICcaFactory(Addr.CCA_FACTORY_V2_1_0);
        uint64 start = uint64(block.number + 5);

        CcaAuctionParameters memory p = _params(start, 1 ether);
        p.floorPrice = FLOOR + 1; // not on a tick boundary
        vm.expectRevert(abi.encodeWithSignature("TickPriceNotAtBoundary()"));
        f.create(token, AUCTION_AMOUNT, abi.encode(p), bytes32(0));

        p = _params(start, 1 ether);
        p.auctionStepsData = abi.encodePacked(uint24(99_999), uint40(100)); // does not sum to 1e7
        vm.expectRevert();
        f.create(token, AUCTION_AMOUNT, abi.encode(p), bytes32(0));

        p = _params(start, 1 ether);
        p.claimBlock = p.endBlock - 1;
        vm.expectRevert(abi.encodeWithSignature("ClaimBlockIsBeforeEndBlock()"));
        f.create(token, AUCTION_AMOUNT, abi.encode(p), bytes32(0));

        // A start block in the past is NOT rejected: the elapsed blocks' share of supply is never offered.
        p = _params(uint64(block.number - 50), 1 ether);
        address past = f.create(token, AUCTION_AMOUNT, abi.encode(p), bytes32(uint256(1)));
        assertGt(past.code.length, 0);
    }
}

contract TokenLaunchBaseSepoliaTest is TokenLaunchTest {
    function _chain() internal pure override returns (string memory) {
        return "base_sepolia";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_SEPOLIA_FORK_BLOCK;
    }
}

contract TokenLaunchBaseTest is TokenLaunchTest {
    function _chain() internal pure override returns (string memory) {
        return "base";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_FORK_BLOCK;
    }
}
