// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkBase} from "./ForkBase.sol";
import {Addr} from "./Addresses.sol";
import {
    IEAS,
    ISchemaRegistry,
    EasAttestationRequest,
    EasAttestationRequestData,
    EasAttestation
} from "./Interfaces.sol";

/// Task 2g: register a schema and make one onchain attestation on the EAS predeploys.
/// Offchain attestations are EIP-712 signatures verified by clients: no transaction, nothing to test here.
abstract contract EasTest is ForkBase {
    function test_eas_schema_and_attestation() public {
        emit log_named_string("EAS version", IEAS(Addr.EAS).version());
        uint256 g = gasleft();
        bytes32 schema = ISchemaRegistry(Addr.EAS_SCHEMA_REGISTRY)
            .register("bytes32 serviceId,uint8 rating,string comment", address(0), true);
        _gas("EAS SchemaRegistry.register", g - gasleft());

        vm.prank(alice);
        g = gasleft();
        bytes32 uid = IEAS(Addr.EAS)
            .attest(
                EasAttestationRequest(
                    schema,
                    EasAttestationRequestData(
                        bob,
                        0,
                        true,
                        bytes32(0),
                        abi.encode(keccak256("service-42"), uint8(5), "on time, clean work"),
                        0
                    )
                )
            );
        _gas("EAS attest (review, onchain)", g - gasleft());

        EasAttestation memory a = IEAS(Addr.EAS).getAttestation(uid);
        assertEq(a.attester, alice);
        assertEq(a.recipient, bob);
        assertEq(a.schema, schema);
        (, uint8 rating,) = abi.decode(a.data, (bytes32, uint8, string));
        assertEq(rating, 5);
    }
}

contract EasBaseSepoliaTest is EasTest {
    function _chain() internal pure override returns (string memory) {
        return "base_sepolia";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_SEPOLIA_FORK_BLOCK;
    }
}

contract EasBaseTest is EasTest {
    function _chain() internal pure override returns (string memory) {
        return "base";
    }

    function _forkBlock() internal pure override returns (uint256) {
        return Addr.BASE_FORK_BLOCK;
    }
}
