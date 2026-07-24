// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.28;

/// @notice A recipient that can be armed to reject incoming ETH.
/// @dev The whole 169-test suite used only `makeAddr()` EOAs, so no test had ever
///      executed a single `if (!ok) revert TransferFailed()` branch. Push payments
///      to a contract that refuses ETH are the difference between "works" and
///      "one counterparty can freeze everyone's funds".
contract RevertingReceiver {
    bool public rejecting;

    function setRejecting(bool v) external {
        rejecting = v;
    }

    /// @dev Forwards an arbitrary call so the mock can act as buyer or seller.
    function call(address target, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{ value: msg.value }(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }

    receive() external payable {
        require(!rejecting, "RevertingReceiver: rejecting");
    }
}

/// @notice A recipient with no `receive`/`fallback` — cannot accept ETH at all.
contract NoReceive {
    function call(address target, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{ value: msg.value }(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }
}

/// @notice Re-enters a configurable selector on the target from `receive()`.
contract ReentrantReceiver {
    address public target;
    bytes public payload;
    bool public armed;
    bool public reentered;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function call(address target_, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = target_.call{ value: msg.value }(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }

    receive() external payable {
        if (armed) {
            armed = false; // one shot
            reentered = true;
            // Deliberately ignore the result: we want to observe whether the guard
            // holds, not to bubble a revert that would mask the outer call.
            (bool ok,) = target.call(payload);
            ok; // silence
        }
    }
}
