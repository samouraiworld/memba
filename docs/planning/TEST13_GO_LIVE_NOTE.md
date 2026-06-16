# Test13 go-live — what's left

_Status (2026-06-16): off-chain + audit + hardening + allowlist all SHIPPED & LIVE. **test13's VM flipped to interrealm-v2 mid-deploy** → realms re-ported to v2 (done, on-chain-validated). **NOW BLOCKED on the `samcrew` namespace grant from aeddi** (requested). test12 stays default; banner shows on test13._

## ⛔ Current blocker — `samcrew` namespace grant (aeddi)
The realm deploy reaches the chain and **type-checks fine on v2**, but fails: `g1x7k4628… is not authorized to deploy to namespace 'samcrew'`. The genesis `p/samcrew/piechart` was seeded by gno-core — the namespace isn't bound to our deployer multisig. **Request sent to aeddi.** The moment it's granted, re-run the v2 deploy (below) — everything else is ready.

## ✅ Done & live
- **Off-chain cutover** (#410/#411): official test13 RPC, test13 surfaced in the selector, test11 dropped, "realms not deployed here" banner.
- **Deploy tooling** (deployer #21/#22/#23): repointed to the official RPC, aligned to the frozen v2 set, `memba_dao` ACL-tested (9 green), gnodaokit `/v0`-form guard. Deploy is a 3-step runbook.
- **Expert audit + fact-check** (18 + 14 agents): verdict **GO-WITH-FIXES**; both reports in `docs/planning/TEST13_GOLIVE_AUDIT.md`.
- **Go-live hardening** (#412): test13 chain-mismatch banner fix, wrong-chain broadcast guard, a11y `role=alert`, explorer host. Live via Netlify.
- **Chain-id allowlist** (#413): backend now accepts **`test12,test-13`** tokens → **test13's authed features work now, no forced re-login.** Verified live (`accepted_chain_ids:["test12","test-13"]`).
- **Deployer multisig FUNDED (10,000 GNOT)** — thanks Aeddi. (Namespace `samcrew` is NOT yet bound to it — see blocker above.)
- **Unrestricted transfers on test13** (Jae/Manfred green light) → any wallet becomes signable via faucet + one send.
- **Interrealm-v2 realm port** (deployer draft PR #24): 4 realms + gnodaokit #64; on-chain type-check PASSES; ACL guards byte-for-byte preserved (proven by diff; local executed tests blocked by an upstream uassert/v2 gap).

## 🔶 What I (zxxma) have to do — in order
1. **Get the `samcrew` namespace granted** (with aeddi — request sent). This is the only blocker to deploying.
2. **Re-run the v2 realm deploy** once granted (gnodaokit is on `pr64`; run with the v2 toolchain so the lint gate doesn't reject v2 code):
   ```
   cd samcrew-deployer && export PATH=/tmp/gnov2:$PATH GNOROOT=/Users/zxxma/Desktop/Code/Gno/gno
   MULTISIG_SIGNERS="zooma,adena-zxxma" DEPLOY_KEY=samcrew-core-test1 ./samcrew-deploy.sh test13 gnodaokit
   MULTISIG_SIGNERS="zooma,adena-zxxma" DEPLOY_KEY=samcrew-core-test1 ./samcrew-deploy.sh test13 memba
   ```
   smoke-test all 4 render → flip `realmsDeployed: true` for test13 (one-line PR) → banner gone.
3. **`result=signed` check** (independent of the deploy): switch Adena to a wallet **transacted on test13** — `g1jg8mtu` (test1) already is; or send one tx from `g1747` (transfers unrestricted) — then log in → confirm `auth_login result=signed`. Then enforce: `MEMBA_ALLOW_UNSIGNED_AUTH=0` + `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1`.
4. **Feature-validation on test13:** GovDAO (reads ✓), monitoring/alerting (✓), DAO/candidature/marketplace (need step-2 realms), settings.
5. **Hard cutover (when test12 retired):** backend `GNO_CHAIN_ID='test-13'` + drop test12 from `MEMBA_ACCEPTED_CHAIN_IDS`; frontend `DEFAULT_NETWORK` → test13.

## 📩 Aeddi — the ask now
Funding ✅ received; RPC ✅ live. **test13 already flipped to interrealm-v2** (we re-ported; no heads-up needed anymore). The one open ask:
- **Grant the `samcrew` namespace on test13 to our deployer multisig `g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0`** (as for aib/onbloc). Deploy currently fails `UnauthorizedUserError … namespace 'samcrew'`; genesis seeded `p/samcrew/piechart` but it isn't bound to us.
