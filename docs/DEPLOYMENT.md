# Memba — Deployment Guide

## Local Development

### Prerequisites

- Go ≥ 1.26.6
- Node.js ≥ 22
- [Buf CLI](https://buf.build/docs/installation)
- [Adena Wallet](https://adena.app/) browser extension (for signing)

### Backend

```bash
cd backend
go run ./cmd/memba
# → http://localhost:8080/health
```

**Environment variables** (optional):
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP port |
| `DB_PATH` | `./memba.db` | SQLite database path |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `ED25519_SEED` | *(generated)* | 64 hex chars (32 bytes) for persistent auth keypair |

> **Tip:** On first run without `ED25519_SEED`, the server logs the generated seed. Copy it to your env for persistent tokens across restarts.

### Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

**Environment variables** (set in `.env`):
| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `""` (same-origin) | Backend ConnectRPC base URL |
| `VITE_MAINNET_RPC_URL` | `https://rpc.gno.land:443` | Override mainnet's (`gnoland-1`) RPC (same `VITE_<NETWORK>_RPC_URL` pattern per network; retired Pearl keeps `VITE_PEARL_RPC_URL`). Optional — the endpoint is baked into `config.ts`. (There is no `VITE_GNO_RPC_URL`: no code reads it.) |
| `VITE_DAO_REALM_PATH` | `gno.land/r/samcrew/memba_dao` | Canonical Memba dApp DAO realm path on-chain |
| `VITE_GNOLOVE_API_URL` | `https://gnolove-api.samourai.live` | Gnolove Go API (scoreboard, reports, analytics). Hosts outside `TRUSTED_GNOLOVE_API_DOMAINS` are ignored |
| `VITE_GNO_MONITORING_API_URL` | `https://gnomonitoring.samourai.live` | gnomonitoring API (validator monikers, uptime). Hosts outside `TRUSTED_MONITORING_DOMAINS` are ignored |

> **On-chain verification**: Browse deployed Samouraï Coop realms and packages on mainnet at [gno.land/r/samcrew](https://gno.land/r/samcrew) (gno-core's official gnoweb). Pearl (`pearl-1`) was retired on 2026-09-23.
> Note: `samourai_dao` is a separate Samouraï Coop DAO for crew members only — do **not** use it as `VITE_DAO_REALM_PATH`.

### Proto Generation

```bash
buf generate
```

---

## Production

### Frontends — Netlify

The classic application is live at [memba.samourai.app](https://memba.samourai.app/). The separate Memba OS public beta is live at [memba.club](https://memba.club/), opening at `/os`. Each site's public `build-info.json` reports its deployed version and commit. That build record does not establish that all feature flags or on-chain realms are available.

The production beta build sets `VITE_MEMBA_OS=true` and `MEMBA_OS_BETA_SITE=true`. The latter is build-only. An enforced OS build without it fails; development and preview builds can emit OS code with `VITE_MEMBA_OS` alone. A flag-off build must contain no OS assets. The classic site retains its own HTML head, manifest and artwork. Build-time feature flags and chain capability checks still govern individual windows; see the [repository status table](../README.md).

| Setting | Value |
|---------|-------|
| Build directory | `frontend` |
| Build command | `npm run build` |
| Publish directory | `frontend/dist` |
| Custom domains | `memba.samourai.app` (classic); `memba.club` (OS beta, separate site) |

**Netlify environment variables:**
```
VITE_API_URL = https://memba-backend.fly.dev
VITE_GNO_CHAIN_ID = mainnet
VITE_DAO_REALM_PATH = gno.land/r/samcrew/memba_dao
VITE_GITHUB_CLIENT_ID = <GitHub OAuth App Client ID>
VITE_GNOLOVE_API_URL = https://gnolove-api.samourai.live   (optional: this is the default)
VITE_GNO_MONITORING_API_URL = https://gnomonitoring.samourai.live   (optional: this is the default)
VITE_CLERK_PUBLISHABLE_KEY = <Clerk publishable key (pk_live_)>
```

> **Note**: `VITE_GNOLOVE_API_URL` must point to the gnolove Go API server, not a Next.js frontend.
> The former gnolove domain lapsed in 2026-09; both services now live on Samourai hosts under
> `samourai.live`, and `config.ts` ignores an override naming any host outside its allowlists.
> Each API's CORS must allow every Memba origin (`memba.samourai.app`, `memba.club`).
> `VITE_CLERK_PUBLISHABLE_KEY` is shared with the gnolove Clerk app instance.

### Backend — Fly.io

**App**: `memba-backend` | **Region**: `cdg` (Paris) | **Volume**: `memba_data` (1 GB)

```bash
cd backend

# First time setup
flyctl launch            # creates app
flyctl volumes create memba_data --size 1 --region cdg

# Deploy
flyctl deploy

# Verify
curl https://memba-backend.fly.dev/health
```

**Required secrets:**
```bash
# Generate a seed: openssl rand -hex 32
flyctl secrets set ED25519_SEED=<64-hex-chars>
flyctl secrets set CORS_ORIGINS=https://memba.samourai.app,https://memba.club,http://localhost:5173
flyctl secrets set GITHUB_OAUTH_CLIENT_ID=<from GitHub OAuth App>
flyctl secrets set GITHUB_OAUTH_CLIENT_SECRET=<from GitHub OAuth App>
```

> ⚠️ `ED25519_SEED` **must** be set before first production deploy. Without it, all tokens are invalidated on every restart.

### GitHub Secrets (CI/CD)

| Secret | Where | Purpose |
|--------|-------|---------|
| `FLY_API_TOKEN` | Fly.io dashboard | Backend deploy |
| `NETLIFY_AUTH_TOKEN` | Netlify dashboard | Frontend deploy |
| `NETLIFY_SITE_ID` | Netlify dashboard | Site identifier |
| `VITE_GITHUB_CLIENT_ID` | GitHub OAuth App | GitHub OAuth Client ID for frontend build |

---

## Deployment Checklist

- [x] Frontend deployed to Netlify
- [x] Custom domain `memba.samourai.app` configured
- [x] Backend deployed to Fly.io (`memba-backend.fly.dev`)
- [x] `ED25519_SEED` secret set
- [x] `CORS_ORIGINS` secret verified
- [x] Health check passing: `curl https://memba-backend.fly.dev/health`
- [x] `VITE_API_URL` set in Netlify env
- [ ] E2E test with samourai-crew multisig
