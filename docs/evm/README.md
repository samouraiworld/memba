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

## Exceptions register

| Contract | Why | Status |
|---|---|---|
| Services escrow | No audited escrow covers milestones, automatic refund and dispute timeout without a custodial arbiter | Wave 3: spec from `escrow_v4`, external audit required |

## Tracks

| Track | Scope | Status |
|---|---|---|
| M0 | Flag, bundle gate, Phase 0 fork verification | In progress |
