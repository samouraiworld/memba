# Memba — current status

This file is the single place that says what is live, what is pending and what is decided.
README, ROADMAP and the dated plans are background; when they disagree with this file, this file wins.
Update it in the same PR as any change to what runs in production, a feature flag, a deployed realm or a decision below.

**Last verified: 2026-11-13** (against git, GitHub, `build-info.json` and the backend `/health` endpoint).

## What runs in production

| Surface | Version | How to check |
|---|---|---|
| Source (`main`) | `4a67007ff` | `git log -1 origin/main` |
| Frontend ([memba.club](https://memba.club)) | `4a67007ff` | `https://memba.club/build-info.json` → `commit` |
| Backend | `4a67007`, Go 1.26.11 | `GET /health` → `version`, `go_version` |
| gno SDK used by the backend | gnolang/gno master `855151c394` (canonical transaction encoding) | `backend/go.mod` |
| Latest release tag | `v7.8.0` (far behind `main`) | `git tag --sort=-creatordate` |

Frontend merges deploy through Netlify; backend merges deploy automatically.

## Networks

- **gno.land mainnet (`gnoland-1`)** — the default network. Reads go to `rpc.gno.land` first and fail over to the Samourai node when a node is down or refuses a query.
- **Onyx** — testnet used for rehearsals and for features that are not on mainnet yet (private notes).
- Older testnets (test12, test13, topaz, sapphire, pearl) are retired.

## Feature flags held off in production

The production build fails if any of these resolves to `"true"` (`frontend/src/lib/safeFlags.ts`):

| Flag | Why it is held |
|---|---|
| `VITE_ENABLE_NOTES_ENCRYPTED`, `VITE_ENABLE_NOTES_VAULT_REVEAL` | Private notes run only on Onyx until reviewed for mainnet. |
| `VITE_ENABLE_TREASURY_SPEND` | Treasury spending waits for the governance work below. |
| `VITE_ENABLE_AGENT_CREDITS` | Not released. |
| `VITE_ENABLE_EVM` | EVM work is frozen (see Decisions). |

## Deployed realms

`realm-versions.json` lists the mainnet realms and their versions. It was last verified on 2026-09-23; realms deployed since then (`memba_gov`, `validator_scores`) still need their entries re-checked against the chain.

## Upstream changes we are tracking

| Change | When it reaches mainnet | Memba |
|---|---|---|
| Only the canonical transaction encoding is accepted (gnolang/gno#6406, #6399) | At the next coordinated halt (not announced yet) | Backend multisig ready (#1673). Other `gnokey` binaries we run still need to be rebuilt; tracked below. |
| A K-of-N multisignature must carry exactly K signatures | Same halt | Backend ready (#1673). Deployment scripts still to bound the signer count. |
| Nodes may refuse code-running queries (`rpc.allow_code_execution`, gnolang/gno#6413) | Per node operator | Reads fail over to the next node (#1674). |

## Work in progress

- Rebuild or pin every `gnokey` binary used by our services and scripts at a version that writes the canonical encoding.
- Bound the multisig signer count to the threshold in the deployment scripts.
- Give the Arcade signer and the manual-signing scripts a fallback RPC.
- Private notes, integration and lifecycle (#1643): up to date with `main`, not merged.
- Optional accounts (#1562): draft.

## Decisions

| Date | Decision |
|---|---|
| 2026-11-13 | **EVM frozen.** Code stays behind `VITE_ENABLE_EVM`; PRs #1517, #1518 and #1529 are parked as drafts until a review in March 2027. The daily EVM contracts check is removed (#1672). |
| 2026-11-13 | **RPC:** `rpc.gno.land` stays the primary node, with failover to the Samourai node. |
| 2026-11-13 | **Next product stream: governance** — treasury split, DAO proposals, app transfers and publisher rotation. |
