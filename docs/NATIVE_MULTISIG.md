# Native Gno multisig release boundary

Native multisig support is prepared for isolated rehearsals, not production activation. A merge does not authorize enabling it, creating a real multisig/DAO, moving funds or deploying realms. Mainnet realm deployment remains on hold until token transfers are unlocked and deployment is separately approved.

## Identity and compatibility

- Native identities use `/tm.PubKeyMultisig` and compressed secp256k1 member keys. They are not Cosmos `LegacyAminoPubKey` identities.
- New configurations sort members by raw account-address bytes. Imports preserve every key position: changing order or threshold changes the address.
- Registration independently derives and checks the expected address on both sides. Every member label must match its public key. Public keys can be collected offline; registration itself neither signs nor funds anything.
- Existing legacy wallet records, joins, names and history remain supported without migration. New legacy registrations are refused. Do not relabel an existing legacy identity as native.
- Only native bank sends and VM calls are supported. Proposals are canonicalized before storage; signed/stored proposals are not rewritten. Native signatures are always verified, independently of the legacy advisory-verification flag.

## Disabled defaults

| Setting | Default / requirement |
|---|---|
| `VITE_ENABLE_NATIVE_GNO_MULTISIG` | Absent or `false`. The existing production/CI build safety gate rejects `true`; activation requires a reviewed code change. Development and preview builds retain the existing safety-gate exceptions. |
| `MEMBA_ENABLE_NATIVE_GNO_MULTISIG` | Absent or `false`. Only `true` or `1` enables native backend writes, and only for the backend's configured chain. |
| `MEMBA_NATIVE_GNO_RPC_URL` | Unset. Receipt verification requires an explicitly configured RPC and matching chain; it never uses unrelated fallback endpoints. |

The environment templates document disabled values only. Do not change deployed environment variables as part of this patch. Any approved local rehearsal must use a separate database, disposable keys, a loopback-only node and a matching chain configuration throughout.

## Review, execution and recovery

The review card shows full recipients and exact monetary amounts. Native gas limits and fees are explicit rehearsal budgets, not estimates; the fee is paid on execution. The current transaction API supports account numbers and sequences only through `uint32`; larger or malformed counters are refused.

The backend assembles an export only after verifying a quorum over one consistent payload rendering. The native broadcaster sends node-encoded bytes to the root JSON-RPC endpoint and checks chain identity, sync state, successful CheckTx/DeliverTx, committed height and transaction hash. Completion separately verifies the chain receipt, executed bytes and signatures against the stored proposal.

After a successful broadcast returns a validated hash, the browser saves that hash before asking the backend to record completion. Receipt-only retry must not send the transaction again. A response lost after backend completion is reconciled by reading the stored verified result first. The local hash is only a hint, never proof of execution.

If the broadcast result itself is uncertain, stop and reconcile on-chain before any retry; this flow does not provide an exactly-once or cross-tab guarantee. Do not clear recovery storage to force another send. If storage fails after broadcast, copy the displayed hash before leaving the tab; persistence across reload is not guaranteed in that case.

## Validation limits

Automated tests cover native identity vectors, sparse signature aggregation, mixed-rendering rejection, chain/account guards, legacy preservation, local-chain execution and receipt-recovery paths. Real Adena extension acceptance was explicitly skipped by the owner; existing personal use of Adena is not counted as validation of this new path. No real wallet profile or mainnet signing ceremony is part of these tests.

Production activation and any mainnet deployment require a separate decision and review. Keep this restriction visible in the PR and release notes.
