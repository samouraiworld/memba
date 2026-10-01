# Native Gno multisig release boundary

Native multisig (creating a multisig, proposing, signing and broadcasting) runs on memba.club when the two switches below are on and the backend has its receipt RPC. The owner released it on 2026-10-01; the switches are set in the deployments by the owner, never by a code change.

## Identity and compatibility

- Native identities use `/tm.PubKeyMultisig` and compressed secp256k1 member keys. They are not Cosmos `LegacyAminoPubKey` identities.
- New configurations sort members by raw account-address bytes. Imports preserve every key position: changing order or threshold changes the address.
- Registration independently derives and checks the expected address on both sides. Every member label must match its public key. Public keys can be collected offline; registration itself neither signs nor funds anything.
- Existing legacy wallet records, joins, names and history remain supported without migration. New legacy registrations are refused. Do not relabel an existing legacy identity as native.
- Only native bank sends and VM calls are supported. Proposals are canonicalized before storage; signed/stored proposals are not rewritten. Native signatures are always verified, independently of the legacy advisory-verification flag.

## Switches

| Setting | Default / requirement |
|---|---|
| `VITE_ENABLE_NATIVE_GNO_MULTISIG` | Absent or `false` by default. `true` shows native creation, proposals, signing and broadcasting. Set by the owner for memba.club. |
| `MEMBA_ENABLE_NATIVE_GNO_MULTISIG` | Absent or `false`. Only `true` or `1` enables native backend writes, and only for the backend's configured chain. |
| `MEMBA_NATIVE_GNO_RPC_URL` | Required with the backend switch; memba.club's `fly.toml` sets `https://rpc.mainnet.samourai.live`, Samourai's own node, a second operator Memba trusts besides the public RPC. It must be ONE node, not a load-balanced pool: it alone may answer that a transaction is absent, which lets a member broadcast, and only while it reports the chain, is not syncing and has a block from the last 10 seconds (and none dated ahead of the server clock). While it is unset the backend answers that it cannot check the chain, so Memba sends no native transaction (it cannot learn whether one is already on chain) and records none. |
| `MEMBA_NATIVE_GNO_RPC_FALLBACK_URL` | Optional; memba.club's `fly.toml` sets the public pool `https://rpc.gno.land:443`. Asked only when the primary is unreachable, slow, on another chain, syncing or behind, or cannot look the transaction up. It may confirm a receipt (checked against the hash and the proposal whichever pool node sends it), never answer that one is absent. |

The environment templates keep both switches off and the receipt nodes unset. Before the first live use on a chain, rehearse once there with a throwaway multisig and a small amount: create, propose, sign to quorum, broadcast, and check the recorded result.

## Review, execution and recovery

The review card shows full recipients and exact monetary amounts. A proposal's fee defaults to twice a fresh network gas price for its gas limit (a default price, labelled as such, when the price cannot be read), because signatures can take days to gather. It can be changed only before the proposal is made; every member signs that exact fee, which is paid on execution. Before broadcasting, Memba checks the signed fee against a fresh price and sends nothing when the price has outgrown it. The current transaction API supports account numbers and sequences only through `uint32`; larger or malformed counters are refused.

The backend assembles an export only after verifying a quorum over one consistent payload rendering. The native broadcaster sends node-encoded bytes to the root JSON-RPC endpoint and checks chain identity, sync state, successful CheckTx/DeliverTx, committed height and transaction hash. Completion separately verifies the chain receipt, executed bytes and signatures against the stored proposal. A refused receipt closes the proposal only when the account's sequence moved at that receipt's block and not before it (it ran there and failed); a refusal before execution keeps it open, even if a node still returns it after the same bytes ran later.

After a successful broadcast returns a validated hash, the browser saves that hash before asking the backend to record completion. Receipt-only retry must not send the transaction again. A response lost after backend completion is reconciled by reading the stored verified result first. The local hash is only a hint, never proof of execution.

If the broadcast result is uncertain (the node's reply is lost, times out or reports a duplicate), Memba shows the expected hash and keeps it on the page. The next press asks the backend whether that transaction is on chain and sends only when the chain answers that it is not; when the check cannot be answered, nothing is sent. This is not an exactly-once or cross-tab guarantee. Do not clear recovery storage to force another send. If storage fails after broadcast, copy the displayed hash before leaving the tab; persistence across reload is not guaranteed in that case.

## Validation limits

Automated tests cover native identity vectors, sparse signature aggregation, mixed-rendering rejection, chain/account guards, legacy preservation, local-chain execution and receipt-recovery paths. The end-to-end spec (`frontend/e2e/os/os-multisig.spec.ts`, "native broadcast") drives the broadcast, the lost reply, the unanswered chain check and receipt recovery against a stubbed chain and backend. A real Adena signature on mainnet is exercised only by the owner's live rehearsal, not by these tests.
