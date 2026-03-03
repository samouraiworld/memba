# Memba Frontend

> React + Vite + Vanilla CSS + Kodera design system

## Stack

- **React 19** with TypeScript strict mode
- **Vite 7** for dev server and builds
- **Vanilla CSS** with design tokens
- **Kodera design system** (`k-` prefixed component classes)
- **ConnectRPC** for backend communication
- **React Router v7** for client-side routing
- **Adena wallet** integration for Gno blockchain

## Project Structure

```
src/
├── App.tsx            # Root layout with Suspense + lazy routes
├── main.tsx           # Entry point
├── index.css          # Kodera design system + responsive styles
├── components/        # Reusable UI components
│   ├── ui/            # ErrorToast, LoadingSkeleton, CopyableAddress, etc.
│   └── multisig/      # Multisig-specific components
├── hooks/             # Custom React hooks
│   ├── useAdena.ts    # Adena wallet connection
│   ├── useAuth.ts     # Challenge-response auth
│   ├── useBalance.ts  # GNOT balance queries
│   └── useProfile.ts  # User profile management
├── lib/               # Core business logic (no React)
│   ├── config.ts      # Centralized env config
│   ├── api.ts         # ConnectRPC client setup
│   ├── dao.ts         # DAO ABCI parsers (members, proposals, config)
│   ├── daoTemplate.ts # DAO Factory code generators
│   ├── daoSlug.ts     # DAO realm path encoding
│   ├── grc20.ts       # GRC20 token queries + broadcasting
│   ├── parseMsgs.ts   # Transaction message parser
│   ├── profile.ts     # Profile data fetching + merging
│   └── account.ts     # Account utilities
├── pages/             # Route pages (20 pages, lazy-loaded)
├── types/             # TypeScript type definitions
└── gen/               # Auto-generated protobuf types
```

## Development

```bash
npm install
npm run dev      # Dev server at localhost:5173
npm run build    # Production build (tsc + vite build)
npm run lint     # ESLint check
```

## Design System

The **Kodera design system** uses Vanilla CSS with design tokens and custom component classes:

| Class | Description |
|-------|-------------|
| `k-card` | Card container with border + hover |
| `k-btn-primary` | Cyan accent primary button |
| `k-btn-secondary` | Transparent bordered button |
| `k-btn-wallet` | Wallet address display button |
| `k-dashed` | Dashed border container |
| `k-label` | Uppercase mono label |
| `k-value` | Large mono stat value |
| `animate-fade-in` | Entrance animation |
| `animate-slide-up` | Slide-up animation |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | (empty = Vite proxy) |
| `VITE_GNO_CHAIN_ID` | Gno chain ID | `test11` |
| `VITE_GNO_RPC_URL` | Gno RPC endpoint | testnet RPC |
| `VITE_GITHUB_CLIENT_ID` | GitHub OAuth Client ID | — |
| `VITE_DAO_REALM_PATH` | DAO realm path | `gno.land/r/samcrew/samourai_dao` |
| `VITE_GNOLOVE_API_URL` | Gnolove API URL | `https://gnolove.world` |
