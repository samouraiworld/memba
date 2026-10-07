// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

/// Fork URL for a foundry.toml alias. CI passes a private archive endpoint through BASE_RPC_URL /
/// BASE_SEPOLIA_RPC_URL; when the variable is unset or empty, the public endpoint in foundry.toml is used.
library RpcUrl {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function forAlias(string memory chainAlias) internal view returns (string memory url) {
        bytes32 a = keccak256(bytes(chainAlias));
        string memory envName;
        if (a == keccak256("base")) envName = "BASE_RPC_URL";
        else if (a == keccak256("base_sepolia")) envName = "BASE_SEPOLIA_RPC_URL";
        else revert(string.concat("unknown chain alias: ", chainAlias));
        url = VM.envOr(envName, string(""));
        if (bytes(url).length == 0) url = VM.rpcUrl(chainAlias);
    }
}
