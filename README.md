# Memba メンバー

Memba is a Gno application for multisig coordination, DAO governance and community tools, built by [Samouraï Coop](https://samourai.world). It is experimental software; read the [disclaimer](DISCLAIMER.md) before using a wallet.

| Site | Current role |
| --- | --- |
| [memba.samourai.app](https://memba.samourai.app) | Classic application on gno.land mainnet. |
| [memba.club](https://memba.club) | Memba OS public beta, with a desktop and app windows at `/os`. Some windows still contain the classic pages. |

Each site's public `build-info.json` identifies its deployed frontend version and commit; it does not establish the availability of every feature or its backing realm. Both sites served version 7.7.0 on 2026-09-26. The production beta build sets `VITE_MEMBA_OS` and the build-only `MEMBA_OS_BETA_SITE` marker; local development and preview builds can emit OS code with `VITE_MEMBA_OS` alone. The classic production build excludes OS assets. The beta keeps the existing install ID `/` and starts at `/os`.

## Dev Report candidate (2026-10-08)

Dev Report adds a searchable public repository catalogue at `/mainnet/gnolove/repositories` and `/os/dev-report/repositories`, grouped by organisation. Overview starts with Gno core (`gnolang/gno`); all and custom scopes are explicit, shareable and restored by browser history. Enriched metrics depend on the gnolove registry backend; unavailable fields remain blank. Legacy package/vote activity is withheld until the index network and genesis are verified. This is candidate scope pending coordinated backend/frontend deployment.

## Network and availability

The offered network is gno.land mainnet, chain ID `gnoland-1`. The testnet is Onyx, chain ID `onyx-1`: reachable at `/onyx/…` and as a build default, hidden from the selector until Memba publishes realms there. The Pearl, Sapphire and Topaz testnets and Betanet (`gnoland1`, a different chain from mainnet) are retired; their old routes (`/pearl/…`, `/sapphire/…`, `/topaz/…`, `/gnoland1/…`) redirect to the same page on mainnet. See [the capability registry](frontend/src/lib/config.ts) and [wave-one deployment records](realm-versions.json) when checking a shared community realm. The founding DAO's status is recorded separately in [weighted DAO documentation](docs/WEIGHTED_DAO.md).

| Area | Repository and mainnet status |
| --- | --- |
| Multisig | Create, import, propose, collect signatures and broadcast flows are implemented. A connected wallet, compatible account and successful chain checks are required for writes. Native Gno multisig remains a separate gated rehearsal. |
| DAO governance | General DAO pages and user DAO creation are implemented. Memba DAO runs on `gno.land/r/samcrew/memba_gov`, published on mainnet on 2026-10-08 with its bridge `memba_bridge_v1`: members vote there, and the DAO acts on an app only once that app has been handed over to the bridge. The founding `gno.land/r/samcrew/memba_dao` v12 stays read-only, as the [weighted DAO guide](docs/WEIGHTED_DAO.md) documents; other weighted DAO writes remain held on mainnet. The candidature realm is absent on mainnet, so the candidature flow is unavailable there. |
| Community | The mainnet deployment record includes Feed, feedback, reviews, badges and App Store realms. UI exposure also depends on each feature flag and the realm validity check. App Store submission carries a fee and remains separately gated. A published realm alone does not enable a feature. |
| Token Launchpad | Published on mainnet on 2026-10-08 and listed in the mainnet allowlist (`launchpad/config`, `tokens` and `sales` v1): the Tokens window creates tokens and opens fair sales there, with no other flag. Each lane can be paused by the Launchpad pauser; exits (settlement, claims, refunds, proceeds, fee sweeps) never are. |
| Market and NFT | The Services lane uses the deployed `escrow_v4` realm and also requires `VITE_ENABLE_SERVICES`; its money path has separate safeguards. The Launchpad NFT realms are published but not in the mainnet allowlist yet, and the classic token factory and OTC realms are absent from it, so NFT trading, collection creation, the classic token factory and OTC are not live mainnet offerings. The beta NFT window explains this state and links to Market. |
| Arcade | Game code exists, with individual play and certification flags. An on-chain leaderboard or attester deployment does not by itself enable certification. |
| Memba OS | The beta desktop, Aqua window styling, native NFT and Feed homes, About window and Arcade lobby are implemented. Bounded guest access merged in #1339, native Feed in #1338, Live activity in #1337, and Terminal with Learn in #1340. A 2026-09-27 production guest smoke confirmed the native Terminal and Learn windows; use public `build-info.json` for the current deployed commit. |

Feature flags are build inputs, so availability on a deployed site can differ from source defaults. A route or button is not evidence that its transaction is enabled. The [roadmap](ROADMAP.md) separates current delivery from planned work.

## Repository

| Path | Purpose |
| --- | --- |
| `frontend/` | React, Vite, classic UI and the gated Memba OS beta. |
| `backend/` | Go and ConnectRPC services, including multisig coordination. |
| `api/` | Protobuf service definitions. |
| `contracts/` | Template CI stubs. Canonical deployed realm source is maintained separately; see [deployment records](realm-versions.json). |
| `docs/` | Architecture, API and operations documentation. |

## Development

Prerequisites: Go 1.26.6 or newer, Node.js 22 or newer, [Buf](https://buf.build/docs/installation) for protobuf changes, and [Adena](https://adena.app/) for wallet interaction.

```bash
git clone https://github.com/samouraiworld/memba.git
cd memba
cd backend && go run ./cmd/memba
```

In another terminal:

```bash
cd frontend && npm install && npm run dev
```

For frontend checks, run `npm test`, `npm run lint` and `npm run build` from `frontend/`. See [contributing](CONTRIBUTING.md) and the [frontend guide](frontend/README.md) for more detail.

## Documentation

- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Security policy](SECURITY.md)
- [Disclaimer](DISCLAIMER.md)
- [License](LICENSE)
