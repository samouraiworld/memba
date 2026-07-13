# BARRICADE on-chain certify — go-live ceremony runbook

This is the OWNER-GATED procedure to take the BARRICADE certify pipeline from
"dark" (all code merged, nothing enabled) to a live pre-mainnet beta on test13.
Everything below is off/404/dormant until these steps run. Do them in order.

## The pipeline (what's already merged, all dark)

```
 play (no wallet)                     ┌─────────────── on-chain ───────────────┐
   │  the input log IS the run        │                                          │
   ▼                                  │   realm memba_arcade_leaderboard_v1      │
 Certify (opt-in, wallet)  ──POST──▶  backend  ──gnokey──▶  AttestScore(best per │
   VITE_ENABLE_BARRICADE_CERTIFY      /api/arcade/submit      addr, per closed    │
                                       MEMBA_ARCADE_SUBMIT_    day)                │
                                       ENABLED                                     │
                                          │  re-simulate (node verify worker)      │
                                          │  = the ONLY source of truth            │
                                          ▼                                        │
                                       store 'verified'  ──day-close batcher──▶ attest │
                                                          MEMBA_ARCADE_ATTESTER_ENABLED │
                                                                                   └────┘
```

- **Verify worker** (#923): re-simulates a submitted input log; the attester only
  ever writes a reproduced result. One implementation (the frontend sim, bundled).
- **Submit endpoint** (#925): `POST /api/arcade/submit`, auth-bound, claim-must-match.
- **Day-close attester** (#929): writes each wallet's best verified run per closed
  day to the realm's competitive board, attester-pays via a dedicated gnokey key.
- **Certify UI** (#931): the opt-in poster action + the read-only board client.

## Owner-gated steps (nothing here is automated)

### 1. Deploy the realm (test13)

The realm `memba_arcade_leaderboard_v1` is source-only in `samcrew-deployer`
(deployer #111) and FROZEN. Deploy it to test13 through the normal deployer
ceremony (multisig `samcrew-core-test1`, 2-of-2). Record its package path
(default `gno.land/r/samcrew/memba_arcade_leaderboard_v1`).

### 2. The attester key ceremony (a NEW dedicated, low-privilege key)

**Never the deploy multisig.** The attester signs board attestations only; if it
leaks, the worst case is forged *board* entries (the realm is funds-free — no
banker, no transfer, no OriginSend), and the owner can `RemoveAttester` it.

1. Generate a fresh key in a gnokey keyring:
   `gnokey add arcade-attester` (or `add -recover` from a stored mnemonic).
   Note its bech32 address.
2. **Fund it** for gas only (a small faucet drip on test13).
3. Allowlist it on the realm, signed by the owner multisig:
   `AddAttester("<attester-addr>")`.
4. Keep the mnemonic in the operator secret store (see step 3). The BACKEND
   process never holds a raw secret — only the gnokey keyring does.

### 3. Enable the backend (Fly)

1. **Add gnokey to the runtime image.** `gnokey` has no apk package; add a build
   stage to `backend/Dockerfile` and copy the binary into the runtime stage
   (pin the same version as the deployer toolchain, gnokey@v1.1.0):
   ```dockerfile
   FROM golang:1.25.12-alpine AS gnokey
   RUN apk add --no-cache git && go install github.com/gnolang/gno/gno.land/cmd/gnokey@v1.1.0
   # …in the runtime stage:
   COPY --from=gnokey /go/bin/gnokey /usr/local/bin/gnokey
   ```
   node is already in the runtime image (the verify worker needs it).
2. **Import the attester key into the container's keyring at startup** (e.g. a
   `start.sh` step: `gnokey add -recover -insecure-password-stdin arcade-attester`
   fed from a Fly secret mnemonic), or bake a keyring the container reads.
3. **Set the Fly secrets/env:**
   ```
   flyctl secrets set \
     MEMBA_ARCADE_SUBMIT_ENABLED=1 \
     MEMBA_ARCADE_ATTESTER_ENABLED=1 \
     MEMBA_ARCADE_ATTESTER_KEY=arcade-attester \
     -a memba-backend
   # MEMBA_ARCADE_REALM defaults to the known path; GNO_CHAIN_ID / GNO_RPC_URL
   # are already set. Optional: MEMBA_ARCADE_ATTEST_INTERVAL, *_MAX_PER_CYCLE.
   ```
   Both features self-disable with a warning if `node`/`gnokey` are missing or a
   required var is empty — check the boot logs for "arcade submit endpoint
   enabled" and "arcade day-close attester enabled".
4. Deploy. (Rolling deploy; the submit endpoint and attester come up dark→live.)

### 4. Enable the frontend (Netlify)

Set the build env and redeploy (Netlify-native build, `netlify.toml`):
```
VITE_ENABLE_BARRICADE=true          # the game itself (the flag-on playtest gate)
VITE_ENABLE_BARRICADE_CERTIFY=true  # the Certify action + board client
```
Neither is in `SAFETY_GATED_FLAGS` (no funds move), so `assertSafeFlags` won't
fail the build.

### 5. Verify the loop (test13)

1. Play a daily run to a verified result → tap **Certify on-chain** → sign in →
   the poster shows "Certified on-chain ✓".
2. Backend: the run is stored `verified` (check `/metrics` / logs).
3. Wait until the day is fully closed (D+2 UTC) — or, for a smoke test, temporarily
   submit for a seed whose day is already ≥2 days old is NOT possible (the submit
   endpoint only accepts today/yesterday), so verify the batcher on a naturally
   closed day, or run the day-close manually once against a staged DB.
4. The day-close batcher attests the day's best-per-wallet runs; the run flips to
   `attested` with a tx hash. The realm's `GetBoardJSON(day, …)` (and the board
   view) then shows the entry.

The `internal/arcade` package's `TestArcadeLoop_SubmitVerifyStoreAttest` runs this
whole loop (real node verify worker + fake broadcaster, injected clocks) in CI, so
the wiring is proven before any ceremony.

## Disable / rollback

- **Frontend:** unset `VITE_ENABLE_BARRICADE_CERTIFY` (Netlify), redeploy → the
  Certify action disappears; play is unaffected.
- **Backend:** unset `MEMBA_ARCADE_SUBMIT_ENABLED` → submit 404s; unset
  `MEMBA_ARCADE_ATTESTER_ENABLED` → the attester stops. Deploy.
- **Realm:** `Pause(true)` freezes all attestation (reads stay live);
  `RemoveAttester` revokes the key.
- A run parked `errored` (too many transient attest failures) can be requeued by
  flipping its `arcade_runs.status` back to `verified`.

## Deferred (v1-optional, not built)

- The **player-paid `RequestReceipt`** leg + practice-receipt attestation. The beta
  ships attester-pays for the competitive daily board; player-paid receipts land
  when mainnet gas matters (design §2). The realm already exposes `RequestReceipt`.
- The standalone **board view page** + **Endless/Siege mode** shell (the board is
  the differentiator; the `arcade.ts` `getBoard` reader is ready).
- **Season-boundary `SIM_VERSION` cutover** — bumping the sim's version when a v2
  season closes so old attestations stay verifiable under their frozen build.
- The **mainnet** Genesis drop plan (waits on the test13 beta).
