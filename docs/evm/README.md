# EVM network (Base)

Memba OS is adding Base as a second network next to Gno.land. Same OS, same apps; each app talks to the network the user picked.

## Rules

- **One trunk.** Short `feat/evm-*` branches merge into `main`. No long-lived EVM branch.
- **Behind `VITE_ENABLE_EVM`.** The flag is safety-gated (`frontend/src/lib/safeFlags.ts`): a release build with it on fails until launch. Deploy-previews may turn it on. With the flag off, the Gno app is unchanged.
- **Lazy only.** viem / wagmi live in the `vendor-evm` chunk, never in the eager graph or the precache manifest (`npm run check:bundle:evm`).
- **Standards first.** Use audited protocols that are already deployed, unmodified (Safe, Zodiac Roles v2, Aragon OSx, Snapshot X, EAS, Seaport, Uniswap CCA, Basenames). OpenZeppelin contracts only as unmodified Wizard output. No business-logic Solidity by default.
- **Exceptions register.** Any custom contract is listed below, specified from its Gno realm, tested (unit, fuzz, invariants) and externally audited before mainnet.
- **Value parity, not mechanical parity.** Each feature is adapted to what the EVM ecosystem already does well rather than re-creating the Gno realm.

## Scope

| Wave | Apps |
|---|---|
| Core (launch 1) | Wallet, Multisig (Safe), Profile (Basenames), DAOs + Treasury (Safe, Aragon OSx, Zodiac Roles v2), Tokens + Launchpad (OZ Wizard ERC-20, Uniswap CCA) |
| Wave 2 | Weighted governance (Snapshot X), reviews / badges / quests (EAS), NFT market + OTC (Seaport), App Store |
| Wave 3 | Feed / channels, Services escrow, Arcade certification, Agents, Explorer |

## Deployment manifest

`deployments/evm/<chainId>.json` (Base `8453`, Base Sepolia `84532`) lists every contract Memba calls on that chain. The app and the tests take addresses from it; nothing else is a valid target.

| Field | Meaning |
|---|---|
| `contracts.<key>.address` | Canonical address. Both chains list the same keys. |
| `codehash` | Runtime codehash on this chain. It can differ between chains (Seaport, EAS, Basenames, Aragon). |
| `proxy` | For EIP-1967 proxies: the implementation and its codehash. Pinning the proxy alone proves nothing about the code that runs. |
| `version`, `versionGetter` | Version, checked on chain when the contract exposes a string getter. |
| `build` | Aragon plugin repo build Memba installs (TokenVoting is build 4 on Base, 3 on Base Sepolia). |
| `source` | Where the address comes from (`S1`–`S9` are the sources in `docs/evm/PHASE0.md` §4). |
| `deny` | Addresses that look right and must never be called, with the reason. |

Checks (`contracts/evm/test/manifest/`):

- `ManifestConsistency` (offline): same keys on both chains, no denied address listed, the fork tests' `Addresses.sol` agrees with the manifest.
- `ManifestLive` (latest block): chain id, code, codehash, proxy implementation and its codehash, versions, Aragon builds, the Basenames controller is accepted. A mismatch, including an upstream proxy upgrade, fails: re-verify the new code, then update the entry in the same PR as any app change it needs.

```bash
cd contracts/evm
forge test --match-path 'test/manifest/*' -vv
```

To add a contract: add the key to both files with the codehash read on chain (`cast keccak $(cast code <addr> --rpc-url base)`), the implementation for a proxy (EIP-1967 slot `0x3608…2bbc`), and the source; run the checks above.

### RPC endpoints and pinned fork blocks

Fork tests use `BASE_RPC_URL` / `BASE_SEPOLIA_RPC_URL` when set (an archive endpoint; never commit or print it), else the public endpoints in `foundry.toml`. The public Base Sepolia endpoint prunes history (on 2026-10-07 the earliest block it served was 46,000,000), so without an archive endpoint the pinned blocks must stay inside its window. To bump them:

1. Set `BASE_FORK_BLOCK` / `BASE_SEPOLIA_FORK_BLOCK` in `contracts/evm/test/fork/Addresses.sol` to recent blocks (`cast block-number --rpc-url base_sepolia`).
2. `forge test --match-path 'test/fork/*'` on both chains; fix any test that relied on old state.
3. Update the gas figures quoted in docs if they moved.

## Exceptions register

| Contract | Why | Status |
|---|---|---|
| Services escrow | No audited escrow covers milestones, automatic refund and dispute timeout without a custodial arbiter | Wave 3: spec from `escrow_v4`, external audit required |

## Tracks

| Track | Scope | Status |
|---|---|---|
| M0 | Flag, bundle gate, Phase 0 fork verification | In progress |
