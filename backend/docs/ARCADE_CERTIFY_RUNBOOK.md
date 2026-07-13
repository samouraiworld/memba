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
(deployer #111) and FROZEN. It's on the deploy manifest (`explicit` lane), so from
`samcrew-deployer/projects/memba/` (after `git pull`):

```bash
MULTISIG_SIGNERS=zooma,adena-zxxma REALM=memba_arcade_leaderboard_v1 ./deploy.sh test13
```

### 2. The attester key ceremony (a NEW dedicated, low-privilege key)

**Never the deploy multisig.** The attester signs board attestations only; if it
leaks, the worst case is forged *board* entries (the realm is funds-free — no
banker, no transfer, no OriginSend), and the owner can `RemoveAttester` it.

1. Generate a fresh key: `gnokey add arcade-attester`. **Record the printed
   mnemonic + address ONCE** — the mnemonic becomes the Fly secret, the address is
   funded + allowlisted.
2. **Fund it** for gas only (a small faucet drip: https://faucet.gno.land).
3. Allowlist it on the realm via the multisig admin script (from `samcrew-deployer/`):
   ```bash
   ./samcrew-arcade-admin.sh add-attester <attester-addr> test13   # verifies IsAttester==true
   ```
4. The mnemonic goes to the Fly secret in step 3 below. The BACKEND process never
   holds a raw secret — only the container's gnokey keyring does (imported at boot).

### 3. Enable the backend (Fly)

The `gnokey@v1.1.0` build stage + the boot-time key import (`start.sh`) + the
ephemeral keyring `HOME` are **already baked into the image** — no Dockerfile edit.
Enabling is just secrets + deploy:

```bash
flyctl secrets set \
  MEMBA_ARCADE_SUBMIT_ENABLED=1 \
  MEMBA_ARCADE_ATTESTER_ENABLED=1 \
  MEMBA_ARCADE_ATTESTER_KEY=arcade-attester \
  ARCADE_ATTESTER_MNEMONIC="<the mnemonic from step 2.1>" \
  -a memba-backend
# MEMBA_ARCADE_REALM defaults to the known path; GNO_CHAIN_ID / GNO_RPC_URL are
# already set. Optional: MEMBA_ARCADE_KEYRING_PW (default "arcade"),
# MEMBA_ARCADE_ATTEST_INTERVAL, MEMBA_ARCADE_ATTEST_MAX_PER_CYCLE.
flyctl deploy -a memba-backend
```

At boot, `start.sh` imports the mnemonic into the keyring (idempotent via
`--force`) and unsets it. Check the boot logs for `arcade attester key … imported`,
`arcade submit endpoint enabled`, and `arcade day-close attester enabled`. Each
feature self-disables with a warning if `node`/`gnokey`/the key/chain are missing —
so a partial config is safe, never a 500.

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
