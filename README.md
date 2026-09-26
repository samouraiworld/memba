# Memba メンバー

Memba is a Gno application for multisig coordination, DAO governance and community tools, built by [Samouraï Coop](https://samourai.world). It is experimental software; read the [disclaimer](DISCLAIMER.md) before using a wallet.

| Site | Current role |
| --- | --- |
| [memba.samourai.app](https://memba.samourai.app) | Classic application on gno.land mainnet. |
| [memba.club](https://memba.club) | Memba OS public beta, with a desktop and app windows at `/os`. Some windows still contain the classic pages. |

Each site's public `build-info.json` identifies its deployed frontend version and commit; it does not establish the availability of every feature or its backing realm. Both sites served version 7.7.0 on 2026-09-26. The production beta build sets `VITE_MEMBA_OS` and the build-only `MEMBA_OS_BETA_SITE` marker; local development and preview builds can emit OS code with `VITE_MEMBA_OS` alone. The classic production build excludes OS assets. The beta keeps the existing install ID `/` and starts at `/os`.

## Network and availability

The offered network is gno.land mainnet, chain ID `gnoland-1`. The Pearl testnet is retired; old `/pearl/…` routes redirect to mainnet. Betanet's `gnoland1` is a different chain. The network selector still contains hidden historical entries for route resolution. See [the capability registry](frontend/src/lib/config.ts) and [wave-one deployment records](realm-versions.json) when checking a shared community realm. The founding DAO's later mainnet release is recorded separately in [weighted DAO documentation](docs/WEIGHTED_DAO.md); the deployment JSON and general realm allowlist have not been updated for that exception.

| Area | Repository and mainnet status |
| --- | --- |
| Multisig | Create, import, propose, collect signatures and broadcast flows are implemented. A connected wallet, compatible account and successful chain checks are required for writes. Native Gno multisig remains a separate gated rehearsal. |
| DAO governance | General DAO pages and user DAO creation are implemented. The founding `gno.land/r/samcrew/memba_dao` v12 has a narrow mainnet propose, vote and execute release, documented in the [weighted DAO guide](docs/WEIGHTED_DAO.md); other weighted DAO writes remain held. The candidature realm is absent on mainnet, so the candidature flow is unavailable there. |
| Community | The mainnet deployment record includes Feed, feedback, reviews, badges and App Store realms. UI exposure also depends on each feature flag and the realm validity check. App Store submission carries a fee and remains separately gated. A published realm alone does not enable a feature. |
| Market and NFT | The Services lane uses the deployed `escrow_v4` realm and also requires `VITE_ENABLE_SERVICES`; its money path has separate safeguards. NFT trading, collection creation, token factory and OTC require realms absent from the mainnet allowlist, so their implemented screens are not live mainnet offerings. The beta NFT window explains this state and links to Market. |
| Arcade | Game code exists, with individual play and certification flags. An on-chain leaderboard or attester deployment does not by itself enable certification. |
| Memba OS | The beta desktop, Aqua window styling and native NFT home are implemented. Native Feed, Live activity, the ticker, guest-access expansion and the About window described in the [roadmap](ROADMAP.md) are further work. |

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
