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

## Clerk keys (Alerts sign-in)

The Memba backend holds no Clerk secret. Validator alerts (Memba OS Settings → Notifications; the classic `/alerts` page) sign in with Clerk in the browser, and gnomonitoring checks the session token with its own Clerk secret key (`clerk_secret_key` in its server config).

**Impact of compromise:** Attacker can forge Clerk sessions for validator alerts (gnomonitoring webhooks).
**Impact of rotation:** Users of validator alerts must sign in again.

```bash
# 1. Rotate in the Clerk dashboard: https://dashboard.clerk.com
# 2. Put the new secret key in gnomonitoring's server config and restart it
# 3. If the publishable key changed, update VITE_CLERK_PUBLISHABLE_KEY on Netlify and redeploy
```

---

## GITHUB_OAUTH_CLIENT_SECRET (OAuth Identity Verification)

**Impact of compromise:** Attacker can exchange OAuth codes for GitHub access tokens.
**Impact of rotation:** Linking a GitHub account fails until the new secret is set. Accounts already linked stay linked (the backend keeps no GitHub token).

```bash
# 1. Rotate in GitHub OAuth App settings
# 2. Update Fly.io secret
flyctl secrets set GITHUB_OAUTH_CLIENT_SECRET=<new> --app memba-backend
```

---

## MEMBA_CURATION_INBOX_KEY (Private Curation Inbox)

**Impact of compromise:** Together with a copy of the database, an attacker can read every private founder/manager message. The key alone, or the database alone, reveals no message text.
**Impact of rotation:** **Do not rotate.** Every stored message is sealed under this key and nothing re-seals them: after a change they are served as `unreadable` for good.
**Custody:** two copies, the Fly secret and an entry in the owner's password manager. Losing both loses every stored message: a copy of the database does not help.

Set it once, before the inbox is first used:

```bash
# 0. If this backend accepted unsigned logins (MEMBA_ALLOW_UNSIGNED_AUTH=1/true)
#    at any time in the last 24 h, wait until 24 h have passed since enforcement,
#    or rotate ED25519_SEED (above): a session obtained without a signature stays
#    valid for 24 h and would open the inbox. The same holds after a lockout
#    rollback (OPS_RUNBOOK §2.1).

# 1. Generate the key
KEY=$(openssl rand -hex 32)

# 2. Save it in the owner's password manager FIRST, and check the saved entry
#    equals $KEY. Until then nobody holds the key but this shell.

# 3. Set the secret (triggers redeploy)
flyctl secrets set MEMBA_CURATION_INBOX_KEY=$KEY --app memba-backend
unset KEY
```

- Each boot logs `curation inbox enabled` with `key_id`, a fingerprint of the key (never the key); note it next to the saved entry. A `key_id` that differs from the previous boot means the key was changed: set the saved value back before anyone sends a message.
- On compromise there is no rotation at this head: unset the secret to turn the inbox off (503), and treat the stored messages as disclosed. The stored rows stay in the database until they are 12 months old: the retention sweep deletes them whether or not the key is set. After deletion their sealed bodies can remain up to 7 days in the Litestream WAL backups and in SQLite free pages: treat those as holding the same disclosed messages.

---

## Rotation Schedule

| Secret | Rotation Frequency | Trigger |
|--------|-------------------|---------|
| ED25519_SEED | On compromise only | Key leak, suspicious auth activity |
| LIGHTHOUSE_API_KEY | Annually or on compromise | Quota abuse, key exposure |
| LLM API Keys | Annually or on compromise | Quota abuse, key exposure |
| Clerk secret key (gnomonitoring) | Annually or on compromise | Per Clerk recommendation |
| GITHUB_OAUTH_CLIENT_SECRET | Annually or on compromise | Per GitHub recommendation |
| MEMBA_CURATION_INBOX_KEY | Never (stored messages become unreadable) | On compromise: unset to turn the inbox off |

---

## CSRF Protection

ConnectRPC endpoints are protected against CSRF by the content-type requirement:
- ConnectRPC requires `Content-Type: application/proto` or `application/json`
- Browsers enforce that cross-origin `<form>` submissions use `application/x-www-form-urlencoded` or `multipart/form-data`
- Simple CORS requests cannot set custom content types
- Therefore, ConnectRPC's content-type requirement provides implicit CSRF protection

REST endpoints (`/api/render`, `/api/marketplace/agents`) are read-only (GET) and don't require CSRF tokens.
Authenticated REST endpoints (`/api/upload/avatar`, `/api/upload/image`, `/api/upload/curation-evidence`, `POST /api/analyst/consensus`) require the auth token (or, for the analyst, the operator bearer) in the Authorization header, which provides sufficient anti-CSRF protection.

---

*Last updated: 2026-04-16 (v6 Phase 1a)*
