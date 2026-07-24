// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Non-standard ERC-20 mocks. The whole OTC suite used only `MembaToken`
///         with `decimals = 0` and a faithful transfer, so no test ever exercised a
///         token that keeps a fee, rebases, or returns `false` instead of reverting —
///         which is exactly why A-3/A-4/A-5 went unseen.

/// @notice Burns `feeBps` of every non-mint/burn transfer, so the recipient receives
///         strictly less than `value`. Reproduces the classic fee-on-transfer footgun.
contract FeeOnTransferToken is ERC20 {
    uint256 public immutable feeBps;
    address public constant SINK = address(0xFEE);
    uint8 private immutable _dec;

    constructor(uint256 feeBps_, uint8 decimals_) ERC20("FeeOnTransfer", "FOT") {
        feeBps = feeBps_;
        _dec = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        super._update(from, to, value - fee);
        super._update(from, SINK, fee);
    }
}

/// @notice ERC-20 whose supply can be rebased up or down by an unprivileged (test-only)
///         call. Balances scale with `factorBps / 10_000`.
contract RebasingToken is ERC20 {
    uint256 public factorBps = 10_000;
    uint8 private immutable _dec;

    constructor(uint8 decimals_) ERC20("Rebasing", "RBS") {
        _dec = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Test-only. Scales every reported balance; `>10_000` inflates, `<10_000` deflates.
    function setFactorBps(uint256 f) external {
        factorBps = f;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return (super.balanceOf(account) * factorBps) / 10_000;
    }
}

/// @notice A functional ERC-20 that omits the optional `decimals()` extension, so the
///         OTC desk must fall back to per-base-unit pricing rather than reverting.
contract NoDecimalsToken is IERC20 {
    mapping(address => uint256) private _bal;
    mapping(address => mapping(address => uint256)) private _allow;

    function mint(address to, uint256 amount) external {
        _bal[to] += amount;
    }

    function totalSupply() external pure returns (uint256) {
        return 0;
    }

    function balanceOf(address a) external view returns (uint256) {
        return _bal[a];
    }

    function allowance(address o, address s) external view returns (uint256) {
        return _allow[o][s];
    }

    function approve(address s, uint256 v) external returns (bool) {
        _allow[msg.sender][s] = v;
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        _bal[msg.sender] -= v;
        _bal[to] += v;
        return true;
    }

    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        _allow[from][msg.sender] -= v;
        _bal[from] -= v;
        _bal[to] += v;
        return true;
    }
}

/// @notice Returns `false` from `transfer`/`transferFrom` instead of reverting.
///         SafeERC20 must turn this into a revert; a naive `IERC20` call would not.
contract ReturnsFalseToken is IERC20 {
    mapping(address => uint256) private _bal;
    mapping(address => mapping(address => uint256)) private _allow;

    function mint(address to, uint256 amount) external {
        _bal[to] += amount;
    }

    function totalSupply() external pure returns (uint256) {
        return 0;
    }

    function balanceOf(address a) external view returns (uint256) {
        return _bal[a];
    }

    function allowance(address o, address s) external view returns (uint256) {
        return _allow[o][s];
    }

    function approve(address s, uint256 v) external returns (bool) {
        _allow[msg.sender][s] = v;
        return true;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}
