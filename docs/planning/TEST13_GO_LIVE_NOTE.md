# Test13 go-live — DONE

_Status (2026-06-16): **Memba's realms are DEPLOYED and LIVE on the official test13** (interrealm-v2). The full migration shipped — off-chain cutover, expert audit, hardening, chain-id allowlist, the v2 re-port, and the realm deploy. test12 remains the default network; switching to test13 in Memba now gives full DAO functionality._

## ✅ Live on test13
- **Realms deployed + rendering** (`r/samcrew/`): `memba_dao`, `memba_dao_candidature_v2`, `memba_dao_channels_v2`, `agent_registry` — plus gnodaokit `p/samcrew/{realmid,daocond,daokit,basedao}`. ACL init verified on-chain (founder roles + owner = the deployer multisig).
- **`realmsDeployed: true`** (Memba #416) → the "not deployed here" banner is gone; DAO/channels/marketplace enabled on test13.
- **Off-chain + hardening + allowlist** (Memba #410–#413): official RPC, selector, test11 dropped, chain-mismatch/broadcast/a11y fixes, and the backend accepts `test12,test-13` tokens (no forced re-login).
- **Deploy tooling** (deployer #21–#24): official RPC, frozen-scope, gnodaokit `/v0` guard, `_test.gno` excluded from addpkg, `samcrew-cla-sign.sh`, CI reclassification.
- **Audit + fact-check**: GO-WITH-FIXES, all implement-now fixes shipped. See `TEST13_GOLIVE_AUDIT.md`.

## 🔶 Remaining (yours — non-blocking)
1. **`result=signed` check → enforce auth.** Switch Adena to a wallet **transacted on test13** (`g1jg8mtu`/test1 already is; or one tx from `g1747` — transfers are unrestricted), log in, confirm `auth_login result=signed`. Then set backend `MEMBA_ALLOW_UNSIGNED_AUTH=0` + `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` in `backend/fly.toml`.
2. **(Optional) executed ACL probe** for extra confidence: call a guarded fn as a non-member and confirm it aborts, e.g. from a funded non-admin key:
   ```
   gnokey maketx call -pkgpath gno.land/r/samcrew/memba_dao_candidature_v2 -func MarkApproved \
     -args <some-addr> -gas-fee 1000000ugnot -gas-wanted 5000000 -chainid test-13 \
     -remote https://rpc.test13.testnets.gno.land:443 <non-admin-key>
   ```
   Expect an abort: `unauthorized: caller … is not an admin`. (The ACL logic is byte-identical to the audited v1, and the on-chain owner/role init is verified, so this is confirmation, not a gate.)
3. **Hard cutover (later, when test12 is retired):** backend `GNO_CHAIN_ID='test-13'` + drop `test12` from `MEMBA_ACCEPTED_CHAIN_IDS`; frontend `DEFAULT_NETWORK` → test13.

## 🛠️ Re-deploying realms on test13 (for reference)
The deploy needs the v2 toolchain (test13's VM is interrealm-v2). See `.remember/remember.md` for the exact setup:
- build v2 gno (`go install …/gno@ba9da8eb…` → `/tmp/gnov2`), `gno` repo at `ba9da8eb`, `gnodaokit` on branch `pr64`;
- `export PATH=/tmp/gnov2:$PATH GNOROOT=…/gno`;
- `MULTISIG_SIGNERS="zooma,adena-zxxma" DEPLOY_KEY=samcrew-core-test1 ./samcrew-deploy.sh test13 {gnodaokit|memba}`.
CLA already signed for `g1x7k4628…`; namespace `samcrew` bound to it by aeddi.

## 🚀 Deploy the NFT launchpad (memba_collections + market engine v3)
Merged to `main` 2026-06-17 (deployer #29, Memba #422); **NOT yet deployed**. The
new realms are wired into `manifest.toml` + `deploy.sh` under `--commerce-v2`
(order: grc721 → memba_nft_v2 → memba_nft_market_v2 → **memba_collections** →
**memba_nft_market_v3**). grc721 + the v2 NFT realms are already live, so the run
is idempotent and only deploys the two new realms.

**1. Deploy (multisig, idempotent):**
```
MULTISIG_SIGNERS="zooma,adena-zxxma" DEPLOY_KEY=samcrew-core-test1 \
  ./samcrew-deploy.sh test13 memba --commerce-v2
```
`memba_collections` is the **ONE irreversible realm** (holds every collection's
NFT ledger — never redeployable without orphaning). Deploys before the engine.

**2. Post-deploy config (ONE required multisig call):** the launchpad is
**open/permissionless**, so creators self-serve `CreateCollection` from the UI and
`AllowDenom("ugnot")` is seeded in `init`. The only required call is authorizing
the engine to move tokens (the drain key):
```
gnokey maketx call -pkgpath gno.land/r/samcrew/memba_collections -func RegisterMarket \
  -args <memba_nft_market_v3 address> -gas-fee 1000000ugnot -gas-wanted 5000000 \
  -chainid test-13 -remote https://rpc.test13.testnets.gno.land:443 <multisig>
```
The v3 address is the realm's deterministic address (printed in the deploy output;
or `gnokey query auth/accounts/<addr>` after deploy). Optionally seed a first
platform collection with `CreateCollection(slug,name,symbol,royaltyBPS,royaltyRecip,mintCustody,maxSupply,maxPerWallet)`
(pays the 1 GNOT createFee) — not required for the open launchpad.

**3. Surface the launchpad UI (frontend, after deploy):** add
`"gno.land/r/samcrew/memba_collections"` to `REALM_ALLOWLIST.test13` in
`frontend/src/lib/config.ts` so `isNftLaunchpadValid()` flips true and
`/nft/create`, `/nft/collection/:id`, `/nft/creator/:address` go live (also needs
`VITE_ENABLE_NFT=true` in the Netlify env, already set for the v2 gallery).

**4. Verify:** `memba_collections:` renders the (empty) collection list;
`memba_nft_market_v3:stats` renders **2.00%** platform fee; `IsRegisteredMarket(<v3 addr>)`
→ true. (Note: the path-less realm-home render returns RPC 500 on all samcrew
realms — a known test13 quirk; always use a render path.)

## 📩 Aeddi — nothing outstanding
Funding ✅, RPC ✅, namespace grant ✅, CLA ✅. test13 is on interrealm-v2 (`chain/test13.1+f45cc5c`).
