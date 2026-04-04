# Memba メンバー

> Gno-native multisig wallet & DAO governance application.

[![CI](https://github.com/samouraiworld/memba/actions/workflows/ci.yml/badge.svg)](https://github.com/samouraiworld/memba/actions/workflows/ci.yml)
[![Security](https://github.com/samouraiworld/memba/actions/workflows/codeql.yml/badge.svg)](https://github.com/samouraiworld/memba/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-22-green.svg)](https://nodejs.org)
[![Go](https://img.shields.io/badge/Go-≥1.25-00ADD8.svg)](https://go.dev)
[![Tests](https://img.shields.io/badge/Tests-1467%2B%20passing-brightgreen.svg)](#testing)

> ⚠️ **Alpha Software** — Memba is experimental, unaudited, and under active development. See [DISCLAIMER.md](DISCLAIMER.md).

**Memba** is a standalone web application for managing multisig wallets and DAO governance on the [Gno](https://gno.land) blockchain. Built by [Samouraï Coop](https://www.samourai.world).

**🌐 Live:** [memba.samourai.app](https://memba.samourai.app)

## Features (v3.1)

### Multisig
- 🔑 Create & import multisig wallets
- 💼 Adena wallet connection (dApp mode)
- 💰 GNOT balance display (live via ABCI query)
- 📝 Propose GNOT send & contract call transactions
- ✍️ Sign with Adena or paste gnokey signatures (air-gapped)
- 📊 Signature tracking + threshold progress
- 📡 Combine signatures + broadcast to chain
- 🔗 Shareable import links for 1-click onboarding
- 🔍 Auto-detect multisig membership with 1-click join
- ✏️ Inline multisig rename (per-user, backend-persisted)

### DAO Governance
- 🏛️ Multi-DAO hub — proposals, voting, execution, member management
- 🏗️ DAO Factory — 4 presets (Basic, Team, Treasury, Enterprise)
- 🎭 Roles — admin, dev, finance, ops, member + role management
- 📊 Quorum — configurable minimum participation %
- 📁 Proposal Categories — governance, treasury, membership, operations
- 📊 **SingleVoteBar** — participation % (green YES / red NO split) + tier pie chart
- 📊 **Quorum threshold** — 50% marker with amber/teal participation indicator
- 🗄️ Archive DAO — admin-only archival for obsolete DAOs
- 💰 Treasury Management (asset overview, spending proposals)
- 🔴 LIVE auto-refresh for active proposals (30s polling)
- 📂 **Organization Directory** — discover DAOs, tokens, and users with rich metadata
  - Featured DAOs carousel, DAO Render parsing (members, proposals, description)
  - Save-to-Memba buttons, search/filter, premium glassmorphism UI
- 🗳️ "Needs My Vote" filter tabs for DAO members
- ✅ Vote status badges + auto-hide buttons after voting
- 🔴 Unvoted proposal notification dot (pulsing red badge on DAO nav)
- 🏥 **DAO Health Score** — composite A/B/C/D grade badge (participation, backlog, activity)
- 📦 **Proposal Action Metadata** — action type, body, executor realm on ProposalView
- 🏷️ **Category Badges** — parsed proposal categories displayed in header
- ⚡ **Inline EXECUTE Badges** — passed proposals show inline action indicator

### Validators & Monitoring
- 📊 **Validator Dashboard** — 20+ validators with voting power, rank, search, pagination
- 🏷️ **Monikers** — human-readable names from gnomonitoring API (pending CORS unlock)
- ⬆️ **Uptime & Participation** — live metrics from monitoring service
- 🔄 **hexToBech32** — Tendermint hex → `g1...` bech32 address derivation
- 📈 Network stats cards (Block Height, Avg Block Time, Active Validators, Total Voting Power)
- 🕵️ **Hacker View** — gnockpit-parity+ telemetry dashboard with:
  - Per-validator health grid (health badge, participation %, uptime %, missed blocks, TX contribution)
  - Live consensus round age counter (green/yellow/red severity)
  - RPC status badges + "only validators" peer filter
  - Network Health Banner (✅🟡🔴⚪ counts)
  - Incident polling (30s) + monitoring refresh (60s)
  - Session age, DoctorPanel diagnostics, NodeStatePanel identity

### Professional Alerting (v2.18)
- 🔔 **Alerts Page** — `/alerts` route with 3-section accordion (Webhooks, Contacts & Schedule, Telegram)
- 🔑 **Clerk Auth** — secondary auth layer scoped to alerting (independent from Adena wallet)
- 🪝 **Webhook CRUD** — Discord & Slack webhooks for GovDAO and Validator monitoring
- 👤 **Alert Contacts** — link validator monikers to Discord/Slack mention tags
- 📋 **Daily Reports** — configurable hour/minute/timezone with auto-detect
- ✈️ **Telegram Bots** — onboarding cards for `@govdao_activities_bot` & `@gno_validators_bot`
- 🛡️ **Bundle Isolation** — Clerk SDK (~45KB) lazy-loaded, zero impact on non-alerts pages

### Gnolove — Contributor Analytics (v2.19)
- 💚 **Scoreboard** — contributor leaderboard with time filters, core team exclusion, sortable columns
- 🏆 **Team Cards** — CSS Grid team breakdown with ranked scores
- 📋 **Weekly Report** — PR status report with week navigation and 5 status tabs
- 📈 **Analytics** — Recharts visualizations: team bar charts, contribution pie chart, 9 stat cards
- 🗺️ **Sub-Navigation** — Scoreboard / Report / Analytics tab navigation
- ❓ **Help Wanted Issues** — bounty/help-wanted issues from the Gno ecosystem
- 🔀 **Freshly Merged PRs** — latest merged pull requests feed
- 📦 **Tracked Repositories** — repository overview with branch info
- 🛡️ **Bundle Isolation** — entire section lazy-loaded, zero main bundle impact (+1KB)
- 🔒 **Zod Validation** — 25+ runtime schemas at the API boundary

### Token Launchpad
- 🪙 GRC20 Token Launchpad (create, mint, burn, transfer, faucet)
- 💎 2.5% platform fee on mints (supports Samouraï Coop)
- 🏛️ Multisig admin governance for GRC20 tokens

### NFT Marketplace & Launchpad (v3.1)
- 🎨 **NFT Gallery** — browse GRC721 collections, view metadata, explore by realm path
- 🏪 **NFT Marketplace** — active listings with Buy Now + Make Offer actions
- 📊 **Activity Feed** — recent sales from on-chain marketplace Render()
- 🚀 **NFT Launchpad** — 5-step wizard to deploy GRC721 (1-of-1) or GRC1155 (editions) collections
- 💰 **Buy/Sell Modals** — price breakdown (price + 2.5% platform fee + seller receives)
- 🤝 **Offer System** — escrow-backed offers with 7-day timeout safety valve
- 📦 **GRC1155 Templates** — multi-token editions with per-token supply caps, URI metadata
- 🔐 **Self-contained code generation** — templates deploy on any network without external dependencies
- 🏷️ Feature-gated behind `VITE_ENABLE_NFT`

### User Profiles
- 👤 User profiles (bio, social links, contributions, deployed packages)
- 📛 Username registration via network-aware user registry (`getUserRegistryPath()`)
- 🔗 GitHub OAuth identity verification
- 📊 Gnolove contribution stats (commits, PRs, issues, reviews)
- 🔀 User redirect (`/u/username` → `/profile/address`)
- 🗳️ "My Votes" — cross-DAO vote history on user profile
- 🏛️ DAO Memberships — saved DAO list on profile with navigation
- 🖼️ Avatar Upload — URL + file picker (JPEG/PNG/WebP/GIF, 2MB max)
- 🔔 **Notification Center** — bell icon, 30s ABCI polling, per-wallet isolation, grouped by date
- ⚡ **Validator Dashboard** — network stats, voting power distribution, sortable table, pagination
- 💧 **Faucet Card** — gasless onboarding with dismiss button, "TESTNET ONLY" badge

### Extensions & Navigation
- 🧩 **Extensions Hub** — dedicated `/extensions` page with status badges (Active/Coming Soon)
- ⌘K **Command Palette** — 14 navigation commands, fuzzy search, keyboard shortcuts

### Channels & Communication
- 💬 **Channel Pages** — standalone `/dao/:slug/channels` route with sidebar, breadcrumb nav
- 🔄 **Real-time UX** — 10s polling, Page Visibility API pause, "New messages" toast
- 🔊 **Voice Channels** — Jitsi Meet iframe embed, "Join Room" gate
- 🎥 **Video Channels** — Jitsi Meet with camera, deterministic room names
- 🧵 **Thread Types** — text (💬), announcements (📢), readonly (🔒), voice (🔊), video (🎥)
- 🎙️ **PiP Portal** — Jitsi sessions persist across route navigation (draggable mini-player)
- 🔊 **Default DAO Rooms** — auto Public/Members rooms for all DAOs

### Landing & Stats
- 🎬 **Creative Landing** — 6 Remotion animated feature showcases
- 📊 **Live ABCI Stats** — real-time block height, validators, chain ID on landing page (30s polling)

### Navigation & Layout
- 📐 **Sidebar Navigation** — Vercel-inspired 3-section sidebar (Navigation, Plugins, User)
- 📱 **Mobile Tab Bar** — 5-tab bottom navigation (Home, DAOs, Tokens, Directory, More)
- 📋 **Bottom Sheet** — Slide-up modal for mobile overflow menu
- 🔒 **TopBar** — Alpha/v2 badges, network selector, wallet status, security banners
- ♿ **Skip-to-content** — Accessibility link (focus-only)

### Security & Infrastructure
- 🔐 Challenge-response auth (ed25519, ADR-036)
- 🛡️ RPC domain validation — blocks writes through untrusted RPCs
- 🔒 **Content Security Policy** — CSP meta tag restricting script/style/connect/frame origins
- ⚡ Adena reconnect optimization (5s polling, `GetNetwork()` cached)
- 🏠 **Dashboard guard** — hidden when disconnected, auto-redirect to landing
- 🌐 Network selector (test12 ↔ test11 ↔ staging ↔ portal-loop ↔ gnoland1) with chain mismatch detection
- 📱 Mobile responsive (375px+) with sidebar collapse at 1024px, tab bar below 768px
- ⚡ Code splitting (496KB main, 145KB gzip, lazy-loaded DAO/token/directory/channel/NFT chunks)
- 🪲 **Sentry** — Error monitoring with PII scrubbing (self-hosted at sentry.samourai.pro)
- 🐳 Docker Compose self-hosting
- 🚀 CI/CD: GitHub Actions (Node 22) + Netlify + Fly.io

### Testing
- 🧪 **1,467+ unit tests** (Vitest, 67 files) — ABCI parsers, code generators, template sanitizer, gnoweb namespace explorer, profile logic, balance formatting, RPC domain validation, write guard, plugins, notifications, validators, directory, channels, DAO metadata, gas config, error messages, gnomonitoring, validator health engine, gnolove filters, chain health, NFT marketplace parsers, GRC1155 templates, block time estimation, integration tests
- 🧪 **E2E tests** (Playwright, Chromium, 16 spec files) — navigation, smoke, plugins, DAO, profile, token, multisig, settings, create-dao, treasury, validators, directory, extensions, cmd-k, channels, gnolove

## Architecture

```
frontend/   → React + Vite + Vanilla CSS + Kodera design system (Netlify)
backend/    → Go + ConnectRPC + SQLite (Fly.io)
api/        → Protobuf service definitions (Buf)
contracts/  → Gno realms (future)
docs/       → Architecture, API, deployment docs
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

### Plugin Architecture (v2.0)

Memba uses a modular plugin system for extensible DAO features:

```
src/plugins/
├── registry.ts        # Plugin registry (frozen after init)
├── types.ts           # PluginProps interface
├── styles.ts          # Shared plugin styles
├── PluginLoader.tsx   # Lazy-loading error boundary
├── board/             # 💬 Discussion board (ABCI parser)
├── gnoswap/           # 🔄 GnoSwap DEX integration
├── leaderboard/       # 🏆 Member ranking
└── proposals/         # 📋 Proposal Explorer (search, filter, sort, paginate)
```

Each plugin follows: `index.tsx` (entry) → `*View.tsx` (UI) → `queries.ts`/`builders.ts` (logic).

**Extensions in CreateDAO:** The wizard's Step 4 lets users enable plugins during DAO creation. When Board is enabled, a companion board realm is deployed alongside the DAO in a chained transaction.

## Quick Start

### Prerequisites

- Go ≥ 1.25
- Node.js ≥ 22
- [Buf CLI](https://buf.build/docs/installation)
- [Adena Wallet](https://adena.app) browser extension

### Development

```bash
# Backend
cd backend && go run ./cmd/memba

# Frontend
cd frontend && npm install && npm run dev

# Proto generation
make proto-gen
```

### Testing

```bash
# Frontend unit tests (Vitest)
cd frontend && npm test

# Frontend E2E smoke tests (Playwright)
cd frontend && npx playwright test

# Backend tests
cd backend && go test -race -count=1 -cover ./...
```

## Chain

| Network | RPC | Chain ID |
|---------|-----|----------|
| test12 ⭐ | `https://rpc.testnet12.samourai.live:443` | `test12` |
| test11 (legacy) | `https://rpc.test11.testnets.gno.land:443` | `test11` |
| portal-loop | `https://rpc.gno.land:443` | `portal-loop` |
| staging | `https://rpc.gno.land:443` | `staging` |
| gnoland1 (Betanet) | `https://rpc.gnoland1.samourai.live:443` | `gnoland1` |

## Target Multisig

samourai-crew 3-of-7: `g10kw7e55e9wc8j8v6904ck29dqwr9fm9u280juh`

## Links

- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Disclaimer](DISCLAIMER.md)

## Contributors

Built by the [Samouraï Coop](https://www.samourai.world) team.

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) © 2026 Samouraï Coop
