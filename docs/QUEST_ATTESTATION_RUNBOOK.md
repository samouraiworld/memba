# Quest attestation vouchers: mainnet runbook

This is the owner-gated procedure that turns on quest attestation on gno.land mainnet (`gnoland-1`). Nothing in it is automated. The design background is in [`ADR_QUEST_ATTESTATION_2026-06-26.md`](ADR_QUEST_ATTESTATION_2026-06-26.md).

**How it works.** When a user completes a quest the server has verified, the backend signs an ed25519 voucher over `addr|questId|xp|nonce`. The user broadcasts it to `gno.land/r/samcrew/memba_quest_attestation_v1` with `RecordCompletion`. The realm checks the signature against the public key its owner installed with `SetSigner`. The backend never broadcasts.

## Why the key is bound to one chain (owner ruling O4)

The realm's signed message has **no chain id**, and the realm is deployed and immutable. If one key were registered on two chains, every voucher would be valid on both. We fix this off-chain:

- Each chain gets its **own** ed25519 key. The mainnet key is new and is used only on `gnoland-1`.
- The backend signs only if `QUEST_SIGNER_CHAIN_ID` (the chain the key was made for) is exactly equal to `GNO_CHAIN_ID` (the chain the backend runs on). `gnoland1` is not `gnoland-1`.
- Stored vouchers are scoped to `(chain_id, signer_pubkey)` (table `attestation_vouchers_bound`, migration 031). The backend never serves a voucher from an earlier key or another chain. Such a voucher also never blocks a fresh one: the user's next quest sync re-issues it. The legacy `attestation_vouchers` table (Pearl era) is kept but no longer read.

The canonical message is a frozen contract with the realm. It does not change.

## Configuration

| Fly secret | Meaning |
|---|---|
| `MEMBA_ATTESTATION_SEED` | 32-byte ed25519 seed, 64 hex chars. Unset means attestation is off. |
| `QUEST_SIGNER_CHAIN_ID` | The one chain this seed's public key is registered on. Must equal `GNO_CHAIN_ID`. |
| `GNO_CHAIN_ID` | Already set (`gnoland-1`). |

The backend resolves these once at boot. The result is logged, shown as `quest_attestation` on `/health`, and exported as the gauge `memba_quest_attestation_signer_state{state=…}`:

| State | Cause | Behaviour |
|---|---|---|
| `off` | No seed. | Inert, as before. `GetAttestationVouchers` returns an empty answer, and the QuestHub panel is hidden. |
| `enabled` | Valid seed, `QUEST_SIGNER_CHAIN_ID == GNO_CHAIN_ID`. | Vouchers are issued on verified completions and syncs. |
| `disabled_unbound` | Seed set, `QUEST_SIGNER_CHAIN_ID` empty. | Nothing is signed. `GetAttestationVouchers` returns **Unavailable**. |
| `disabled_chain_mismatch` | The binding names another chain. | Same. |
| `disabled_no_runtime_chain` | `GNO_CHAIN_ID` empty. | Same. |
| `disabled_invalid_seed` | The seed is not 64 hex chars. | Same. This used to stop boot; now it disables the signer. |

A refused signer is logged at ERROR as `QUEST ATTESTATION SIGNER DISABLED`, without the seed. It never blocks boot and never degrades `/health`. The `MembaQuestAttestationSignerRefused` alert (`warn`) covers it.

## State on 2026-09-24

- Realm on `gnoland-1`: published at height 265736. Its owner (`GetOwner()`) is the samcrew 2-of-3 `g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf`. `signerPubKey` is `nil`: Render says `Signer: not configured`, with 0 completions. This comes from a read-only probe at h289818.
- Fly `memba-backend`: `MEMBA_ATTESTATION_SEED` is present. It is the **Pearl-era** key. `QUEST_SIGNER_CHAIN_ID` is absent. With the chain-binding release deployed, the signer reads `disabled_unbound`. That is correct: the Pearl key never signs for `gnoland-1`.
- Frontend: `memba_quest_attestation_v1` is deliberately **not** in the `REALM_ALLOWLIST.mainnet` list.

