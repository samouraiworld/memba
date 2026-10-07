// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Canonical addresses, each taken from the protocol's own repository on 2026-10-07.
// Sources are listed in docs/evm/PHASE0.md (address table).
library Addr {
    // Pinned fork blocks (reproducible runs, cacheable RPC reads).
    uint256 internal constant BASE_FORK_BLOCK = 52_289_000;
    uint256 internal constant BASE_SEPOLIA_FORK_BLOCK = 47_800_000;

    // Safe 1.5.0 (safe-global/safe-deployments src/assets/v1.5.0, "canonical")
    address internal constant SAFE = 0xFf51A5898e281Db6DfC7855790607438dF2ca44b;
    address internal constant SAFE_L2 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address internal constant SAFE_PROXY_FACTORY = 0x14F2982D601c9458F93bd70B218933A6f8165e7b;
    address internal constant SAFE_FALLBACK_HANDLER = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    address internal constant SAFE_MULTISEND = 0x218543288004CD07832472D464648173c77D7eB7;
    address internal constant SAFE_MULTISEND_CALL_ONLY = 0xA83c336B20401Af773B6219BA5027174338D1836;

    // Safe AllowanceModule (safe-fndn/safe-modules modules/allowances CHANGELOG "Expected addresses")
    address internal constant ALLOWANCE_MODULE_V1_0_0 = 0x691f59471Bfd2B7d639DCF74671a2d648ED1E331;
    address internal constant ALLOWANCE_MODULE_V0_1_1 = 0xAA46724893dedD72658219405185Fb0Fc91e091C;

    // Zodiac (gnosisguild/zodiac src/contracts.ts; gnosisguild/zodiac-modifier-roles README)
    address internal constant ROLES_V2_MASTERCOPY = 0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5; // 2.1.1
    address internal constant MODULE_PROXY_FACTORY = 0x000000000000aDdB49795b0f9bA5BC298cDda236; // 1.2.0
    address internal constant ROLES_INTEGRITY = 0x6a6Af4b16458Bc39817e4019fB02BD3b26d41049;
    address internal constant ROLES_PACKER = 0x869718C939652084BC491fBC5ce0D3C1d5B309F0;
    address internal constant ROLES_MULTISEND_UNWRAPPER = 0xB4Cd4bb764C089f20DA18700CE8bc5e49F369efD;

    // Aragon OSx, Base mainnet (aragon/osx npm-artifacts/src/addresses.json; aragon/osx-commons baseMainnet.json v1.4.0)
    address internal constant ARAGON_DAO_FACTORY_BASE = 0xcc602EA573a42eBeC290f33F49D4A87177ebB8d2;
    address internal constant ARAGON_PSP_BASE = 0x91a851E9Ed7F2c6d41b15F76e4a88f5A37067cC9;
    address internal constant ARAGON_DAO_REGISTRY_BASE = 0xeB98a71d69a1e12B62c10368D9dA5364CE0f7178;
    address internal constant ARAGON_PLUGIN_REPO_REGISTRY_BASE = 0xB5eB5C011827C9F5787ceE3Abc72d247E36a5a0D;
    // aragon/multisig-plugin packages/artifacts/src/addresses.json; aragon/token-voting-plugin npm-artifacts
    address internal constant ARAGON_MULTISIG_REPO_BASE = 0xcDC4b0BC63AEfFf3a7826A19D101406C6322A585;
    address internal constant ARAGON_TOKENVOTING_REPO_BASE = 0x2532570DcFb749A7F976136CC05648ef2a0f60b0;
    // Base Sepolia (aragon/osx-commons configs baseSepolia.json v1.4.0; plugin repos' addresses.json)
    address internal constant ARAGON_DAO_FACTORY_BASE_SEPOLIA = 0x016CBa9bd729C30b16849b2c52744447767E9dab;
    address internal constant ARAGON_PSP_BASE_SEPOLIA = 0xd97D409Ca645b108468c26d8506f3a4Bf9D0BE81;
    address internal constant ARAGON_MULTISIG_REPO_BASE_SEPOLIA = 0x705596219C1C31dd92E3449c8E04251CcacCb6aB;
    address internal constant ARAGON_TOKENVOTING_REPO_BASE_SEPOLIA_COMMONS = 0xdEbcF8779495a62156c6d1416628F60525984e9d;
    address internal constant ARAGON_TOKENVOTING_REPO_BASE_SEPOLIA_NPM = 0x424F4cA6FA9c24C03f2396DF0E96057eD11CF7dF;

    // Snapshot X (snapshot-labs/sx-monorepo contracts/sx-evm/deployments/{base,base-sepolia}.json; identical)
    address internal constant SX_PROXY_FACTORY = 0x4B4F7f64Be813Ccc66AEFC3bFCe2baA01188631c;
    address internal constant SX_SPACE_IMPL = 0xC3031A7d3326E47D49BfF9D374d74f364B29CE4D;
    address internal constant SX_WHITELIST_VOTING = 0x3CEE21A33751A2722413fF62dEC3dEc48e7748A4;
    address internal constant SX_AVATAR_EXECUTION_IMPL = 0xecE4f6b01a2d7FF5A9765cA44162D453fC455e42;
    address internal constant SX_TIMELOCK_EXECUTION_IMPL = 0xf2A1C2f2098161af98b2Cc7E382AB7F3ba86Ebc4;
    address internal constant SX_VANILLA_AUTH = 0xb9BE0a0093933968E3B4c4fC5d939B6c1Fe45142;
    address internal constant SX_ETH_TX_AUTH = 0xBA06E6cCb877C332181A6867c05c8b746A21Aed1;
    address internal constant SX_ETH_SIG_AUTH = 0x95CF9B585fDb12DeB78002B5643dFF8fe67a496D;
    address internal constant SX_VANILLA_PROPOSAL_VALIDATION = 0x9A39194F870c410633C170889E9025fba2113c79;
    address internal constant SX_PROPOSITION_POWER_VALIDATION = 0x6D9d6D08EF6b26348Bd18F1FC8D953696b7cf311;

    // Uniswap CCA v2.1.0 (Uniswap/continuous-clearing-auction README, commit 7d7602d)
    address internal constant CCA_FACTORY_V2_1_0 = 0x000000001F26a0044BaA66024e7b6599c61963F8;

    // EAS (ethereum-attestation-service/eas-contracts README): Base v1.0.1, Base Sepolia v1.2.0
    address internal constant EAS = 0x4200000000000000000000000000000000000021;
    address internal constant EAS_SCHEMA_REGISTRY = 0x4200000000000000000000000000000000000020;

    // Seaport 1.6 (ProjectOpenSea/seaport README)
    address internal constant SEAPORT_1_6 = 0x0000000000000068F116a894984e2DB1123eB395;
    address internal constant SEAPORT_CONDUIT_CONTROLLER = 0x00000000F9490004C11Cef243f5400493c00Ad63;

    // Basenames (base/basenames README)
    address internal constant BASENAMES_REGISTRY_BASE = 0xB94704422c2a1E396835A571837Aa5AE53285a95;
    address internal constant BASENAMES_BASE_REGISTRAR_BASE = 0x03c4738Ee98aE44591e1A4A4F3CaB6641d95DD9a;
    address internal constant BASENAMES_REGISTRAR_CONTROLLER_BASE = 0x4cCb0BB02FCABA27e82a56646E81d8c5bC4119a5;
    address internal constant BASENAMES_UPGRADEABLE_CONTROLLER_BASE = 0xa7d2607c6BD39Ae9521e514026CBB078405Ab322;
    address internal constant BASENAMES_L2_RESOLVER_BASE = 0xC6d566A56A1aFf6508b41f6c90ff131615583BCD;
    address internal constant BASENAMES_UPGRADEABLE_L2_RESOLVER_BASE = 0x426fA03fB86E510d0Dd9F70335Cf102a98b10875;
    // ENSIP-19 reverse registrar (ensdomains/ens-contracts), where primary names are read first
    address internal constant BASENAMES_L2_REVERSE_REGISTRAR_BASE = 0x0000000000D8e504002cC26E3Ec46D81971C1664;
    address internal constant BASENAMES_L2_REVERSE_REGISTRAR_BASE_SEPOLIA = 0x00000BeEF055f7934784D6d81b6BC86665630dbA;
    address internal constant BASENAMES_REGISTRY_BASE_SEPOLIA = 0x1493b2567056c2181630115660963E13A8E32735;
    address internal constant BASENAMES_BASE_REGISTRAR_BASE_SEPOLIA = 0xA0c70ec36c010B55E3C434D6c6EbEEC50c705794;
    address internal constant BASENAMES_REGISTRAR_CONTROLLER_BASE_SEPOLIA = 0x49aE3cC2e3AA768B1e5654f5D3C6002144A59581;
    address internal constant BASENAMES_UPGRADEABLE_CONTROLLER_BASE_SEPOLIA =
        0x82c858CDF64b3D893Fe54962680edFDDC37e94C8;
    address internal constant BASENAMES_L2_RESOLVER_BASE_SEPOLIA = 0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA;
    address internal constant BASENAMES_UPGRADEABLE_L2_RESOLVER_BASE_SEPOLIA =
        0x85C87e548091f204C2d0350b39ce1874f02197c6;
}
