# Test13 go-live — what's left

_Status (2026-06-16): off-chain migration + audit + hardening + chain-id allowlist all SHIPPED & LIVE. Deployer is FUNDED (10,000 GNOT). Remaining = one quick auth check, then the realm deploy, then the env flips. test12 is still the default; a "not deployed here yet" banner shows on test13 (GovDAO browsing + monitoring already work there)._

## ✅ Done & live
- **Off-chain cutover** (#410/#411): official test13 RPC, test13 surfaced in the selector, test11 dropped, "realms not deployed here" banner.
- **Deploy tooling** (deployer #21/#22/#23): repointed to the official RPC, aligned to the frozen v2 set, `memba_dao` ACL-tested (9 green), gnodaokit `/v0`-form guard. Deploy is a 3-step runbook.
- **Expert audit + fact-check** (18 + 14 agents): verdict **GO-WITH-FIXES**; both reports in `docs/planning/TEST13_GOLIVE_AUDIT.md`.
- **Go-live hardening** (#412): test13 chain-mismatch banner fix, wrong-chain broadcast guard, a11y `role=alert`, explorer host. Live via Netlify.
- **Chain-id allowlist** (#413): backend now accepts **`test12,test-13`** tokens → **test13's authed features work now, no forced re-login.** Verified live (`accepted_chain_ids:["test12","test-13"]`).
- **`samcrew` namespace** registered on test13; deployer multisig **FUNDED (10,000 GNOT)** — thanks Aeddi.
- **Unrestricted transfers on test13** (Jae/Manfred green light) → any wallet becomes signable via faucet + one send.

## 🔶 What I (zxxma) have to do — in order
1. **`result=signed` check (2 min).** On live Memba, switch to test13, connect a **transacted** wallet (faucet → one send if needed), approve the Adena popup → confirm `auth_login result=signed` in Fly logs. If `signed_invalid` appears, ping me — the sign-doc template needs reconciling before enforcing.
2. **Run the realm deploy** (or have Claude run it):
   1. `git -C gnodaokit checkout test12-deploy`   (guard enforces the /v0 form)
   2. `samcrew-deploy.sh test13 gnodaokit`   (network first, then project)
   3. `samcrew-deploy.sh test13 memba`   (frozen 4: memba_dao, candidature_v2, channels_v2, agent_registry)
   4. smoke-test all 4 render → flip `realmsDeployed: true` for test13 (one-line PR) → banner gone.
3. **Enforce auth (after step 1 is confirmed):** set backend `MEMBA_ALLOW_UNSIGNED_AUTH=0` + `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` in `fly.toml`.
4. **Feature-validation pass on test13:** GovDAO (reads ✓ already), monitoring/alerting (working ✓), DAO create/candidature/marketplace (need realms from step 2), settings.
5. **Hard cutover (when test12 is retired):** set backend `GNO_CHAIN_ID='test-13'` and drop `test12` from `MEMBA_ACCEPTED_CHAIN_IDS`; flip the frontend `DEFAULT_NETWORK` to test13.

## 📩 Aeddi — remaining ask
Funding ✅ received; RPC `https://rpc.test13.testnets.gno.land` ✅ confirmed live (gno-core infra).
- **Heads-up before flipping the node to interrealm-v2.** Our realms/gnodaokit deploy in the v0.9/`/v0` form; a v2 flip forces a re-port (gnodaokit #64), so we must deploy before that and not be surprised. (Today it's `v1.0.0-rc.0` / pre-v2.)
