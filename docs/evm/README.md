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

The app reads the manifest only through `frontend/src/lib/chain/evm/manifest.ts`: `evmContract(chainId, key)` returns the address for a manifest key (any other key does not type-check), `evmContractEntry` adds codehash, version, build and proxy, and `deniedReason(chainId, address)` flags the look-alikes. The data is generated into `manifest.generated.ts`; after editing a JSON file, run `node scripts/gen-evm-manifest.mjs` in `frontend/` (CI fails when the module is stale). Import it only from EVM code so a flag-off build drops it.

### RPC endpoints and pinned fork blocks

Fork tests use `BASE_RPC_URL` / `BASE_SEPOLIA_RPC_URL` when set (an archive endpoint; never commit or print it), else the public endpoints in `foundry.toml`. The public Base Sepolia endpoint prunes history (on 2026-10-07 the earliest block it served was 46,000,000), so without an archive endpoint the pinned blocks must stay inside its window. To bump them:

1. Set `BASE_FORK_BLOCK` / `BASE_SEPOLIA_FORK_BLOCK` in `contracts/evm/test/fork/Addresses.sol` to recent blocks (`cast block-number --rpc-url base_sepolia`).
2. `forge test --match-path 'test/fork/*'` on both chains; fix any test that relied on old state.
3. Update the gas figures quoted in docs if they moved.

## Token template

Every Memba token is one contract, `contracts/evm/src/MembaToken.sol`: OpenZeppelin Wizard output (ERC20 + ERC20Permit + ERC20Votes with a block-number clock) where the reviewed patch `contracts/evm/wizard/MembaToken.patch` only turns the name, symbol and premint into constructor parameters and adds the fee mint:

```solidity
constructor(string name_, string symbol_, address recipient, uint256 premint_, address feeRecipient, uint256 fee_)
```

- The app deploys it through the CREATE2 deployer (`create2Deployer` in the manifest) with the bytecode in `contracts/evm/artifacts/MembaToken.json`, passing `fee_ = supply * 5 / 1000` to the team Safe and `premint_ = supply - fee_` to the creator. Deployment and fee are one transaction for any wallet; the fee stays UI-enforced (anyone can call the deployer with other arguments).
- Amounts are in base units (18 decimals). The supply is capped at 2^208 - 1 (ERC20Votes). The name must be at most 31 bytes (UTF-8): OpenZeppelin 5.7 reverts the deployment above that. Holders have voting power only after delegating (self-delegation included).
- A front-run of the same CREATE2 call deploys the same token with the same recipients, and the creator's own call then reverts and burns its gas limit: simulate first and treat code at the predicted address as "already created".
- Checks: `wizard/check.sh` regenerates the source with the pinned `@openzeppelin/wizard`, refuses a patch that does anything but these edits, applies it with no fuzz and compares bytes; `script/token-artifact.sh --check` rebuilds the artifact and compares it.

```bash
cd contracts/evm
(cd wizard && npm ci && ./check.sh)
script/token-artifact.sh --check
forge test --match-path 'test/unit/*'
```

## Profile on Basenames (read)

`frontend/src/lib/chain/evm/basenames.ts` reads a Base account's profile straight from Base, from manifest contracts only:

1. Primary name: the ENSIP-19 reverse registrar (`basenamesL2ReverseRegistrar`, `nameForAddr`), then the legacy reverse node `<addr>.<0x80000000 | chainId>.reverse` on the registry's resolver.
2. A candidate is shown only when it is one normalized label under `base.eth` (`basetest.eth` on Base Sepolia), its resolver is a Basenames resolver from the manifest, and its forward `addr` is the same address. Anyone can claim any name in reverse.
3. Text records in one multicall: `description`, `avatar`, `url`, `location`, `com.twitter`, `com.github`, and `memba.profile.v1` (the same layout JSON as the Gno profile field).

An RPC failure throws; "no name" is only what the chain answered. `frontend/src/os/profile/evm/basenameProfile.ts` maps the result onto the Profile app's `ProfileChainRead`. Evidence: `contracts/evm/test/fork/Basenames.t.sol` `test_primary_name_read_path` (jesse.base.eth at the pinned block) and `ManifestLive` `test_reverse_registrar_serves_this_chain`.

## Contracts CI

`.github/workflows/contracts-evm.yml`; the required check is the aggregate job **`Contracts (EVM)`** (it always reports; jobs a PR does not need are skipped and count as passed).

| Job | Runs when | Gate |
|---|---|---|
| Static gates and unit tests | `contracts/evm`, `deployments/evm` or the workflow changed; every push to `main` | `forge fmt --check`, `forge build --sizes`, unit and manifest-consistency tests, 100% line/function/branch coverage of `src/`, Wizard diff check, token artifact rebuild, canaries (`script/ci-canaries.sh`) |
| Slither | same | Slither 0.11.6 over `src/`, fails on any finding of low severity or above |
| Fork tests · base / base_sepolia | same | every fork suite at the pinned block; `script/check-forge-json.sh` fails if a suite did not run or a test skipped |
| Manifest vs chains | manifest or its tests changed; push to `main`; daily 05:23 UTC | `ManifestLive` on both chains, then a drifted copy must fail. On the daily run a failure opens an issue; an unreachable RPC is only a warning there, and a failure on a PR |

Optional repository secrets `BASE_RPC_URL` and `BASE_SEPOLIA_RPC_URL` (archive endpoints) are used first; `script/pick-rpc.sh` falls back to public endpoints and never prints one. Secrets are not passed to pull requests from forks, which use the public endpoints.

## Exceptions register

| Contract | Why | Status |
|---|---|---|
| Services escrow | No audited escrow covers milestones, automatic refund and dispute timeout without a custodial arbiter | Wave 3: spec from `escrow_v4`, external audit required |

## Tracks

| Track | Scope | Status |
|---|---|---|
| M0 | Flag, bundle gate, Phase 0 fork verification | Done |
| T1a | Frontend network seam (`frontend/src/lib/chain/`), Base Sepolia in the OS network selector, apps per network family, EVM wallet and sign-in | In progress: network selection, apps per network family, EVM adapter (viem + @wagmi/core, injected wallets), wallet connection (sign-in waits for the SIWE RPCs) |
