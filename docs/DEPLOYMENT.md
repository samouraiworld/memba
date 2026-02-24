# Memba — Deployment Guide

## Local Development

### Prerequisites

- Go ≥ 1.23
- Node.js ≥ 20
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
| `VITE_GNO_RPC_URL` | `https://rpc.test11.testnets.gno.land:443` | Gno chain RPC |

### Proto Generation

```bash
buf generate
```

---

## Production

### Frontend — Netlify ✅

**Live at**: https://memba.samourai.app/

| Setting | Value |
|---------|-------|
| Build directory | `frontend` |
| Build command | `npm run build` |
| Publish directory | `frontend/dist` |
| Custom domain | `memba.samourai.app` |

**Netlify environment variables:**
```
VITE_API_URL = https://memba-backend.fly.dev
VITE_GNO_CHAIN_ID = test11
VITE_GNO_RPC_URL = https://rpc.test11.testnets.gno.land:443
```

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
flyctl secrets set CORS_ORIGINS=https://memba.samourai.app
```

> ⚠️ `ED25519_SEED` **must** be set before first production deploy. Without it, all tokens are invalidated on every restart.

### GitHub Secrets (CI/CD)

| Secret | Where | Purpose |
|--------|-------|---------|
| `FLY_API_TOKEN` | Fly.io dashboard | Backend deploy |
| `NETLIFY_AUTH_TOKEN` | Netlify dashboard | Frontend deploy |
| `NETLIFY_SITE_ID` | Netlify dashboard | Site identifier |

---

## Deployment Checklist

- [x] Frontend deployed to Netlify
- [x] Custom domain `memba.samourai.app` configured
- [ ] Backend deployed to Fly.io
- [ ] `ED25519_SEED` secret set
- [ ] `CORS_ORIGINS` secret verified
- [ ] Health check passing: `curl https://memba-backend.fly.dev/health`
- [ ] `VITE_API_URL` set in Netlify env
- [ ] E2E test with samourai-crew multisig