## Procedure

Run the steps in order. Steps 2 to 5 belong in one sitting (see step 2).

### 1. Generate the mainnet key, offline, on the owner's machine

From a clean checkout of `samouraiworld/Memba`, run:

```bash
cd backend
umask 077
go run ./cmd/quest-signer-keygen \
  -out ~/secure/memba-quest-signer-gnoland-1.seed \
  -chain gnoland-1
# seed written to …/memba-quest-signer-gnoland-1.seed (mode 0600) …
# QUEST_SIGNER_CHAIN_ID=gnoland-1
# SetSigner pubkey (hex): <64 hex>        ← goes to step 3
```

The tool reads `crypto/rand`. It refuses to overwrite an existing file and prints only the public key, never the seed. It derives the key with the same code the backend runs (`attestation.NewFromSeedHex`).

To re-derive the public key later from the file, run `go run ./cmd/quest-signer-keygen -derive <seed file>`.

If you would rather not use Go to create the seed, `umask 077; openssl rand -hex 32 > <seed file>` makes an equivalent one. You then get the public key with `-derive`.

Rules:

- Never reuse this key on another chain, and never reuse a testnet key here.
- Keep the seed file offline, backed up per [`SECRETS_ROTATION.md`](SECRETS_ROTATION.md), and out of every repository.
- Never paste the seed into a chat, a ticket or a shell argument.

### 2. Stage the Fly secrets (no deploy yet)

```bash
{ printf 'MEMBA_ATTESTATION_SEED=%s\n' "$(cat ~/secure/memba-quest-signer-gnoland-1.seed)"
  printf 'QUEST_SIGNER_CHAIN_ID=gnoland-1\n'; } \
  | fly secrets import --stage -a memba-backend
fly secrets list -a memba-backend   # names + digests only: both digests changed
```

The seed travels on stdin, so it never appears in `argv` or in shell history. This replaces the Pearl-era seed.

`--stage` holds the change until step 5. Without it, the backend would sign vouchers before the realm knows the key. The QuestHub panel shows claimable vouchers as soon as the backend issues them, and every `RecordCompletion` would then fail with `attestation signer not configured`.

**Merge no backend PR until step 5.** Backend merges auto-deploy, and a deploy activates staged secrets.

### 3. Publisher `SetSigner` (MsgCall)

The realm owner (the samcrew 2-of-3 above) signs one `vm/MsgCall` through the samcrew-deployer `tools/mainnet-manual` flow:

| Field | Value |
|---|---|
| `pkg_path` | `gno.land/r/samcrew/memba_quest_attestation_v1` |
| `func` | `SetSigner` |
| `args` | `["<64-hex pubkey from step 1>"]` |
| `send` | `""` (no coins) |
| `chain_id` | `gnoland-1` |

Check these preconditions before you sign. Use read-only RPC, and accept an answer only when `node_info.network == "gnoland-1"`:

```bash
R=https://rpc.mainnet.samourai.live      # or rpc.gno.land: check node_info.network either way
curl -s $R/status | jq -r .result.node_info.network                  # gnoland-1
q() { curl -s "$R/abci_query?path=%22vm/qeval%22&data=%22$(printf '%s' "$1" | base64 | tr -d '\n' | jq -sRr @uri)%22" \
      | jq -r .result.response.ResponseBase.Data | base64 -d; echo; }
q 'gno.land/r/samcrew/memba_quest_attestation_v1.GetOwner()'        # ("g136j0m08…9s5cpf" string)
q 'gno.land/r/samcrew/memba_quest_attestation_v1.signerPubKey'       # (nil []uint8) = first configuration
```

`samcrew-attestation-setsigner.sh <pubkey> gnoland-1` in samcrew-deployer applies the same pre- and postconditions for a *first* configuration. It refuses rotation.

