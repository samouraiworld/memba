# Secrets Rotation Runbook

> Emergency and scheduled procedures for rotating sensitive credentials.
> All secrets are stored as Fly.io secrets (never committed to git).

---

## ED25519_SEED (Auth Token Signing)

**Impact of compromise:** Attacker can forge auth tokens for any user.
**Impact of rotation:** ALL existing user sessions are invalidated immediately.

### Scheduled Rotation

```bash
# 1. Generate new 32-byte seed
NEW_SEED=$(openssl rand -hex 32)

# 2. Set the new secret on Fly.io (triggers redeploy)
flyctl secrets set ED25519_SEED=$NEW_SEED --app memba-backend

# 3. Verify the backend restarted successfully
flyctl status --app memba-backend

# 4. Verify health check
curl -s https://memba-backend.fly.dev/health | jq .status
```

### Emergency Rotation (Key Compromised)

1. **Immediately** rotate the seed (steps 1-2 above)
2. Check Fly.io logs for suspicious auth patterns:
   ```bash
   flyctl logs --app memba-backend | grep "GetToken called" | tail -50
   ```
3. Audit recent profile changes and multisig operations
4. Notify users via Discord/Telegram that sessions have been reset

---

## LIGHTHOUSE_API_KEY (IPFS Avatar Upload)

**Impact of compromise:** Attacker can upload arbitrary content to IPFS via your API quota.
**Impact of rotation:** No user-facing impact (new uploads use new key, old CIDs remain valid).

```bash
# 1. Generate new key at https://lighthouse.storage/dashboard
# 2. Set the new secret
flyctl secrets set LIGHTHOUSE_API_KEY=<new-key> --app memba-backend
# 3. Verify avatar upload works
curl -s -X POST https://memba-backend.fly.dev/api/upload/avatar \
  -H "Authorization: Bearer <valid-token>" \
  -F "file=@test.png"
```

---

## LLM Provider API Keys (DAO Analyst)

Keys: `GROQ_API_KEY`, `GOOGLE_AI_KEY`, `TOGETHER_API_KEY`, `OPENROUTER_API_KEY`

**Impact of compromise:** Attacker can use your LLM quota. No access to user data.
**Impact of rotation:** No user-facing impact (cached reports remain valid for 6h).

```bash
# Rotate any/all provider keys
flyctl secrets set GROQ_API_KEY=<new> GOOGLE_AI_KEY=<new> --app memba-backend
```

---

## CLERK_SECRET_KEY (Alerts Section Auth)

**Impact of compromise:** Attacker can forge Clerk sessions for the /alerts section.
**Impact of rotation:** Users on /alerts must re-authenticate.

```bash
# 1. Rotate in Clerk dashboard: https://dashboard.clerk.com
# 2. Update Fly.io secret
flyctl secrets set CLERK_SECRET_KEY=<new> --app memba-backend
# 3. Update frontend publishable key if changed
# (stored in VITE_CLERK_PUBLISHABLE_KEY on Netlify)
```

---

## GITHUB_CLIENT_SECRET (OAuth Identity Verification)

**Impact of compromise:** Attacker can exchange OAuth codes for GitHub access tokens.
**Impact of rotation:** Users must re-link their GitHub identity.

```bash
# 1. Rotate in GitHub OAuth App settings
# 2. Update Fly.io secret
flyctl secrets set GITHUB_CLIENT_SECRET=<new> --app memba-backend
```

---

## Rotation Schedule

| Secret | Rotation Frequency | Trigger |
|--------|-------------------|---------|
| ED25519_SEED | On compromise only | Key leak, suspicious auth activity |
| LIGHTHOUSE_API_KEY | Annually or on compromise | Quota abuse, key exposure |
| LLM API Keys | Annually or on compromise | Quota abuse, key exposure |
| CLERK_SECRET_KEY | Annually or on compromise | Per Clerk recommendation |
| GITHUB_CLIENT_SECRET | Annually or on compromise | Per GitHub recommendation |

---

## CSRF Protection

ConnectRPC endpoints are protected against CSRF by the content-type requirement:
- ConnectRPC requires `Content-Type: application/proto` or `application/json`
- Browsers enforce that cross-origin `<form>` submissions use `application/x-www-form-urlencoded` or `multipart/form-data`
- Simple CORS requests cannot set custom content types
- Therefore, ConnectRPC's content-type requirement provides implicit CSRF protection

REST endpoints (`/api/render`, `/api/balance`, `/api/marketplace/*`) are read-only (GET) and don't require CSRF tokens.
Authenticated REST endpoints (`/api/upload/avatar`, `/api/analyst/analyze`) require the auth token in the Authorization header, which provides sufficient anti-CSRF protection.

---

*Last updated: 2026-04-16 (v6 Phase 1a)*
