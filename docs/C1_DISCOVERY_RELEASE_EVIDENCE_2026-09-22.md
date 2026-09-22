# C1 discovery evidence — 2026-09-22

## Release status

Implementation candidates only. Production verification is pending merge and GitHub's required approving review. A+B remains closed. No wallet, signature, broadcast, publication or deployment-policy change was exercised.

Catalog candidate: PR #1239, commit `0961f44668aab6bd93e88b2a673f684d93eb6162`. Its Netlify preview build-info matches that commit and entry `assets/index-DmSLVy3n.js`. Read-only browser checks confirmed mainnet filtering, search persistence across reload, fixed-network links, and the gated `/mainnet/apps/submit` route. Independent CTO and SWE reviews cleared that revision. Hosted Node 20/22, backend, E2E, bundle/security/attribution gates passed; additional visual matrix status is recorded in the PR.

## Directory source boundary

The old Gnolove package record has no validated chain identifier. Directory does not merge it into selected-network realm/package results. Two bounded gnoweb namespace reads require matching chain metadata. They establish listing provenance, not successful realm rendering or transaction readiness. A failed read keeps editorial/reference entries available with a partial-coverage notice and retry. The existing document CSP excludes bare `gno.land`, so mainnet namespace reads currently fail into the editorial fallback. C1 does not change CSP or proxy behavior; Pearl fixtures cover successful namespace reads. Results are cached per network for five minutes; there is no polling or per-card fan-out.

Mainnet editorial realm source pages below were checked over HTTPS with certificate verification on 2026-09-22. HTTP success establishes source reachability on `gnoland-1` at that time only. The finite historical seed audit shows why legacy references are omitted from mainnet. They remain labeled unverified references on test networks. The user registry path is derived from selected-network configuration and is not asserted as a mainnet seed.

| Source page | HTTP | Mainnet metadata |
|---|---:|---|
| [gno.land/p/demo/avl](https://gno.land/p/demo/avl$source) | 404 | gnoland-1 |
| [gno.land/p/demo/boards2](https://gno.land/p/demo/boards2$source) | 404 | gnoland-1 |
| [gno.land/p/demo/dao](https://gno.land/p/demo/dao$source) | 404 | gnoland-1 |
| [gno.land/p/demo/entropy](https://gno.land/p/demo/entropy$source) | 404 | gnoland-1 |
| [gno.land/p/demo/grc/grc1155](https://gno.land/p/demo/grc/grc1155$source) | 404 | gnoland-1 |
| [gno.land/p/demo/grc/grc20](https://gno.land/p/demo/grc/grc20$source) | 404 | gnoland-1 |
| [gno.land/p/demo/grc/grc721](https://gno.land/p/demo/grc/grc721$source) | 404 | gnoland-1 |
| [gno.land/p/demo/json](https://gno.land/p/demo/json$source) | 404 | gnoland-1 |
| [gno.land/p/demo/membstore](https://gno.land/p/demo/membstore$source) | 404 | gnoland-1 |
| [gno.land/p/demo/ownable](https://gno.land/p/demo/ownable$source) | 404 | gnoland-1 |
| [gno.land/p/demo/pausable](https://gno.land/p/demo/pausable$source) | 404 | gnoland-1 |
| [gno.land/p/demo/seqid](https://gno.land/p/demo/seqid$source) | 404 | gnoland-1 |
| [gno.land/p/demo/simpledao](https://gno.land/p/demo/simpledao$source) | 404 | gnoland-1 |
| [gno.land/p/demo/uassert](https://gno.land/p/demo/uassert$source) | 404 | gnoland-1 |
| [gno.land/p/demo/ufmt](https://gno.land/p/demo/ufmt$source) | 404 | gnoland-1 |
| [gno.land/r/demo/grc20reg](https://gno.land/r/demo/grc20reg$source) | 404 | gnoland-1 |
| [gno.land/r/demo/worx](https://gno.land/r/demo/worx$source) | 404 | gnoland-1 |
| [gno.land/r/faucet/admin](https://gno.land/r/faucet/admin$source) | 404 | gnoland-1 |
| [gno.land/r/gnoland/blog](https://gno.land/r/gnoland/blog$source) | 200 | gnoland-1 |
| [gno.land/r/gnoland/boards2/v1](https://gno.land/r/gnoland/boards2/v1$source) | 404 | gnoland-1 |
| [gno.land/r/gnoland/faucet](https://gno.land/r/gnoland/faucet$source) | 404 | gnoland-1 |
| [gno.land/r/gnoswap/v1/router](https://gno.land/r/gnoswap/v1/router$source) | 404 | gnoland-1 |
| [gno.land/r/gov/dao](https://gno.land/r/gov/dao$source) | 200 | gnoland-1 |
| [gno.land/r/gov/dao/v2](https://gno.land/r/gov/dao/v2$source) | 404 | gnoland-1 |
| [gno.land/r/samcrew/tokenfactory_v2](https://gno.land/r/samcrew/tokenfactory_v2$source) | 404 | gnoland-1 |
| [gno.land/r/gnoland/boards2/v0](https://gno.land/r/gnoland/boards2/v0$source) | 200 | gnoland-1 |
| [gno.land/r/gov/dao](https://gno.land/r/gov/dao$source) | 200 | gnoland-1 |

## Validation limits

Namespace fixtures test both mainnet and Pearl, missing/mismatched chain identity, successful empty results and failed reads. Browser fixtures are offline data and do not prove real-wallet behavior. The bounded reliability and accessibility pass is a separate C1 slice; do not infer it from the provenance changes.