### 4. Verify the realm holds exactly this key

```bash
curl -s "$R/abci_query?path=%22vm/qrender%22&data=%22$(printf 'gno.land/r/samcrew/memba_quest_attestation_v1:' | base64 | tr -d '\n' | jq -sRr @uri)%22" \
  | jq -r .result.response.ResponseBase.Data | base64 -d             # "- Signer: configured"
q 'gno.land/r/samcrew/memba_quest_attestation_v1.signerPubKey'       # (slice[0x<PUBKEY, uppercase>] []uint8)
```

Render only says `configured`. The `signerPubKey` query is what proves **which** key is installed, so compare it to the step-1 public key, case-insensitively. Record the height and tx hash in the deployer journal.

### 5. Activate the backend

```bash
fly secrets deploy -a memba-backend
fly logs -a memba-backend | grep -i attestation
#   "attestation signer configured" pubkey=<step-1 pubkey> chainID=gnoland-1
curl -s https://memba-backend.fly.dev/health | jq -r .quest_attestation     # enabled
curl -s -X POST https://memba-backend.fly.dev/memba.v1.MultisigService/GetAttestationVouchers \
  -H 'Content-Type: application/json' -d '{"address":"g1…any…"}' | jq .
#   realmPath = gno.land/r/samcrew/memba_quest_attestation_v1, signerPubkeyHex = <step-1 pubkey>
```

If the state reads anything other than `enabled`, stop. The table above names the cause.

### 6. Allowlist the realm on mainnet (separate frontend PR)

Add `gno.land/r/samcrew/memba_quest_attestation_v1` to `REALM_ALLOWLIST.mainnet` in `frontend/src/lib/config.ts`. Replace the "no signer set" exclusion note with the SetSigner height and tx. The `realm-versions.json` `mainnet` record already exists.

Note that the QuestHub attestation panel keys off the backend answer, not the allowlist. It appears once step 5 is done. The allowlist keeps the frontend's record of what is safe on mainnet truthful.

### 7. Smoke test

1. With a test wallet on `gnoland-1`, complete an off-chain quest, for example `connect-wallet`.
2. QuestHub shows the voucher in "On-chain attestation". `GetAttestationVouchers` for that address returns it, signed by the step-1 key.
3. Broadcast it from the panel (the user pays gas). The tx succeeds.
4. Check the result with `GetRecordedCompletions("<addr>")` and `Render("user/<addr>")` on the realm. The quest is listed, and `GetAttestedXP` went up by the quest's XP.
5. Broadcast the same voucher again. It is rejected as a nonce replay, and XP does not change.

## Rotation, revocation, rollback

- **Rotate (planned or after a leak).**
  1. Generate a new key with step 1, then stage it with step 2.
  2. Have the owner call `SetSigner` with the new public key. This is a rotation, so the first-configuration script refuses it; use `tools/mainnet-manual`.
  3. Verify with step 4, then deploy with step 5.

  Vouchers from the old key stop verifying on-chain and are no longer served. Each user's next quest sync re-issues their completions under the new key. Completions already recorded on-chain are unaffected, because the realm is idempotent per `(addr, questId)`.
- **Stop issuing at once.** Run `fly secrets unset QUEST_SIGNER_CHAIN_ID -a memba-backend`. The state goes to `disabled_unbound`, and the seed stays in place for a later re-enable. Alternatively, unset `MEMBA_ATTESTATION_SEED` for `off`.
- **Revoke on-chain.** The realm has no "unset". Rotate to a fresh key, and never deploy its seed if the goal is only to invalidate a leaked one.
- Backend attestation is off by default. Disabling it never affects quest completion, XP or badges.

## Never

- Set `QUEST_SIGNER_CHAIN_ID` to a chain other than the one whose realm holds this key's public key.
- Copy a seed between chains, or register one public key on two chains.
- Print Fly secret values: no bare `printenv` on Fly, no env dumps. `fly secrets list` is names and digests only.
