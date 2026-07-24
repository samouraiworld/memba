// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console } from "forge-std/Script.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { MembaDAO } from "../src/core/MembaDAO.sol";
import { MembaDAOFactory } from "../src/core/MembaDAOFactory.sol";
import { MembaTokenFactory } from "../src/commerce/MembaTokenFactory.sol";
import { MembaEscrow } from "../src/commerce/MembaEscrow.sol";

/**
 * @title Deploy
 * @notice Deployment script for Memba EVM contracts.
 *         Deploys implementations + proxies + factory in a single transaction batch.
 *
 * Usage:
 *   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
 *
 * TODO: Fill in deployment parameters from .env once contracts are implemented.
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address safeMultisig = vm.envAddress("SAFE_MULTISIG_ADDRESS");

        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("Safe Multisig:", safeMultisig);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MembaDAO implementation
        MembaDAO daoImpl = new MembaDAO();
        console.log("MembaDAO impl:", address(daoImpl));

        // 2. Deploy MembaDAOFactory (points to implementation)
        MembaDAOFactory factory = new MembaDAOFactory(address(daoImpl));
        console.log("MembaDAOFactory:", address(factory));

        // 3. Deploy MembaTokenFactory behind proxy
        MembaTokenFactory tokenFactoryImpl = new MembaTokenFactory();
        bytes memory tokenFactoryInit =
            abi.encodeCall(MembaTokenFactory.initialize, (safeMultisig, safeMultisig, 0.001 ether));
        ERC1967Proxy tokenFactoryProxy = new ERC1967Proxy(address(tokenFactoryImpl), tokenFactoryInit);
        console.log("MembaTokenFactory proxy:", address(tokenFactoryProxy));

        // 4. Deploy MembaEscrow behind proxy
        MembaEscrow escrowImpl = new MembaEscrow();
        bytes memory escrowInit = abi.encodeCall(
            MembaEscrow.initialize,
            (
                safeMultisig, // admin
                safeMultisig, // feeRecipient
                200, // 2% platform fee
                500, // 5% cancellation fee
                30 days // auto-refund timeout
            )
        );
        ERC1967Proxy escrowProxy = new ERC1967Proxy(address(escrowImpl), escrowInit);
        console.log("MembaEscrow proxy:", address(escrowProxy));

        vm.stopBroadcast();

        console.log("--- Deployment Complete ---");
    }
}
