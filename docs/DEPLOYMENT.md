# Memba — Deployment Guide

## Local Development

### Prerequisites

- Go ≥ 1.23
- Node.js ≥ 20
- [Buf CLI](https://buf.build/docs/installation)

### Backend

```bash
cd backend
cp ../.env.example .env  # edit as needed
go run ./cmd/memba
# → http://localhost:8080/health
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### Proto Generation

```bash
make proto-gen
```

## Production

### Backend — Fly.io

```bash
cd backend
flyctl launch            # first time
flyctl volumes create memba_data --size 1 --region cdg
flyctl deploy
```

**Required secrets:**
```bash
flyctl secrets set CORS_ORIGINS=https://memba.samourai.app
```

### Frontend — Netlify

1. Connect repo to Netlify
2. Set build directory: `frontend`
3. Set build command: `npm run build`
4. Set publish directory: `frontend/dist`
5. Set environment variables:
   - `VITE_API_URL` = backend URL
   - `VITE_GNO_CHAIN_ID` = `test11`
   - `VITE_GNO_RPC_URL` = `https://rpc.test11.testnets.gno.land:443`
6. Set custom domain: `memba.samourai.app`

### GitHub Secrets Required

| Secret | Where | Purpose |
|--------|-------|---------|
| `FLY_API_TOKEN` | Fly.io dashboard | Backend deploy |
| `NETLIFY_AUTH_TOKEN` | Netlify dashboard | Frontend deploy |
| `NETLIFY_SITE_ID` | Netlify dashboard | Site identifier |
| `VITE_API_URL` | - | Backend API URL |

## Environment Variables

See [.env.example](../.env.example) for the full list.
