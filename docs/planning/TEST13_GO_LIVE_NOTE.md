# Test13 go-live — what's left

_Status: all code merged. Memba is test13-ready off-chain (test12 still default; a "not deployed here yet" banner shows on test13). The only blocker to going live on test13 is funding the deployer + running the deploy._

## ✅ Already done (code side)
- Memba points at the official test13 RPC, test13 is in the network selector, test11 dropped.
- Deploy tooling aligned to the frozen v2 set; `memba_dao` ACL-tested; deploy is now a 3-step runbook.
- `samcrew` namespace is already registered on test13 (no need to re-request it).

## 🔶 What I (zxxma) have to do
1. **Get the deployer multisig funded on test13** — coordinate with Aeddi (below). This is the one hard blocker.
2. **2-min check on live Memba**: connect a wallet that has already transacted, approve the Adena popup → confirm sign-in works (we want one `result=signed` in the logs).
3. **Once funded** — run (or have Claude run) the deploy:
   1. `git -C gnodaokit checkout test12-deploy`
   2. `samcrew-deploy.sh test13 gnodaokit`   (network first, then project)
   3. `samcrew-deploy.sh test13 memba`
   4. smoke-test → flip `realmsDeployed: true` for test13 (one-line PR) → banner gone, Memba live on test13.

## 📩 What to ask Aeddi (leads test13)
1. **Fund the `samcrew` deployer on test13.** We deploy ~11 packages (3 deps + 4 gnodaokit + 4 realms), each needing a storage deposit (~100 GNOT) + gas. **Please send ~1,500 GNOT** to our deployer/namespace-owner multisig:

   **`g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0`**  (`samcrew-core-test1` multisig — also the registered `samcrew` namespace owner)

   (Namespace already exists — this is funding only.)
2. **Confirm the canonical RPC host.** We're using `https://rpc.test13.testnets.gno.land` (verified live, gno-core infra). Is that the stable, long-term official endpoint, or will it move?
3. **Confirm test13 stays pre-interrealm-v2 (`v1.0.0-rc.0`) for the deploy window** — and **give us a heads-up before flipping the node to interrealm-v2**. Our realms/gnodaokit are deployed in the v0.9/`/v0` form; a v2 flip forces a re-port (gnodaokit #64), so we need to deploy before that and not be surprised by it.
