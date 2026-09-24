# Arcade on-chain certify — go-live ceremony runbook (multi-game)

> **Mainnet (`gnoland-1`): follow [Mainnet go-live](#mainnet-go-live-gnoland-1-owner-ruling-o5).** The numbered steps under [Pearl-era steps](#pearl-era-steps-historical) target `pearl-1`, which was retired on 2026-09-23. They are kept as history. Do not run them against mainnet.

This is the OWNER-GATED procedure to take the arcade certify pipeline from
"dark" (all code merged, nothing enabled) to live. It was first written for a
pre-mainnet beta on **pearl-1**. The pipeline is multi-game since 2026-09-01 (realm amended in
place pre-first-deploy; `MEMBA_ARCADE_GAMES` picks which games accept
submissions — the launch recommendation is `invaders` while BARRICADE stays
parked post-mainnet). Everything below is off/404/dormant until these steps
run. Do them in order.

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

## Mainnet go-live (`gnoland-1`, owner ruling O5)

Nothing here is automated, and **no code changes**. `verify.ts` and `replay.ts`
are a FROZEN CONTRACT: going live on mainnet is configuration plus one publisher
transaction. Do **M3 before the DAO handoff**; after it, `AddAttester` costs a
DAO vote.

### State on 2026-09-24

- **Realm:** `gno.land/r/samcrew/memba_arcade_leaderboard_v1` is published on
  `gnoland-1` (height 265720, `realm-versions.json` `mainnet`). A read-only
  probe returned `GetOwner()` = the samcrew 2-of-3
  `g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf`, `IsPaused()` = `false`, and **no
  attester registered**.
- **Fly `memba-backend`:** `ARCADE_ATTESTER_MNEMONIC`,
  `MEMBA_ARCADE_ATTESTER_ENABLED`, `MEMBA_ARCADE_ATTESTER_KEY` and
  `MEMBA_ARCADE_SUBMIT_ENABLED` are present. That is a names-only
  `fly secrets list`; the values were not read. They date from the **Pearl
  beta**. The attester broadcasts to `GNO_CHAIN_ID`, which is now `gnoland-1`,
  so if they are on, the batcher signs mainnet `AttestScore` calls with the
  Pearl key. That key is not an attester there, so every attestation fails and
  the runs park `errored`. `MEMBA_ARCADE_GAMES` is unset, which means
  `barricade` only.
  **Owner check:** read the boot log line `arcade day-close attester enabled`
  (it prints `chainID`). Until M4 lands, either unset
  `MEMBA_ARCADE_ATTESTER_ENABLED` or accept the parked runs.
- **Frontend:** `memba_arcade_leaderboard_v1` is deliberately absent from
  `REALM_ALLOWLIST.mainnet` ("no attester"). The certify flags are off.

### M1. Generate a NEW mainnet attester key (owner's machine)

Use a dedicated, low-privilege key made only for mainnet. It is **never** the
Pearl key and **never** a deploy or namespace multisig member. If it leaks, the
worst case is forged board entries. The realm holds no funds, and the owner can
`RemoveAttester` the key.

```bash
gnokey add memba-arcade-attester-gnoland-1   # record the mnemonic + address ONCE, offline
```

The mnemonic becomes a Fly secret (M4). The address gets funded (M2) and
allowlisted (M3). For M4, keep the mnemonic on a single line in a mode-0600 file
(for example `~/secure/memba-arcade-attester-gnoland-1.mnemonic`), stored
offline per `docs/SECRETS_ROTATION.md`.

### M2. Fund the attester

Each attestation is one `AttestScore` tx, and the attester key pays two things
for it:

1. **The gas fee.** At boot the backend reads `auth/gasprice` from the RPC
   (after checking `node_info.network` equals `GNO_CHAIN_ID`) and sets
   `-gas-fee` to twice the minimum that price demands for `-gas-wanted`. If the
   read fails, it uses gnoland-1's launch price, 1ugnot per 1000 gas. With the
   default `-gas-wanted 50000000`, that is **100000ugnot (0.1 GNOT) per tx**.
   The chain charges the whole fee, not the gas used. The boot line
   `arcade day-close attester enabled` prints `gasWanted`, `gasFeeUgnot` and
   `feeSource` (`gasprice`, `fallback` or `env`).
2. **The storage deposit.** The realm grows by about 10 KB per new entry. That
   is three AVL trees plus the entry, at `storage_price` 100ugnot per byte, so
   about **1.0 GNOT per tx**. The deposit stays locked in the realm, because
   entries are never deleted. It is the larger cost by 10×, and no fee setting
   changes it.

Measured on 2026-09-24 on a local node at the gnoland-1 ref (`e75fef82`), with
the realm and `p/samcrew/avl` byte-identical to the published ones:

| Realm state | Gas used | Storage delta |
|---|---|---|
| Empty (first entry) | 6.6M | 6.0 KB |
| ~30 entries | 17.6M avg | 10.2 KB |
| ~90 entries | 21.4M avg | 10.2 KB |
| ~120 entries | 23.8M | 10.2 KB |

Gas grows by about 2M for each doubling of the entry count. The 50M default
lasts until roughly 150k entries; at 100 attestations a day that is about 4
years. The old default, `-gas-wanted 5000000`, already runs **out of gas on
the first entry**. gnokey simulates before it broadcasts, so an undersized
budget, a fee below the gas price, or a realm panic costs nothing. The run
retries each cycle and parks `errored` after 8 tries. Look for `out of gas` or
`insufficient fee` in the `arcade attest failed` warnings.

Knobs (Fly secrets, all optional):

| Env | Default | Effect |
|---|---|---|
| `MEMBA_ARCADE_GAS_WANTED` | `50000000` | Gas budget per tx. Raise it when attestations fail `out of gas`. |
| `MEMBA_ARCADE_GAS_FEE_UGNOT` | unset (sized from the price) | Explicit fee. It overrides the price-derived fee. If it is below the live minimum, the attester stays dormant. |
| `MEMBA_ARCADE_MAX_GAS_FEE_UGNOT` | `200000` | Cap. Above it, the attester **refuses to start**, logs an `ERROR` line (`arcade attester fee refused`) and stays dormant. |

With the defaults, the live gas price can double before the cap trips. Raise
the cap on purpose, and only after you have checked the price.

#### Funding the attester account

One attestation is one wallet's best run for one game on one closed day. At the
default fee and today's gas price, each one costs about **1.11 GNOT**: 0.10
GNOT fee plus about 1.01 GNOT storage deposit.

| Attestations per day | GNOT per day | GNOT per 30 days |
|---|---|---|
| 10 | ~11 | ~335 |
| 50 | ~56 | ~1,670 |
| 100 | ~111 | ~3,340 |

The batcher sends at most `MEMBA_ARCADE_ATTEST_MAX_PER_CYCLE` txs (default 100)
every `MEMBA_ARCADE_ATTEST_INTERVAL` (default 15m). That is 9,600 a day in the
worst case, about 10,700 GNOT. Lower the per-cycle cap to bound spend below what
the key holds. Fund for the expected daily volume times the top-up interval,
plus headroom, and watch the balance (M6). **Owner decision:** the storage
deposit, not the fee, sets the budget. Reducing it means a realm change, which
is out of scope here.

### M3. Publisher `AddAttester` (MsgCall)

The realm owner (the samcrew 2-of-3) signs one `vm/MsgCall` through the
samcrew-deployer `tools/mainnet-manual` flow:

| Field | Value |
|---|---|
| `pkg_path` | `gno.land/r/samcrew/memba_arcade_leaderboard_v1` |
| `func` | `AddAttester` |
| `args` | `["<attester g1 address from M1>"]` |
| `send` | `""` (no coins) |
| `chain_id` | `gnoland-1` |

`samcrew-arcade-admin.sh` is pinned to the testnet multisig `g1x7k4628…`, so it
refuses `gnoland-1` on the owner check. Do not use it for mainnet.

Before signing, check the preconditions over read-only RPC. Accept an answer
only when `node_info.network == "gnoland-1"`. After the tx, check the
postcondition:

```bash
R=https://rpc.mainnet.samourai.live
curl -s $R/status | jq -r .result.node_info.network                           # gnoland-1
q() { curl -s "$R/abci_query?path=%22vm/qeval%22&data=%22$(printf '%s' "$1" | base64 | tr -d '\n' | jq -sRr @uri)%22" \
      | jq -r .result.response.ResponseBase.Data | base64 -d; echo; }
A=gno.land/r/samcrew/memba_arcade_leaderboard_v1
q "$A.GetOwner()"                    # ("g136j0m08…9s5cpf" .uverse.address)
q "$A.IsPaused()"                    # (false bool)
q "$A.IsAttester(\"<attester>\")"    # (false bool) before, (true bool) after
```

Record the height and tx hash in the deployer journal.

### M4. Enable the backend (Fly)

The image already bakes in gnokey, the `start.sh` boot import and the ephemeral
keyring. Stage the secrets, then deploy them together. The mnemonic travels on
stdin, so it never appears in `argv` or shell history:

```bash
{ printf 'ARCADE_ATTESTER_MNEMONIC=%s\n' "$(cat ~/secure/memba-arcade-attester-gnoland-1.mnemonic)"
  printf 'MEMBA_ARCADE_ATTESTER_KEY=memba-arcade-attester-gnoland-1\n'
  printf 'MEMBA_ARCADE_ATTESTER_ENABLED=1\n'
  printf 'MEMBA_ARCADE_SUBMIT_ENABLED=1\n'
  printf 'MEMBA_ARCADE_GAMES=invaders\n'; } \
  | fly secrets import --stage -a memba-backend
fly secrets list -a memba-backend          # names + digests only
fly secrets deploy -a memba-backend
```

Do not merge a backend PR while secrets are staged: backend merges auto-deploy,
and a deploy activates staged secrets.

- `MEMBA_ARCADE_REALM` defaults to the mainnet path.
- `MEMBA_ARCADE_RPC_URL` defaults to `GNO_RPC_URL`. Confirm that node reports
  `node_info.network == "gnoland-1"`.
- BARRICADE stays out of `MEMBA_ARCADE_GAMES` until its own launch.

Check the boot logs for these three lines:

- `arcade attester key 'memba-arcade-attester-gnoland-1' imported into the keyring`
- `arcade submit endpoint enabled` with `games` = `invaders`
- `arcade day-close attester enabled` with `chainID` = **`gnoland-1`** and the
  mainnet realm

`start.sh` unsets the mnemonic before the app starts. Each feature disables
itself, with a warning, when node, gnokey, the key or the chain is missing.

### M5. Enable the frontend (Netlify)

Set the build env in the Netlify UI and trigger a native redeploy. Never use
`deploy-frontend.yml`.

```
VITE_ENABLE_SPACE_INVADERS=true            # the game (if not already on)
VITE_ENABLE_SPACE_INVADERS_CERTIFY=true    # daily Certify action + board client
# VITE_ENABLE_BARRICADE_CERTIFY stays off until MEMBA_ARCADE_GAMES includes barricade.
```

None of these flags is in `SAFETY_GATED_FLAGS`, because no funds move. After
M3, a separate frontend PR should add the realm to `REALM_ALLOWLIST.mainnet`
and replace the "no attester" note with the `AddAttester` height and tx.

### M6. Verify on mainnet

1. Play a Space Invaders daily run, tap **Certify on-chain** and sign in. The
   poster shows "Run verified and queued".
2. The backend stores the run as `verified` (logs, `/metrics`).
3. Once the day is fully closed (D+2 UTC), the batcher attests the best run per
   wallet. The run flips to `attested` with a tx hash.
4. On-chain, check `GetBoardJSON("invaders", "<YYYY-MM-DD>", 0, 10)` or the
   Render path `:board/invaders/<YYYY-MM-DD>`. The entry is listed. The
   attester's balance should drop by about 1.1 GNOT per attested wallet-day:
   0.1 GNOT fee plus about 1 GNOT storage deposit (see M2).

Rollback is described under [Disable / rollback](#disable--rollback). On
mainnet, `RemoveAttester` and `Pause` are owner MsgCalls through
`tools/mainnet-manual`.

## Pearl-era steps (historical)

The steps below were written for `pearl-1`, which is retired. Keep them for
reference only.

### 1. Deploy the realm (pearl)

The realm `memba_arcade_leaderboard_v1` is source-only in `samcrew-deployer`
(deployer #111) and FROZEN. It's on the deploy manifest (`explicit` lane), so from
`samcrew-deployer/projects/memba/` (after `git pull`):

```bash
# Preflight both pearl RPCs first — only node_info.network == "pearl-1" counts
# (DNS + HTTP 200 are false positives for chain identity):
#   curl -s https://rpc.pearl.testnets.gno.land/status | jq -r .result.node_info.network
#   curl -s https://rpc.pearl.samourai.live/status     | jq -r .result.node_info.network
MULTISIG_SIGNERS=zooma,adena-zxxma REALM=memba_arcade_leaderboard_v1 ./deploy.sh pearl
```

### 2. The attester key ceremony (a NEW dedicated, low-privilege key)

**Never the deploy multisig.** The attester signs board attestations only; if it
leaks, the worst case is forged *board* entries (the realm is funds-free — no
banker, no transfer, no OriginSend), and the owner can `RemoveAttester` it.

1. Generate a fresh key: `gnokey add arcade-attester`. **Record the printed
   mnemonic + address ONCE** — the mnemonic becomes the Fly secret, the address is
   funded + allowlisted.
2. **Fund it** for gas only (pearl faucet: https://faucet.pearl.testnets.gno.land,
   or the hub https://faucet.gno.land — pearl has no airdrop).
3. Allowlist it on the realm via the multisig admin script (from `samcrew-deployer/`):
   ```bash
   ./samcrew-arcade-admin.sh add-attester <attester-addr> pearl   # verifies IsAttester==true
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
#
# Per-game rollout: MEMBA_ARCADE_GAMES is the comma list of enabled games
# (default "barricade" — i.e. Space Invaders and any future game stay DARK,
# their submissions rejected before a verify is spent, until named here, e.g.
# MEMBA_ARCADE_GAMES=barricade,invaders).
flyctl deploy -a memba-backend
```

At boot, `start.sh` imports the mnemonic into the keyring (idempotent via
`--force`) and unsets it. Check the boot logs for `arcade attester key … imported`,
`arcade submit endpoint enabled`, and `arcade day-close attester enabled`. Each
feature self-disables with a warning if `node`/`gnokey`/the key/chain are missing —
so a partial config is safe, never a 500.

### 4. Enable the frontend (Netlify)

Set the build env and redeploy (Netlify-native build, `netlify.toml`). Per game
— enable only the games named in `MEMBA_ARCADE_GAMES`:
```
# Space Invaders (the recommended launch pair):
VITE_ENABLE_SPACE_INVADERS=true          # the game itself
VITE_ENABLE_SPACE_INVADERS_CERTIFY=true  # the daily Certify action + board client

# BARRICADE (post-mainnet; only with MEMBA_ARCADE_GAMES including "barricade"):
VITE_ENABLE_BARRICADE=true          # the game itself (the flag-on playtest gate)
VITE_ENABLE_BARRICADE_CERTIFY=true  # the Certify action + board client
```
None of these are in `SAFETY_GATED_FLAGS` (no funds move), so `assertSafeFlags`
won't fail the build.

### 5. Verify the loop (pearl)

1. Play a daily run to a verified result → tap **Certify on-chain** → sign in →
   the poster shows "Run verified and queued" (queued until the day-close
   attestation writes it on-chain).
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

- **Frontend:** unset the game's certify flag (`VITE_ENABLE_SPACE_INVADERS_CERTIFY`
  or `VITE_ENABLE_BARRICADE_CERTIFY`, Netlify), redeploy → the Certify action
  disappears; play is unaffected.
- **Backend:** unset `MEMBA_ARCADE_SUBMIT_ENABLED` → submit 404s; unset
  `MEMBA_ARCADE_ATTESTER_ENABLED` → the attester stops. Deploy.
- **Realm:** `Pause(true)` freezes all attestation (reads stay live);
  `RemoveAttester` revokes the key. Both are owner-only (on mainnet: a
  2-of-3 MsgCall via `tools/mainnet-manual`).
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
- The **mainnet** Genesis drop plan.
